import { NextResponse } from "next/server";
import { eq, reels } from "@innovate/db";
import { saveReelSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { getReel, loadReel, saveReel } from "@/lib/present";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  return NextResponse.json(await loadReel(ctx.workspaceId, uuidParam.parse((await params).id)));
});

/** Save the whole reel (cards and items in order, with trims). */
export const PUT = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await saveReel(ctx.workspaceId, id, await parseJson(req, saveReelSchema));
  return NextResponse.json(await loadReel(ctx.workspaceId, id));
});

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const reel = await getReel(ctx.workspaceId, uuidParam.parse((await params).id));
  await db().delete(reels).where(eq(reels.id, reel.id));
  return new NextResponse(null, { status: 204 });
});
