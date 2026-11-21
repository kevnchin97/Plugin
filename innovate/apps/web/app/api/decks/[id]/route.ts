import { NextResponse } from "next/server";
import { decks, eq } from "@innovate/db";
import { saveDeckSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { getDeck, loadDeck, saveDeck } from "@/lib/present";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  return NextResponse.json(await loadDeck(ctx.workspaceId, uuidParam.parse((await params).id)));
});

/** Save the whole deck (title, theme, slides in order). */
export const PUT = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await saveDeck(ctx.workspaceId, id, await parseJson(req, saveDeckSchema));
  return NextResponse.json(await loadDeck(ctx.workspaceId, id));
});

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const deck = await getDeck(ctx.workspaceId, uuidParam.parse((await params).id));
  await db().delete(decks).where(eq(decks.id, deck.id));
  return new NextResponse(null, { status: 204 });
});
