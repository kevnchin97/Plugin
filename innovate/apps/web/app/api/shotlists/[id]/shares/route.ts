import { NextResponse } from "next/server";
import { and, desc, eq, isNull, shareLinks } from "@innovate/db";
import { createShareSchema } from "@innovate/shared";
import { hashPassword } from "@innovate/shared/passwords";
import { parseJson, route, uuidParam } from "@/lib/api";
import { newShareToken } from "@/lib/feedback";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";
import { getShotList } from "@/lib/shotlists";

type Params = { params: Promise<{ id: string }> };

const dto = (l: typeof shareLinks.$inferSelect) => ({
  id: l.id,
  token: l.token,
  permission: l.permission,
  hasPassword: Boolean(l.passwordHash),
  expiresAt: l.expiresAt?.toISOString() ?? null,
  createdAt: l.createdAt.toISOString(),
  path: `/s/${l.token}`,
});

export const GET = route(async (_req: Request, { params }: Params) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  await getShotList(ctx.workspaceId, id);
  const rows = await db()
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.workspaceId, ctx.workspaceId), eq(shareLinks.targetType, "shot_list"), eq(shareLinks.targetId, id), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt));
  return NextResponse.json({ shares: rows.map(dto) });
});

/** Shot lists share as live, view-only links. */
export const POST = route(async (req: Request, { params }: Params) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await getShotList(ctx.workspaceId, id);
  const input = await parseJson(req, createShareSchema);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt.length === 10 ? `${input.expiresAt}T23:59:59Z` : input.expiresAt) : null;
  const [link] = await db()
    .insert(shareLinks)
    .values({
      workspaceId: ctx.workspaceId,
      token: newShareToken(),
      targetType: "shot_list",
      targetId: id,
      permission: "view",
      passwordHash: input.password ? await hashPassword(input.password) : null,
      expiresAt,
      createdBy: ctx.userId,
    })
    .returning();
  return NextResponse.json({ share: dto(link!) }, { status: 201 });
});
