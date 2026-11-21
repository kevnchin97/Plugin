import { NextResponse } from "next/server";
import { HttpError, route, uuidParam } from "@/lib/api";
import { getBoard } from "@/lib/boards";
import { boardRoom, realtimeTicket } from "@/lib/feedback";
import { requireApiSession } from "@/lib/session";
import { getShotList, shotListRoom } from "@/lib/shotlists";

/** A 10-minute ticket for the realtime server, scoped to one board or shot-list room. */
export const GET = route(async (req: Request) => {
  const ctx = await requireApiSession();
  const q = new URL(req.url).searchParams;
  let room: string;
  if (q.get("boardId")) {
    const id = uuidParam.parse(q.get("boardId"));
    await getBoard(ctx.workspaceId, id);
    room = boardRoom(id);
  } else if (q.get("shotListId")) {
    const id = uuidParam.parse(q.get("shotListId"));
    await getShotList(ctx.workspaceId, id);
    room = shotListRoom(id);
  } else throw new HttpError(400, "Which room?");
  return NextResponse.json(realtimeTicket(room, { id: ctx.userId, name: ctx.user.name || ctx.user.email?.split("@")[0] || "Someone", kind: "user" }));
});
