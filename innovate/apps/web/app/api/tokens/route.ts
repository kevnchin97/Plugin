import { NextResponse } from "next/server";
import { and, apiTokens, desc, eq, isNull } from "@innovate/db";
import { createTokenSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";
import { createToken } from "@/lib/tokens";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  const rows = await db()
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, ctx.userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return NextResponse.json({
    tokens: rows.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() })),
  });
});

/** Returns the raw token once. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const { name } = await parseJson(req, createTokenSchema);
  const { token, row } = await createToken(ctx.userId, ctx.workspaceId, name);
  return NextResponse.json({ token, id: row.id, prefix: row.prefix }, { status: 201 });
});
