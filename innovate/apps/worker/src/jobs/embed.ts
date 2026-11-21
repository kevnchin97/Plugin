import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "bullmq";
import { and, asc, embeddings, eq, isNull, notInArray, references, scenes, sql } from "@innovate/db";
import { runFfmpeg } from "@innovate/media";
import { CLIP_MODEL, type EmbedRefJobData } from "@innovate/shared";
import { queueEmbed } from "@innovate/shared/embed-queue";
import { embedImageFile, meanVector } from "../clip";
import { describeFrames } from "../claude";
import { db, dirs, storage } from "../context";
import { localOriginal } from "../originals";

/** Keyframes per video: scene thumbnails, evenly thinned to this many. */
const MAX_KEYFRAMES = 48;
/** Plus a frame every SAMPLE_SECONDS through the video (spaced out further for long videos, at most MAX_SAMPLES). */
const SAMPLE_SECONDS = 2;
const MAX_SAMPLES = 48;

interface Frame {
  source: string;
  time: number | null;
  /** Storage key shown as the hit's thumbnail (null = the reference's own thumbnail). */
  frameKey: string | null;
  file: string;
}

/** First frame of any image or video (GIF, WebP, AVIF included) as a small JPEG for CLIP. */
async function toJpeg(input: string, out: string, at?: number) {
  const seek = at !== undefined && at > 0 ? ["-ss", at.toFixed(3)] : [];
  await runFfmpeg(["-y", ...seek, "-i", input, "-frames:v", "1", "-vf", "scale='min(448,iw)':-2", "-q:v", "3", out]);
  return out;
}

function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]!);
}

/**
 * Embed a reference for search (SPEC §5.6): images and link previews once; videos per scene
 * keyframe; clips and GIFs at a few points. Idempotent: rows are keyed by (reference, source) and
 * stale ones removed. Then the reference-level mean, and a Claude description when configured.
 */
export async function runEmbed(job: Job<EmbedRefJobData>) {
  const { referenceId, workspaceId } = job.data;
  const [ref] = await db.select().from(references).where(and(eq(references.id, referenceId), eq(references.workspaceId, workspaceId)));
  if (!ref || ref.status !== "ready") return { frames: 0 };
  if (ref.type === "note") {
    await db.update(references).set({ embeddedAt: sql`now()` }).where(eq(references.id, referenceId));
    return { frames: 0 };
  }
  // Stamp first, so the sweep doesn't re-queue a reference whose media can't be embedded.
  await db.update(references).set({ embeddedAt: sql`now()` }).where(eq(references.id, referenceId));
  const work = join(dirs.work, `embed-${referenceId}-${job.attemptsMade}`);
  await mkdir(work, { recursive: true });
  try {
    const frames: Frame[] = [];
    const fetchKey = async (key: string, name: string) => {
      const file = join(work, `${name}-${key.split("/").pop()}`);
      await storage.downloadFile(key, file);
      return file;
    };

    if (ref.type === "image" || ref.type === "still" || ref.type === "link") {
      const key = ref.type === "link" ? ref.thumbnailKey : (ref.originalKey ?? ref.thumbnailKey);
      if (key) frames.push({ source: "main", time: null, frameKey: null, file: await toJpeg(await fetchKey(key, "src"), join(work, "main.jpg")) });
    } else if (ref.type === "gif" || ref.type === "clip") {
      if (ref.originalKey) {
        const src = await fetchKey(ref.originalKey, "src");
        const d = ref.duration ?? 0;
        const times = d > 0.5 ? [d * 0.1, d * 0.5, d * 0.9] : [0];
        for (const [i, t] of times.entries())
          frames.push({ source: `t:${t.toFixed(2)}`, time: t, frameKey: null, file: await toJpeg(src, join(work, `f${i}.jpg`), t) });
      }
    } else if (ref.type === "video") {
      // Scene keyframes (the thumbnail a third of the way into each scene)…
      const rows = await db.select().from(scenes).where(eq(scenes.referenceId, referenceId)).orderBy(asc(scenes.index));
      for (const s of thin(rows.filter((r) => r.thumbnailKey), MAX_KEYFRAMES))
        frames.push({ source: `scene:${s.index}`, time: s.start + (s.end - s.start) / 3, frameKey: s.thumbnailKey, file: await fetchKey(s.thumbnailKey!, `scene${s.index}`) });
      // …plus frames sampled through the whole video, so a long shot (or two shots merged by a
      // missed cut) is still searchable everywhere, not only at its one scene thumbnail.
      const d = ref.duration ?? 0;
      const sourceKey = ref.proxyKey ?? ref.masterKey ?? ref.originalKey;
      if (d > 0 && sourceKey) {
        const src = await localOriginal(referenceId, sourceKey);
        const every = Math.max(SAMPLE_SECONDS, d / MAX_SAMPLES);
        const times: number[] = [];
        for (let t = every / 2; t < d; t += every) if (!frames.some((f) => f.time !== null && Math.abs(f.time - t) < every / 3)) times.push(t);
        for (const [i, t] of times.entries()) {
          const file = await toJpeg(src, join(work, `sample${i}.jpg`), t);
          const key = `ws/${workspaceId}/ref/${referenceId}/keyframes/${i}.jpg`;
          await storage.uploadFile(key, file, "image/jpeg");
          frames.push({ source: `sample:${i}`, time: t, frameKey: key, file });
        }
      }
    }

    const rows: (Frame & { vector: number[] })[] = [];
    for (const f of frames) rows.push({ ...f, vector: await embedImageFile(f.file) });
    // The reference can be deleted while we embed (e.g. an agent's undo); then there's nothing to store.
    const [still] = await db.select({ id: references.id }).from(references).where(eq(references.id, referenceId));
    if (!still) return { frames: 0 };
    try {
      await db.transaction(async (tx) => {
        const sources = rows.map((r) => r.source);
        await tx
          .delete(embeddings)
          .where(sources.length ? and(eq(embeddings.referenceId, referenceId), notInArray(embeddings.source, sources)) : eq(embeddings.referenceId, referenceId));
        for (const r of rows)
          await tx
            .insert(embeddings)
            .values({ workspaceId, referenceId, source: r.source, time: r.time, frameKey: r.frameKey, model: CLIP_MODEL, embedding: r.vector })
            .onConflictDoUpdate({
              target: [embeddings.referenceId, embeddings.source],
              set: { time: r.time, frameKey: r.frameKey, model: CLIP_MODEL, embedding: r.vector, createdAt: sql`now()` },
            });
        await tx
          .update(references)
          .set({ embedding: rows.length ? meanVector(rows.map((r) => r.vector)) : null, embeddedAt: sql`now()` })
          .where(eq(references.id, referenceId));
      });
    } catch (err) {
      // Deleted between the check above and the write (foreign-key violation): nothing to store.
      const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
      if (code === "23503") return { frames: 0 };
      throw err;
    }

    // Claude description (keyword fallback + display), once per reference, only when configured.
    if (!ref.autoDescription && rows.length) {
      try {
        const description = await describeFrames(thin(rows, 4).map((r) => r.file), ref.title);
        if (description) await db.update(references).set({ autoDescription: description }).where(eq(references.id, referenceId));
      } catch (err) {
        console.warn(`[embed] description for ${referenceId} failed: ${(err as Error).message}`);
      }
    }
    return { frames: rows.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Safety net: queue every ready reference that has never been embedded (missed triggers, backfill). */
export async function sweepUnembedded(limit = 500) {
  const rows = await db
    .select({ id: references.id, workspaceId: references.workspaceId })
    .from(references)
    .where(and(eq(references.status, "ready"), isNull(references.embeddedAt)))
    .limit(limit);
  for (const r of rows) await queueEmbed(r.id, r.workspaceId);
  return rows.length;
}
