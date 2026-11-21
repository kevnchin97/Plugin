import { NextResponse } from "next/server";
import { shotPatchSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { requireApiSession } from "@/lib/session";
import { deleteShot, updateShot } from "@/lib/shotlists";

type Params = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const patch = await parseJson(req, shotPatchSchema);
  return NextResponse.json(await updateShot(ctx.workspaceId, uuidParam.parse((await params).id), patch, req.headers.get("x-client-id")));
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  await deleteShot(ctx.workspaceId, uuidParam.parse((await params).id), req.headers.get("x-client-id"));
  return NextResponse.json({ ok: true });
});
