import { NextResponse } from "next/server";
import { createReelSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { createReel, listReels } from "@/lib/present";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ reels: await listReels(ctx.workspaceId) });
});

export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const reel = await createReel(ctx, await parseJson(req, createReelSchema));
  return NextResponse.json({ reel: { id: reel.id, title: reel.title } }, { status: 201 });
});
