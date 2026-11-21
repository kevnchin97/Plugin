import { NextResponse } from "next/server";
import { route, uuidParam } from "@/lib/api";
import { getBoard } from "@/lib/boards";
import { boardRoom, realtimeTicket } from "@/lib/feedback";
import { requireApiSession } from "@/lib/session";

/** A 10-minute ticket for the realtime server, scoped to one board room. */
export const GET = route(async (req: Request) => {
  const ctx = await requireApiSession();
  const boardId = uuidParam.parse(new URL(req.url).searchParams.get("boardId"));
  await getBoard(ctx.workspaceId, boardId);
  return NextResponse.json(
    realtimeTicket(boardRoom(boardId), { id: ctx.userId, name: ctx.user.name || ctx.user.email?.split("@")[0] || "Someone", kind: "user" }),
  );
});
