import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { memberships, workspaces } from "./schema";

/** Every user gets a personal workspace on first sign-in. Idempotent. */
export async function ensurePersonalWorkspace(db: Db, userId: string, displayName?: string | null) {
  const existing = await db
    .select({ id: memberships.workspaceId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (existing[0]) return existing[0];
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({ name: displayName ? `${displayName}'s workspace` : "My workspace" })
      .returning({ id: workspaces.id });
    if (!ws) throw new Error("Could not create workspace");
    await tx.insert(memberships).values({ workspaceId: ws.id, userId, role: "owner" });
    return { id: ws.id, role: "owner" as const };
  });
}

export async function getMembership(db: Db, userId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}
