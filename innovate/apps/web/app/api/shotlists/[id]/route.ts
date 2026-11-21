import { NextResponse } from "next/server";
import { and, eq, shotLists } from "@innovate/db";
import { updateShotListSchema } from "@innovate/shared";
import { publish } from "@innovate/shared/realtime";
import { parseJson, route, uuidParam } from "@/lib/api";
import { getBoard } from "@/lib/boards";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";
import { getShotList, loadShotList, shotListRoom } from "@/lib/shotlists";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  return NextResponse.json(await loadShotList(ctx.workspaceId, uuidParam.parse((await params).id)));
});

export const PATCH = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getShotList(ctx.workspaceId, id);
  const patch = await parseJson(req, updateShotListSchema);
  if (patch.boardId) await getBoard(ctx.workspaceId, patch.boardId);
  await db().update(shotLists).set(patch).where(and(eq(shotLists.id, id), eq(shotLists.workspaceId, ctx.workspaceId)));
  await publish(shotListRoom(id), { type: "ops", clientId: req.headers.get("x-client-id"), ops: { type: "list", ...patch } });
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getShotList(ctx.workspaceId, id);
  await db().delete(shotLists).where(and(eq(shotLists.id, id), eq(shotLists.workspaceId, ctx.workspaceId)));
  return NextResponse.json({ ok: true });
});
