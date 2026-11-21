import { NextResponse } from "next/server";
import { mediaJobs } from "@innovate/db";
import { route, uuidParam } from "@/lib/api";
import { serializeJob } from "@/lib/media";
import { db, enqueue } from "@/lib/server";
import { requireApiSession } from "@/lib/session";
import { getShotList } from "@/lib/shotlists";

/** Queue a PDF render on the worker (it extracts first frames with ffmpeg). Poll GET /api/jobs/:id. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  const list = await getShotList(ctx.workspaceId, id);
  const [job] = await db()
    .insert(mediaJobs)
    .values({ workspaceId: ctx.workspaceId, referenceId: null, type: "pdf", idempotencyKey: `pdf:${id}:${list.updatedAt.getTime()}:${Date.now()}`, createdBy: ctx.userId })
    .returning();
  await enqueue({ type: "pdf", jobId: job!.id, workspaceId: ctx.workspaceId, shotListId: id });
  return NextResponse.json({ job: await serializeJob(job!) }, { status: 202 });
});
