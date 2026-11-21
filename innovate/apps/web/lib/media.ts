import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, mediaJobs, type MediaJob, type Reference, references, scenes } from "@innovate/db";
import type { ExportRequest } from "@innovate/shared";
import { notFound } from "./api";
import { db, enqueue, storage } from "./server";

export async function getReference(workspaceId: string, id: string) {
  const [ref] = await db()
    .select()
    .from(references)
    .where(and(eq(references.id, id), eq(references.workspaceId, workspaceId)));
  if (!ref) throw notFound("That reference doesn't exist in this workspace.");
  return ref;
}

const sign = (key: string | null | undefined) => (key ? storage().signedGetUrl(key) : Promise.resolve(null));

export async function serializeReference(ref: Reference) {
  const [sceneRows, [ingest]] = await Promise.all([
    db().select().from(scenes).where(eq(scenes.referenceId, ref.id)).orderBy(asc(scenes.index)),
    db()
      .select()
      .from(mediaJobs)
      .where(and(eq(mediaJobs.referenceId, ref.id), eq(mediaJobs.type, "ingest")))
      .orderBy(desc(mediaJobs.createdAt))
      .limit(1),
  ]);
  const ranked = [...sceneRows].sort((a, b) => b.score - a.score || a.index - b.index);
  const rank = new Map(ranked.map((s, i) => [s.id, i]));
  const isVideo = ref.type === "video";
  return {
    id: ref.id,
    type: ref.type,
    title: ref.title,
    status: ref.status,
    stage: ref.stage,
    error: ref.error,
    width: ref.width,
    height: ref.height,
    duration: ref.duration,
    fps: ref.fpsNum && ref.fpsDen ? { num: ref.fpsNum, den: ref.fpsDen } : null,
    frameCount: ref.frameCount,
    hasAudio: Boolean(ref.hasAudio),
    variableFrameRate: ref.variableFrameRate,
    sourceUrl: ref.sourceUrl,
    sourcePlatform: ref.sourcePlatform,
    sourceIn: ref.sourceIn,
    sourceOut: ref.sourceOut,
    parentReferenceId: ref.parentReferenceId,
    createdAt: ref.createdAt.toISOString(),
    proxyUrl: isVideo && ref.status === "ready" ? await sign(ref.proxyKey) : null,
    mediaUrl: !isVideo ? await sign(ref.originalKey) : null,
    thumbnailUrl: await sign(ref.thumbnailKey),
    filmstrip: ref.filmstrip && ref.status === "ready" ? { ...ref.filmstrip, url: await sign(ref.filmstrip.key) } : null,
    scenes: await Promise.all(
      sceneRows.map(async (s) => ({
        index: s.index,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
        start: s.start,
        end: s.end,
        score: s.score,
        motion: s.motion,
        gifDensity: s.gifDensity !== null && s.gifFirstDensity !== null ? { first: s.gifFirstDensity, perFrame: s.gifDensity } : null,
        rank: rank.get(s.id) ?? 0,
        thumbnailUrl: await sign(s.thumbnailKey),
      })),
    ),
    ingest: ingest ? serializeJobBase(ingest) : null,
  };
}

export type ReferenceDTO = Awaited<ReturnType<typeof serializeReference>>;

function serializeJobBase(job: MediaJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
  };
}

export async function serializeJob(job: MediaJob) {
  return {
    ...serializeJobBase(job),
    kind: job.request?.kind ?? null,
    request: job.request,
    output: job.output,
    savedReferenceId: job.savedReferenceId,
    createdAt: job.createdAt.toISOString(),
    downloadUrl:
      job.status === "completed" && job.output ? await storage().signedGetUrl(job.output.key, { downloadName: job.output.filename }) : null,
    previewUrl: job.status === "completed" && job.output ? await storage().signedGetUrl(job.output.key) : null,
  };
}

export type JobDTO = Awaited<ReturnType<typeof serializeJob>>;

export function exportIdempotencyKey(req: ExportRequest): string {
  const canonical =
    req.kind === "still"
      ? ["still", req.referenceId, req.frame, req.format]
      : req.kind === "gif"
        ? ["gif", req.referenceId, req.inFrame, req.outFrame, req.options.width, req.options.fps, req.options.loop, req.options.quality]
        : ["clip", req.referenceId, req.inFrame, req.outFrame];
  return createHash("sha256").update(JSON.stringify(["v1", ...canonical])).digest("hex").slice(0, 24);
}

/**
 * Create (or find) a media job by idempotency key and make sure it's queued.
 * Completed jobs are returned as-is; failed jobs are reset and retried.
 */
export async function upsertJob(input: {
  workspaceId: string;
  referenceId: string;
  type: "ingest" | "export";
  idempotencyKey: string;
  request?: ExportRequest;
  createdBy: string;
}) {
  const d = db();
  await d
    .insert(mediaJobs)
    .values({ ...input, status: "queued", stage: "queued" })
    .onConflictDoNothing({ target: [mediaJobs.workspaceId, mediaJobs.idempotencyKey] });
  const [job] = await d
    .select()
    .from(mediaJobs)
    .where(and(eq(mediaJobs.workspaceId, input.workspaceId), eq(mediaJobs.idempotencyKey, input.idempotencyKey)));
  if (!job) throw new Error("Could not create job");

  if (job.status === "completed" && (input.type === "ingest" || (job.output && (await storage().head(job.output.key))))) return job;
  if (job.status === "failed" || job.status === "completed") {
    const [reset] = await d
      .update(mediaJobs)
      .set({ status: "queued", stage: "queued", progress: 0, error: null })
      .where(eq(mediaJobs.id, job.id))
      .returning();
    await enqueue(dataFor(reset!), true);
    return reset!;
  }
  await enqueue(dataFor(job));
  return job;
}

function dataFor(job: MediaJob) {
  if (!job.referenceId) throw new Error(`Job ${job.id} has no reference`);
  return job.type === "ingest"
    ? { type: "ingest" as const, jobId: job.id, referenceId: job.referenceId, workspaceId: job.workspaceId }
    : { type: "export" as const, jobId: job.id, referenceId: job.referenceId, workspaceId: job.workspaceId, request: job.request! };
}
