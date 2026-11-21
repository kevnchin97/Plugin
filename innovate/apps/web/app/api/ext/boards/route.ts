import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { listBoards } from "@/lib/boards";
import { requireBearer } from "@/lib/tokens";

/** Board picker for the extension (token auth). */
export const GET = route(async (req: Request) => {
  const who = await requireBearer(req);
  const list = await listBoards(who.workspaceId, who.userId);
  const recent = list.recent.map((b) => ({ id: b.id, title: b.title }));
  const rest = list.all.filter((b) => !recent.some((r) => r.id === b.id)).map((b) => ({ id: b.id, title: b.title }));
  return NextResponse.json({ recent, boards: rest });
});
