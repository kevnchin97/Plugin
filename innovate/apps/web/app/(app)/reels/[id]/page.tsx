import { notFound } from "next/navigation";
import { z } from "zod";
import { ReelEditor } from "@/components/present/ReelEditor";
import { listBoards } from "@/lib/boards";
import { loadReel } from "@/lib/present";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Reel" };

export default async function ReelPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await loadReel(ctx.workspaceId, id.data).catch(() => null);
  if (!data) notFound();
  const boards = await listBoards(ctx.workspaceId, ctx.userId);
  return <ReelEditor key={id.data} data={data} boards={boards.all.map((b) => ({ id: b.id, title: b.title }))} />;
}
