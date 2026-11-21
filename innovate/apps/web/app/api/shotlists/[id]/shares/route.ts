import { NextResponse } from "next/server";
import { createShareSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { createViewShare, listShares } from "@/lib/share-links";
import { requireApiSession } from "@/lib/session";
import { getShotList } from "@/lib/shotlists";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  await getShotList(ctx.workspaceId, id);
  return NextResponse.json({ shares: await listShares(ctx.workspaceId, "shot_list", id) });
});

/** Shot lists share as live, view-only links. */
export const POST = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getShotList(ctx.workspaceId, id);
  const share = await createViewShare(ctx, "shot_list", id, await parseJson(req, createShareSchema));
  return NextResponse.json({ share }, { status: 201 });
});
