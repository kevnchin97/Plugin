import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "bullmq";
import { and, eq, mediaJobs, references } from "@innovate/db";
import { exportClip, exportGif, exportStill, type SourceInfo } from "@innovate/media";
import { type ExportJobData, type ExportOutput, exportFilename, frameToSeconds, storageKeys } from "@innovate/shared";
import { db, dirs, storage } from "../context";
import { localOriginal } from "../originals";
import { Progress } from "../progress";

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  mp4: "video/mp4",
} as const;

/**
 * Render a still, GIF or clip from the ORIGINAL (never the proxy).
 * Idempotent: the output key derives from the request hash, and a completed job whose
 * object still exists is returned as-is.
 */
export async function runExport(job: Job<ExportJobData>): Promise<ExportOutput> {
  const { jobId, referenceId, workspaceId, request } = job.data;
  const [row] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, jobId));
  if (!row) throw new Error("Export job record not found");
  if (row.status === "completed" && row.output && (await storage.head(row.output.key))) return row.output;

  const [ref] = await db
    .select()
    .from(references)
    .where(and(eq(references.id, referenceId), eq(references.workspaceId, workspaceId)));
  // VFR sources render from their CFR master so frame N matches what the editor showed.
  const sourceKey = ref?.masterKey ?? ref?.originalKey;
  if (!ref || !sourceKey) throw new Error("The source video is missing.");
  if (ref.status !== "ready" || !ref.fpsNum || !ref.fpsDen || !ref.width || !ref.height)
    throw new Error("The source video hasn't finished processing.");

  const fps = { num: ref.fpsNum, den: ref.fpsDen };
  const src: SourceInfo = {
    fps,
    width: ref.width,
    height: ref.height,
    hasAudio: Boolean(ref.hasAudio),
    videoStartOffset: ref.videoStartOffset ?? 0,
  };
  const lastFrame = Math.max(0, (ref.frameCount ?? 1) - 1);
  const progress = new Progress(job, jobId);
  await progress.setStage("downloading", 0);
  const original = await localOriginal(referenceId, sourceKey);

  const work = join(dirs.work, `export-${jobId}-${job.attemptsMade}`);
  await mkdir(work, { recursive: true });
  try {
    let ext: keyof typeof TYPES;
    let inFrame: number;
    let outFrame: number;
    let width = src.width;
    let height = src.height;
    const out = (e: string) => join(work, `out.${e}`);

    if (request.kind === "still") {
      ext = request.format;
      inFrame = outFrame = Math.min(request.frame, lastFrame);
      await progress.setStage("encoding", 0.2);
      await exportStill(original, out(ext), inFrame, src, request.format);
    } else {
      inFrame = Math.min(request.inFrame, lastFrame);
      outFrame = Math.min(request.outFrame, lastFrame);
      if (request.kind === "gif") {
        ext = "gif";
        const params = await exportGif(original, join(work, "palette.png"), out(ext), { inFrame, outFrame }, src, request.options, {
          onStage: (s) => void progress.setStage(s),
          onProgress: progress.span(0.05, 0.9),
        });
        width = params.width;
        height = params.height;
      } else {
        ext = "mp4";
        await progress.setStage("encoding", 0.05);
        await exportClip(original, out(ext), { inFrame, outFrame }, src, { onProgress: progress.span(0.05, 0.9) });
        width -= width % 2;
        height -= height % 2;
      }
    }

    await progress.setStage("uploading", 0.92);
    const key = storageKeys.export(workspaceId, referenceId, row.idempotencyKey, ext);
    const bytes = await storage.uploadFile(key, out(ext), TYPES[ext]);
    const sourceIn = frameToSeconds(inFrame, fps);
    const sourceOut = frameToSeconds(outFrame + 1, fps);
    const output: ExportOutput = {
      key,
      filename: exportFilename(ref.title, ext, sourceIn, request.kind === "still" ? undefined : sourceOut),
      contentType: TYPES[ext],
      bytes,
      width,
      height,
      durationSec: request.kind === "still" ? 0 : sourceOut - sourceIn,
      sourceIn,
      sourceOut,
    };
    await db
      .update(mediaJobs)
      .set({ status: "completed", stage: "done", progress: 100, output, error: null })
      .where(eq(mediaJobs.id, jobId));
    return output;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
