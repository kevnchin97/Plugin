import { NextResponse } from "next/server";
import { and, boards, eq } from "@innovate/db";
import { updateBoardSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { getBoard, loadBoard } from "@/lib/boards";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  return NextResponse.json(await loadBoard(ctx.workspaceId, uuidParam.parse((await params).id), ctx.userId));
});

export const PATCH = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getBoard(ctx.workspaceId, id);
  const patch = await parseJson(req, updateBoardSchema);
  await db().update(boards).set(patch).where(and(eq(boards.id, id), eq(boards.workspaceId, ctx.workspaceId)));
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getBoard(ctx.workspaceId, id);
  await db().delete(boards).where(and(eq(boards.id, id), eq(boards.workspaceId, ctx.workspaceId)));
  return NextResponse.json({ ok: true });
});
