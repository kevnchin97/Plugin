import { NextResponse } from "next/server";
import { mediaJobs } from "@innovate/db";
import { route, uuidParam } from "@/lib/api";
import { serializeJob } from "@/lib/media";
import { getDeck } from "@/lib/present";
import { db, enqueue } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

/** Queue a deck PDF on the worker (posters for motion items come from ffmpeg). Poll GET /api/jobs/:id. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const deck = await getDeck(ctx.workspaceId, uuidParam.parse((await params).id));
  const [job] = await db()
    .insert(mediaJobs)
    .values({ workspaceId: ctx.workspaceId, referenceId: null, type: "deck-pdf", idempotencyKey: `deck-pdf:${deck.id}:${Date.now()}`, createdBy: ctx.userId })
    .returning();
  await enqueue({ type: "deck-pdf", jobId: job!.id, workspaceId: ctx.workspaceId, deckId: deck.id });
  return NextResponse.json({ job: await serializeJob(job!) }, { status: 202 });
});
