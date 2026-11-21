import { headers } from "next/headers";
import { slugify } from "@innovate/shared";
import { PortfolioEditor } from "@/components/present/PortfolioEditor";
import { listBoards } from "@/lib/boards";
import { listReels, loadPortfolio } from "@/lib/present";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const ctx = await requirePageSession();
  const [portfolio, reels, boards] = await Promise.all([loadPortfolio({ workspaceId: ctx.workspaceId }), listReels(ctx.workspaceId), listBoards(ctx.workspaceId, ctx.userId)]);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const base = slugify(ctx.user.name || (ctx.user.email ?? "").split("@")[0] || "portfolio").slice(0, 30) || "portfolio";
  return (
    <PortfolioEditor
      initial={portfolio}
      suggestedSlug={base.length >= 3 ? base : `${base}-work`}
      reels={reels.map((r) => ({ id: r.id, title: r.title }))}
      boards={boards.all.map((b) => ({ id: b.id, title: b.title }))}
      origin={origin}
    />
  );
}
