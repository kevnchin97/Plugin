import { NextResponse } from "next/server";
import { boards } from "@innovate/db";
import { createBoardSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { getBoard, listBoards } from "@/lib/boards";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json(await listBoards(ctx.workspaceId, ctx.userId));
});

export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const input = await parseJson(req, createBoardSchema);
  if (input.parentBoardId) await getBoard(ctx.workspaceId, input.parentBoardId);
  const [board] = await db()
    .insert(boards)
    .values({ workspaceId: ctx.workspaceId, title: input.title, parentBoardId: input.parentBoardId ?? null, createdBy: ctx.userId })
    .returning();
  return NextResponse.json({ board: { id: board!.id, title: board!.title } }, { status: 201 });
});
