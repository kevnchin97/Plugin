import { NextResponse } from "next/server";
import { and, boardItems, eq, references } from "@innovate/db";
import { notFound, route, uuidParam } from "@/lib/api";
import { serializeRefLite } from "@/lib/boards";
import { db, storage } from "@/lib/server";
import { shareRequest } from "@/lib/share-api";

/** Playable media for a reference on a shared board (signed, short-lived URLs). */
export const GET = route(async (req: Request, { params }: { params: Promise<{ token: string; refId: string }> }) => {
  const p = await params;
  const { share, boardId } = await shareRequest(p.token, { boardId: new URL(req.url).searchParams.get("boardId") });
  const refId = uuidParam.parse(p.refId);
  const [onBoard] = await db()
    .select({ id: boardItems.id })
    .from(boardItems)
    .where(and(eq(boardItems.boardId, boardId), eq(boardItems.referenceId, refId)))
    .limit(1);
  if (!onBoard) throw notFound("That reference isn't on this board.");
  const [ref] = await db().select().from(references).where(and(eq(references.id, refId), eq(references.workspaceId, share.link.workspaceId)));
  if (!ref) throw notFound();
  return NextResponse.json({
    reference: await serializeRefLite(ref),
    playUrl: ref.type === "video" ? (ref.proxyKey ? await storage().signedGetUrl(ref.proxyKey) : null) : ref.type === "clip" && ref.originalKey ? await storage().signedGetUrl(ref.originalKey) : null,
  });
});
