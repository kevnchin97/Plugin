import { NextResponse } from "next/server";
import { and, eq, mediaJobs, references } from "@innovate/db";
import { formatTimecode, saveExportSchema } from "@innovate/shared";
import { HttpError, notFound, route, uuidParam } from "@/lib/api";
import { placeOnBoard } from "@/lib/boards";
import { getReference } from "@/lib/media";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

/**
 * "Save to Innovate": turn a finished export into a library reference that points back to
 * its source (parentReferenceId) and keeps source URL, platform and timecodes. Idempotent.
 * With `boardId` the item is also placed on that board; without, it waits in Unsorted.
 */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  const body = saveExportSchema.partial().parse(await req.json().catch(() => ({})));
  const d = db();
  const [job] = await d
    .select()
    .from(mediaJobs)
    .where(and(eq(mediaJobs.id, id), eq(mediaJobs.workspaceId, ctx.workspaceId)));
  if (!job || job.type !== "export" || !job.referenceId) throw notFound("Export not found");
  if (job.savedReferenceId) return NextResponse.json({ referenceId: job.savedReferenceId, alreadySaved: true });
  if (job.status !== "completed" || !job.output || !job.request) throw new HttpError(409, "The export hasn't finished yet.");

  const parent = await getReference(ctx.workspaceId, job.referenceId);
  const fps = { num: parent.fpsNum ?? 25, den: parent.fpsDen ?? 1 };
  const o = job.output;
  const kind = job.request.kind;
  const r = job.request;
  const inFrame = r.kind === "still" ? r.frame : r.inFrame;
  const title =
    body.title ??
    `${parent.title} · ${formatTimecode(inFrame, fps)}${r.kind === "still" ? "" : `–${formatTimecode(r.outFrame, fps)}`}`;

  const result = await d.transaction(async (tx) => {
    // Lock the job row so concurrent saves (a click and Enter) can't both insert.
    const [locked] = await tx.select().from(mediaJobs).where(eq(mediaJobs.id, job.id)).for("update");
    if (locked?.savedReferenceId) return { referenceId: locked.savedReferenceId, alreadySaved: true };
    const [created] = await tx
      .insert(references)
      .values({
        workspaceId: ctx.workspaceId,
        type: kind,
        status: "ready",
        stage: "ready",
        title,
        originalKey: o.key,
        thumbnailKey: kind === "clip" ? parent.thumbnailKey : o.key,
        contentType: o.contentType,
        bytes: o.bytes,
        width: o.width,
        height: o.height,
        duration: o.durationSec,
        fpsNum: parent.fpsNum,
        fpsDen: parent.fpsDen,
        hasAudio: kind === "clip" ? parent.hasAudio : false,
        sourceUrl: parent.sourceUrl,
        sourcePlatform: parent.sourcePlatform,
        sourceIn: o.sourceIn,
        sourceOut: o.sourceOut,
        parentReferenceId: parent.id,
        createdBy: ctx.userId,
      })
      .returning({ id: references.id });
    await tx.update(mediaJobs).set({ savedReferenceId: created!.id }).where(eq(mediaJobs.id, job.id));
    const boardItemId = body.boardId
      ? await placeOnBoard(tx, ctx.workspaceId, body.boardId, created!.id, ctx.userId, o.width >= o.height ? 280 : 200)
      : null;
    return { referenceId: created!.id, alreadySaved: false, boardId: body.boardId ?? null, boardItemId };
  });
  return NextResponse.json(result, { status: result.alreadySaved ? 200 : 201 });
});
