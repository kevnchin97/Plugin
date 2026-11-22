import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { QueueJob as Job } from "@innovate/shared/queue";
import { and, eq, mediaJobs, references, scenes } from "@innovate/db";
import { analyzeSource, chooseMasterRate, createMaster, createThumbnail, needsMaster, planFilmstrip, probe, sampleGifDensity } from "@innovate/media";
import { copyFile } from "node:fs/promises";
import { type IngestJobData, storageKeys } from "@innovate/shared";
import { db, dirs, storage } from "../context";
import { env } from "../env";
import { adapterFor } from "@innovate/shared/adapters";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
      const adapter = adapterFor(new URL(ref.sourceUrl));
      let got: { contentType: string; bytes: number; filename: string };
      if (adapter) {
        // Platform link through its adapter (official API); see packages/shared/src/server/adapters.ts.
        const meta = await adapter.fetchMetadata(new URL(ref.sourceUrl));
        const media = await adapter.fetchMedia(new URL(ref.sourceUrl));
        await pipeline(Readable.fromWeb(media.stream as never), createWriteStream(tmp));
        const { size } = await import("node:fs/promises").then((fs) => fs.stat(tmp));
        got = { contentType: media.contentType, bytes: size, filename: meta.title };
      } else {
        got = await downloadUrl(ref.sourceUrl, tmp, {
          maxBytes: env.INGEST_MAX_BYTES,
          allowPrivate: env.INGEST_ALLOW_PRIVATE_URLS,
          onProgress: progress.span(0, 0.1),
        });
      }
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
    let original = await localOriginal(referenceId, originalKey);
    let info = await probe(original);

    // 2b. Variable frame rate (phones): re-time onto a fixed grid once; everything after uses it.
    let masterKey: string | null = null;
    if (needsMaster(info)) {
      await progress.setStage("master", 0.12);
      const rate = chooseMasterRate(info);
      const master = join(work, "master.mp4");
      await createMaster(original, master, rate, { hasAudio: info.hasAudio, durationSec: info.durationSec, onProgress: progress.span(0.12, 0.3) });
      masterKey = storageKeys.master(workspaceId, referenceId);
      await storage.uploadFile(masterKey, master, "video/mp4");
      // Seed the worker cache so exports don't download it again.
      const cached = join(dirs.cache, referenceId, "master.mp4");
      await mkdir(join(dirs.cache, referenceId), { recursive: true });
      await copyFile(master, cached);
      original = cached;
      info = await probe(original);
    }
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
        masterKey,
        variableFrameRate: masterKey !== null,
      })
      .where(eq(references.id, referenceId));

    // 3. One decode (in parallel chunks) -> proxy, filmstrip sprite and scene statistics.
    await progress.setStage("proxy", 0.3);
    const proxy = join(work, "proxy.mp4");
    const strip = join(work, "filmstrip.jpg");
    const plan = planFilmstrip(info.durationSec, info.width, info.height);
    const { scenes: detected, stats } = await analyzeSource(
      original,
      { proxy, filmstrip: strip },
      {
        hasAudio: info.hasAudio,
        durationSec: info.durationSec,
        fps: info.fps,
        frameCount: info.frameCount,
        videoStartOffset: info.videoStartOffset,
        plan,
        segments: env.INGEST_PARALLELISM,
        workDir: join(work, "chunks"),
        onProgress: progress.span(0.3, 0.8),
      },
    );
    const proxyKey = storageKeys.proxy(workspaceId, referenceId);
    const filmstripKey = storageKeys.filmstrip(workspaceId, referenceId);
    await Promise.all([storage.uploadFile(proxyKey, proxy, "video/mp4"), storage.uploadFile(filmstripKey, strip, "image/jpeg")]);
    await db
      .update(references)
      .set({ proxyKey, filmstrip: { ...plan, key: filmstripKey } })
      .where(eq(references.id, referenceId));

    // 4. A thumbnail per scene.
    await progress.setStage("scenes", 0.82);
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
      progress.span(0.82, 0.88)(++done / rows.length);
    });

    // 5. GIF size calibration: encode a 1 s sample per scene from the original. Capped so
    //    long, cut-heavy videos stay fast; unsampled scenes borrow the median.
    const src = { fps: info.fps, width: info.width, height: info.height, hasAudio: false, videoStartOffset: info.videoStartOffset };
    const toSample = [...rows].sort((a, b) => a.rank - b.rank).slice(0, MAX_DENSITY_SAMPLES);
    done = 0;
    await mapLimit(toSample, 4, async (s) => {
      s.gifDensity = await sampleGifDensity(original, work, s, src).catch(() => null);
      progress.span(0.88, 0.98)(++done / toSample.length);
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
