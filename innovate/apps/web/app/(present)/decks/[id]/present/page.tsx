import { notFound } from "next/navigation";
import { z } from "zod";
import { DeckPresenter } from "@/components/present/DeckPresenter";
import { loadDeck } from "@/lib/present";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Presenting" };

/** Full-window presentation, outside the app chrome. */
export default async function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await loadDeck(ctx.workspaceId, id.data).catch(() => null);
  if (!data) notFound();
  return <DeckPresenter data={data} exitHref={`/decks/${id.data}`} />;
}
