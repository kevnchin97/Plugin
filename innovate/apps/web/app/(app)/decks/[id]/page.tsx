import { notFound } from "next/navigation";
import { z } from "zod";
import { DeckEditor } from "@/components/present/DeckEditor";
import { listBoards } from "@/lib/boards";
import { loadDeck } from "@/lib/present";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Deck" };

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await loadDeck(ctx.workspaceId, id.data).catch(() => null);
  if (!data) notFound();
  const boards = await listBoards(ctx.workspaceId, ctx.userId);
  return <DeckEditor key={id.data} data={data} boards={boards.all.map((b) => ({ id: b.id, title: b.title }))} />;
}
