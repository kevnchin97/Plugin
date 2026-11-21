import { NextResponse } from "next/server";
import { savePortfolioSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { loadPortfolio, savePortfolio } from "@/lib/present";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ portfolio: await loadPortfolio({ workspaceId: ctx.workspaceId }) });
});

/** Create or replace this workspace's portfolio page (one per workspace, public at /p/<slug> once published). */
export const PUT = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  await savePortfolio(ctx.workspaceId, await parseJson(req, savePortfolioSchema));
  return NextResponse.json({ portfolio: await loadPortfolio({ workspaceId: ctx.workspaceId }) });
});
