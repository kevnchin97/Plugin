import { NextResponse } from "next/server";
import { and, apiTokens, eq } from "@innovate/db";
import { notFound, route, uuidParam } from "@/lib/api";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  const [row] = await db()
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, ctx.userId)))
    .returning({ id: apiTokens.id });
  if (!row) throw notFound("Token not found");
  return NextResponse.json({ ok: true });
});
