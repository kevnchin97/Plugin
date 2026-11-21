import { NextResponse } from "next/server";
import { commentSchema, favoriteSchema } from "@innovate/shared";
import { route } from "@/lib/api";
import { addComment, guestActor, loadFeedback, toggleFavorite } from "@/lib/feedback";
import { shareRequest } from "@/lib/share-api";

type Params = { params: Promise<{ token: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const { share, boardId } = await shareRequest((await params).token, { boardId: new URL(req.url).searchParams.get("boardId") });
  return NextResponse.json(await loadFeedback(share.link.workspaceId, boardId, { guestId: share.guest?.id }));
});

/** Guests favorite (favorite/comment links) and comment (comment links). */
export const POST = route(async (req: Request, { params }: Params) => {
  const body = (await req.json().catch(() => ({}))) as { action?: string; boardId?: string };
  const { share, boardId } = await shareRequest((await params).token, { boardId: body.boardId ?? null, limit: 60 });
  if (body.action === "favorite") {
    const { referenceId } = favoriteSchema.parse(body);
    return NextResponse.json(await toggleFavorite(guestActor(share, "favorite"), boardId, referenceId));
  }
  const input = commentSchema.parse(body);
  return NextResponse.json({ comment: await addComment(guestActor(share, "comment"), boardId, input) }, { status: 201 });
});
