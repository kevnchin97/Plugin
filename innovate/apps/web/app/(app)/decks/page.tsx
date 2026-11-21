import { PresentHome } from "@/components/present/PresentHome";
import { listBoards } from "@/lib/boards";
import { listDecks } from "@/lib/present";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Decks" };

export default async function DecksPage() {
  const ctx = await requirePageSession();
  const [decks, boards] = await Promise.all([listDecks(ctx.workspaceId), listBoards(ctx.workspaceId, ctx.userId)]);
  return <PresentHome kind="deck" items={decks} boards={boards.all.map((b) => ({ id: b.id, title: b.title }))} />;
}
