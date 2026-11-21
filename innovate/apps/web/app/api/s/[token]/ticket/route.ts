import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { boardRoom, realtimeTicket } from "@/lib/feedback";
import { shareRequest } from "@/lib/share-api";

export const GET = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { share, boardId } = await shareRequest((await params).token, { boardId: new URL(req.url).searchParams.get("boardId") });
  const who = share.guest ? { id: share.guest.id, name: share.guest.name, kind: "guest" as const } : { id: `anon-${share.link.id.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`, name: "Guest", kind: "guest" as const };
  return NextResponse.json(realtimeTicket(boardRoom(boardId), who));
});
