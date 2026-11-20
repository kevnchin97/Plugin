import { NextResponse } from "next/server";
import { exportRequestSchema, frameToSeconds, MAX_CLIP_SECONDS, MAX_GIF_SECONDS } from "@innovate/shared";
import { HttpError, parseJson, route } from "@/lib/api";
import { exportIdempotencyKey, getReference, serializeJob, upsertJob } from "@/lib/media";
import { requireApiSession } from "@/lib/session";

/** Queue a still / GIF / clip export. The same request twice returns the same job. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const request = await parseJson(req, exportRequestSchema);
  const ref = await getReference(ctx.workspaceId, request.referenceId);
  if (ref.type !== "video" || ref.status !== "ready" || !ref.fpsNum || !ref.fpsDen)
    throw new HttpError(409, "This video is still processing.");
  const last = Math.max(0, (ref.frameCount ?? 1) - 1);
  const fps = { num: ref.fpsNum, den: ref.fpsDen };
  if (request.kind === "still") {
    if (request.frame > last) throw new HttpError(400, "That frame is past the end of the video.");
  } else {
    if (request.inFrame > last) throw new HttpError(400, "The in point is past the end of the video.");
    request.outFrame = Math.min(request.outFrame, last);
    const seconds = frameToSeconds(request.outFrame - request.inFrame + 1, fps);
    const max = request.kind === "gif" ? MAX_GIF_SECONDS : MAX_CLIP_SECONDS;
    if (seconds > max) throw new HttpError(400, `${request.kind === "gif" ? "GIFs" : "Clips"} can be up to ${max / 60 >= 1 ? `${max / 60} minutes` : `${max} seconds`} long. Tighten the in and out points.`);
  }
  const job = await upsertJob({
    workspaceId: ctx.workspaceId,
    referenceId: ref.id,
    type: "export",
    idempotencyKey: exportIdempotencyKey(request),
    request,
    createdBy: ctx.userId,
  });
  return NextResponse.json({ job: await serializeJob(job) }, { status: 202 });
});
