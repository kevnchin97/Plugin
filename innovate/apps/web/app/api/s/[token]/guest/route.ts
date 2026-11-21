import { NextResponse } from "next/server";
import { guestSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { createGuest } from "@/lib/feedback";
import { shareRequest } from "@/lib/share-api";

/** Guests need no account, just a display name for their favorites and comments. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { share } = await shareRequest((await params).token, { limit: 30 });
  const { name } = await parseJson(req, guestSchema);
  const g = await createGuest(share.link, name);
  return NextResponse.json({ guest: { id: g.id, name: g.displayName } }, { status: 201 });
});
