import { NextResponse } from "next/server";
import { boardOpsSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { applyOps } from "@/lib/boards";
import { requireApiSession } from "@/lib/session";

/** Batched, atomic board edits: { create, update, delete }. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const boardId = uuidParam.parse((await params).id);
  const ops = await parseJson(req, boardOpsSchema);
  await applyOps(ctx.workspaceId, boardId, ops, ctx.userId);
  return NextResponse.json({ ok: true });
});
