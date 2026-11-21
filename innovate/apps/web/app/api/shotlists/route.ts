import { NextResponse } from "next/server";
import { shotLists } from "@innovate/db";
import { createShotListSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { getBoard } from "@/lib/boards";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";
import { listShotLists } from "@/lib/shotlists";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ shotLists: await listShotLists(ctx.workspaceId) });
});

export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const input = await parseJson(req, createShotListSchema);
  if (input.boardId) await getBoard(ctx.workspaceId, input.boardId);
  const [row] = await db().insert(shotLists).values({ workspaceId: ctx.workspaceId, title: input.title, boardId: input.boardId ?? null, createdBy: ctx.userId }).returning();
  return NextResponse.json({ shotList: { id: row!.id, title: row!.title } }, { status: 201 });
});
