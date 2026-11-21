import { BoardView } from "@/components/board/BoardView";
import { homeBoard, loadBoard, unsorted } from "@/lib/boards";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Home" };

/** The app opens on the workspace's Home board: every board is a card on it (Milanote-style). */
export default async function HomePage() {
  const ctx = await requirePageSession();
  const home = await homeBoard(ctx.workspaceId, ctx.userId);
  const data = await loadBoard(ctx.workspaceId, home.id, ctx.userId);
  return <BoardView key={home.id} initial={data} initialUnsorted={await unsorted(ctx.workspaceId)} selfId={ctx.userId} />;
}
