import { NextResponse } from "next/server";
import { and, eq, shareLinks } from "@innovate/db";
import { notFound, route, uuidParam } from "@/lib/api";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

/** Turn a share link off. The token stops working immediately. */
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  const [row] = await db()
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, id), eq(shareLinks.workspaceId, ctx.workspaceId)))
    .returning({ id: shareLinks.id });
  if (!row) throw notFound("Share link not found");
  return NextResponse.json({ ok: true });
});
