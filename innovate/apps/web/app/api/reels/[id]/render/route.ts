import { NextResponse } from "next/server";
import { mediaJobs } from "@innovate/db";
import { HttpError, route, uuidParam } from "@/lib/api";
import { serializeJob } from "@/lib/media";
import { getReel, loadReel } from "@/lib/present";
import { db, enqueue } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

/** Optional: render the reel to one MP4 on the worker. Poll GET /api/jobs/:id. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const reel = await getReel(ctx.workspaceId, uuidParam.parse((await params).id));
  const data = await loadReel(ctx.workspaceId, reel.id);
  if (!data.items.length) throw new HttpError(400, "Add at least one clip before rendering.");
  const [job] = await db()
    .insert(mediaJobs)
    .values({ workspaceId: ctx.workspaceId, referenceId: null, type: "reel-render", idempotencyKey: `reel-render:${reel.id}:${Date.now()}`, createdBy: ctx.userId })
    .returning();
  await enqueue({ type: "reel-render", jobId: job!.id, workspaceId: ctx.workspaceId, reelId: reel.id });
  return NextResponse.json({ job: await serializeJob(job!) }, { status: 202 });
});
