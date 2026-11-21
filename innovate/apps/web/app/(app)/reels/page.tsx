import { PresentHome } from "@/components/present/PresentHome";
import { listBoards } from "@/lib/boards";
import { listReels } from "@/lib/present";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Reels" };

export default async function ReelsPage() {
  const ctx = await requirePageSession();
  const [reels, boards] = await Promise.all([listReels(ctx.workspaceId), listBoards(ctx.workspaceId, ctx.userId)]);
  return <PresentHome kind="reel" items={reels} boards={boards.all.map((b) => ({ id: b.id, title: b.title }))} />;
}
