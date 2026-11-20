import { BoardsHome } from "@/components/boards/BoardsHome";
import { listBoards } from "@/lib/boards";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Boards" };

export default async function BoardsPage() {
  const ctx = await requirePageSession();
  return <BoardsHome list={await listBoards(ctx.workspaceId, ctx.userId)} />;
}
