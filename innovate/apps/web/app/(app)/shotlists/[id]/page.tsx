import { notFound } from "next/navigation";
import { z } from "zod";
import { ShotListView } from "@/components/shotlist/ShotListView";
import { listBoards } from "@/lib/boards";
import { requirePageSession } from "@/lib/session";
import { loadShotList } from "@/lib/shotlists";

export const metadata = { title: "Shot list" };

export default async function ShotListPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await loadShotList(ctx.workspaceId, id.data).catch(() => null);
  if (!data) notFound();
  const boards = await listBoards(ctx.workspaceId, ctx.userId);
  const ordered = [...boards.recent, ...boards.all.filter((b) => !boards.recent.some((r) => r.id === b.id))].map((b) => ({ id: b.id, title: b.title }));
  return <ShotListView key={id.data} initial={data} boards={ordered} />;
}
