import { NextResponse } from "next/server";
import { commentSchema, favoriteSchema } from "@innovate/shared";
import { route, uuidParam } from "@/lib/api";
import { getBoard } from "@/lib/boards";
import { addComment, loadFeedback, recentActivity, toggleFavorite } from "@/lib/feedback";
import { requireApiSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/** Comments, favorite counts and recent activity for a board (owner side). */
export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  await getBoard(ctx.workspaceId, id);
  const [feedback, activity] = await Promise.all([loadFeedback(ctx.workspaceId, id, { userId: ctx.userId }), recentActivity(ctx.workspaceId, id)]);
  return NextResponse.json({ ...feedback, activity });
});

/** POST { action: "comment", ... } or { action: "favorite", referenceId }. */
export const POST = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  await getBoard(ctx.workspaceId, id);
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const actor = { kind: "user" as const, userId: ctx.userId, name: ctx.user.name || ctx.user.email?.split("@")[0] || "Someone", workspaceId: ctx.workspaceId };
  if (body.action === "favorite") {
    const { referenceId } = favoriteSchema.parse(body);
    return NextResponse.json(await toggleFavorite(actor, id, referenceId));
  }
  const input = commentSchema.parse(body);
  return NextResponse.json({ comment: await addComment(actor, id, input) }, { status: 201 });
});
