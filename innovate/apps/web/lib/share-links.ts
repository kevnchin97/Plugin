import "server-only";
import { and, desc, eq, isNull, shareLinks } from "@innovate/db";
import type { CreateShare } from "@innovate/shared";
import { hashPassword } from "@innovate/shared/passwords";
import { newShareToken } from "./feedback";
import { db } from "./server";

type Target = (typeof shareLinks.$inferSelect)["targetType"];

export const shareDto = (l: typeof shareLinks.$inferSelect) => ({
  id: l.id,
  token: l.token,
  permission: l.permission,
  hasPassword: Boolean(l.passwordHash),
  expiresAt: l.expiresAt?.toISOString() ?? null,
  createdAt: l.createdAt.toISOString(),
  path: `/s/${l.token}`,
});

export async function listShares(workspaceId: string, targetType: Target, targetId: string) {
  const rows = await db()
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.workspaceId, workspaceId), eq(shareLinks.targetType, targetType), eq(shareLinks.targetId, targetId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt));
  return rows.map(shareDto);
}

/** Shot lists, decks and reels share as view-only links (boards have their own route with permissions). */
export async function createViewShare(ctx: { workspaceId: string; userId: string }, targetType: Target, targetId: string, input: CreateShare) {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt.length === 10 ? `${input.expiresAt}T23:59:59Z` : input.expiresAt) : null;
  const [link] = await db()
    .insert(shareLinks)
    .values({
      workspaceId: ctx.workspaceId,
      token: newShareToken(),
      targetType,
      targetId,
      permission: "view",
      passwordHash: input.password ? await hashPassword(input.password) : null,
      expiresAt,
      createdBy: ctx.userId,
    })
    .returning();
  return shareDto(link!);
}
