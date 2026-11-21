import { NextResponse } from "next/server";
import { createShareSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { getReel } from "@/lib/present";
import { createViewShare, listShares } from "@/lib/share-links";
import { requireApiSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  await getReel(ctx.workspaceId, id);
  return NextResponse.json({ shares: await listShares(ctx.workspaceId, "reel", id) });
});

/** A reel shares as a view-only, branded player link. */
export const POST = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getReel(ctx.workspaceId, id);
  return NextResponse.json({ share: await createViewShare(ctx, "reel", id, await parseJson(req, createShareSchema)) }, { status: 201 });
});
