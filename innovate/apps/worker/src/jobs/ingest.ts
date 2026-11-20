import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "bullmq";
import { and, eq, mediaJobs, references, scenes } from "@innovate/db";
import { createFilmstrip, createProxy, createThumbnail, detectScenes, planFilmstrip, probe, sampleGifDensity } from "@innovate/media";
import { type IngestJobData, storageKeys } from "@innovate/shared";
import { db, dirs, storage } from "../context";
import { env } from "../env";
import { downloadUrl } from "../fetch-url";
import { localOriginal } from "../originals";
import { Progress } from "../progress";

const MAX_DENSITY_SAMPLES = 24;
const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

/**
 * Ingest: (fetch) -> probe -> proxy -> filmstrip -> scenes (+ thumbnails).
 * Idempotent: derivative keys are deterministic and scenes are replaced, so a retry or a
 * re-run produces the same rows and objects.
 */
export async function runIngest(job: Job<IngestJobData>) {
  const { referenceId, workspaceId, jobId } = job.data;
  const [ref] = await db
    .select()
    .from(references)
    .where(and(eq(references.id, referenceId), eq(references.workspaceId, workspaceId)));
  if (!ref) throw new Error("Reference not found");

  const progress = new Progress(job, jobId, referenceId);
  await db.update(references).set({ status: "processing", error: null }).where(eq(references.id, referenceId));
  const work = join(dirs.work, `ingest-${jobId}-${job.attemptsMade}`);
  await mkdir(work, { recursive: true });

  try {
    let originalKey = ref.originalKey;

    // 1. Fetch direct URLs (uploads arrive already in storage).
    if (!originalKey || !(await storage.head(originalKey))) {
      if (!ref.sourceUrl) throw new Error("The upload didn't finish. Try uploading the file again.");
      await progress.setStage("fetching", 0);
      const tmp = join(work, "download");
      const got = await downloadUrl(ref.sourceUrl, tmp, {
        maxBytes: env.INGEST_MAX_BYTES,
        allowPrivate: env.INGEST_ALLOW_PRIVATE_URLS,
        onProgress: progress.span(0, 0.1),
      });
      originalKey = storageKeys.original(workspaceId, referenceId, EXT[got.contentType] ?? "mp4");
      await storage.uploadFile(originalKey, tmp, got.contentType);
      await db
        .update(references)
        .set({
          originalKey,
          contentType: got.contentType,
          bytes: got.bytes,
          title: ref.title === "Untitled" ? got.filename.replace(/\.[a-z0-9]+$/i, "") : ref.title,
        })
        .where(eq(references.id, referenceId));
      await rm(tmp, { force: true });
    }

    // 2. Probe.
    await progress.setStage("probing", 0.1);
    const original = await localOriginal(referenceId, originalKey);
    const info = await probe(original);
    await db
      .update(references)
      .set({
        width: info.width,
        height: info.height,
        duration: info.durationSec,
        fpsNum: info.fps.num,
        fpsDen: info.fps.den,
        frameCount: info.frameCount,
        hasAudio: info.hasAudio,
        videoStartOffset: info.videoStartOffset,
      })
      .where(eq(references.id, referenceId));

    // 3. Proxy (low-res H.264 with a short GOP for scrubbing).
    await progress.setStage("proxy", 0.15);
    const proxy = join(work, "proxy.mp4");
    await createProxy(original, proxy, { hasAudio: info.hasAudio, durationSec: info.durationSec, onProgress: progress.span(0.15, 0.55) });
    const proxyKey = storageKeys.proxy(workspaceId, referenceId);
    await storage.uploadFile(proxyKey, proxy, "video/mp4");
    await db.update(references).set({ proxyKey }).where(eq(references.id, referenceId));

    // 4. Filmstrip sprite sheet.
    await progress.setStage("filmstrip", 0.55);
    const plan = planFilmstrip(info.durationSec, info.width, info.height);
    const strip = join(work, "filmstrip.jpg");
    await createFilmstrip(proxy, strip, plan, { durationSec: info.durationSec, onProgress: progress.span(0.55, 0.65) });
    const filmstripKey = storageKeys.filmstrip(workspaceId, referenceId);
    await storage.uploadFile(filmstripKey, strip, "image/jpeg");
    await db.update(references).set({ filmstrip: { ...plan, key: filmstripKey } }).where(eq(references.id, referenceId));

    // 5. Scenes, scored, with a thumbnail each.
    await progress.setStage("scenes", 0.65);
    const { scenes: detected, stats } = await detectScenes(proxy, info.fps, {
      durationSec: info.durationSec,
      onProgress: progress.span(0.65, 0.86),
    });
    const rows = detected.map((s) => ({
      ...s,
      thumbnailKey: storageKeys.scene(workspaceId, referenceId, s.index),
      gifDensity: null as { first: number; perFrame: number } | null,
    }));
    let done = 0;
    await mapLimit(rows, 4, async (s) => {
      const out = join(work, `scene-${s.index}.jpg`);
      // A third of the way in: past any fade-in, before the cut out.
      await createThumbnail(proxy, out, s.start + (s.end - s.start) / 3, 480);
      await storage.uploadFile(s.thumbnailKey, out, "image/jpeg");
      progress.span(0.88, 0.92)(++done / rows.length);
    });

    // 6. GIF size calibration: encode a 1 s sample per scene from the original. Capped so
    //    long, cut-heavy videos stay fast; unsampled scenes borrow the median.
    const src = { fps: info.fps, width: info.width, height: info.height, hasAudio: false, videoStartOffset: info.videoStartOffset };
    const toSample = [...rows].sort((a, b) => a.rank - b.rank).slice(0, MAX_DENSITY_SAMPLES);
    done = 0;
    await mapLimit(toSample, 4, async (s) => {
      s.gifDensity = await sampleGifDensity(original, work, s, src).catch(() => null);
      progress.span(0.92, 0.98)(++done / toSample.length);
    });
    const sampled = rows.map((r) => r.gifDensity).filter((d) => d !== null).sort((a, b) => a.perFrame - b.perFrame);
    const median = sampled.length ? sampled[Math.floor(sampled.length / 2)]! : null;
    for (const r of rows) r.gifDensity ??= median;
    const best = rows.find((s) => s.rank === 0) ?? rows[0];
    const thumbKey = storageKeys.thumbnail(workspaceId, referenceId);
    const thumb = join(work, "thumb.jpg");
    await createThumbnail(proxy, thumb, best ? best.start + (best.end - best.start) / 3 : 0, 960);
    await storage.uploadFile(thumbKey, thumb, "image/jpeg");

    await db.transaction(async (tx) => {
      await tx.delete(scenes).where(eq(scenes.referenceId, referenceId));
      if (rows.length)
        await tx.insert(scenes).values(
          rows.map((s) => ({
            referenceId,
            index: s.index,
            start: s.start,
            end: s.end,
            startFrame: s.startFrame,
            endFrame: s.endFrame,
            thumbnailKey: s.thumbnailKey,
            score: s.score,
            motion: s.motion,
            contrast: s.contrast,
            gifFirstDensity: s.gifDensity?.first ?? null,
            gifDensity: s.gifDensity?.perFrame ?? null,
          })),
        );
      await tx
        .update(references)
        .set({ status: "ready", stage: "ready", thumbnailKey: thumbKey, frameCount: stats.length || info.frameCount, error: null })
        .where(eq(references.id, referenceId));
      await tx
        .update(mediaJobs)
        .set({ status: "completed", stage: "done", progress: 100, error: null })
        .where(eq(mediaJobs.id, jobId));
    });
    return { scenes: rows.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
