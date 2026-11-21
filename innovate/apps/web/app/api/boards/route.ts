import { NextResponse } from "next/server";
import { createBoardSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { createBoardOn, listBoards } from "@/lib/boards";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json(await listBoards(ctx.workspaceId, ctx.userId));
});

export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const input = await parseJson(req, createBoardSchema);
  // A new board is a card on its parent (Home by default), like creating one from the tool rail.
  const board = await createBoardOn(ctx.workspaceId, ctx.userId, input.title, input.parentBoardId, input.placeCard);
  return NextResponse.json({ board: { id: board!.id, title: board!.title } }, { status: 201 });
});
