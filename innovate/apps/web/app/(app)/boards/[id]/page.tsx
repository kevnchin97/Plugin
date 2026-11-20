import { notFound } from "next/navigation";
import { z } from "zod";
import { BoardView } from "@/components/board/BoardView";
import { loadBoard, unsorted } from "@/lib/boards";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Board" };

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await loadBoard(ctx.workspaceId, id.data, ctx.userId).catch(() => null);
  if (!data) notFound();
  return <BoardView key={id.data} initial={data} initialUnsorted={await unsorted(ctx.workspaceId)} />;
}
