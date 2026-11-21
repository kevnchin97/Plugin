import { ShotListsHome } from "@/components/shotlist/ShotListsHome";
import { listBoards } from "@/lib/boards";
import { requirePageSession } from "@/lib/session";
import { listShotLists } from "@/lib/shotlists";

export const metadata = { title: "Shot lists" };

export default async function ShotListsPage() {
  const ctx = await requirePageSession();
  const [lists, boards] = await Promise.all([listShotLists(ctx.workspaceId), listBoards(ctx.workspaceId, ctx.userId)]);
  return <ShotListsHome lists={lists} boards={boards.all.map((b) => ({ id: b.id, title: b.title }))} />;
}
