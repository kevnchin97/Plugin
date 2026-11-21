import { NextResponse } from "next/server";
import { boardOpsSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { publish } from "@innovate/shared/realtime";
import { applyOps } from "@/lib/boards";
import { boardRoom, logActivity } from "@/lib/feedback";
import { requireApiSession } from "@/lib/session";

/** Batched, atomic board edits: { create, update, delete }. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const boardId = uuidParam.parse((await params).id);
  const ops = await parseJson(req, boardOpsSchema);
  await applyOps(ctx.workspaceId, boardId, ops, ctx.userId);
  // Live board edits for everyone else looking at this board (owner tabs, collaborators, guests).
  await publish(boardRoom(boardId), { type: "ops", clientId: req.headers.get("x-client-id"), ops });
  const added = ops.create.filter((c) => c.kind === "reference").length;
  if (added) await logActivity(ctx.workspaceId, boardId, "added", ctx.user.name || ctx.user.email?.split("@")[0] || "Someone", { count: added });
  return NextResponse.json({ ok: true });
});
