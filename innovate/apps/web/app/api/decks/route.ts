import { NextResponse } from "next/server";
import { createDeckSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { createDeck, listDecks } from "@/lib/present";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ decks: await listDecks(ctx.workspaceId) });
});

export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const deck = await createDeck(ctx, await parseJson(req, createDeckSchema));
  return NextResponse.json({ deck: { id: deck.id, title: deck.title } }, { status: 201 });
});
