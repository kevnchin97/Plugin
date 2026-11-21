import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, apiTokens, eq, isNull, mediaJobs } from "@innovate/db";
import { HttpError } from "./api";
import { db, enqueue } from "./server";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A new extension token. The raw value is returned once; only its hash is stored. */
export async function createToken(userId: string, workspaceId: string, name: string) {
  const raw = `inv_${randomBytes(24).toString("base64url")}`;
  const [row] = await db()
    .insert(apiTokens)
    .values({ userId, workspaceId, name, tokenHash: sha256(raw), prefix: raw.slice(0, 10) })
    .returning();
  return { token: raw, row: row! };
}

/** Resolve `Authorization: Bearer inv_…` to the token's user and workspace. */
export async function requireBearer(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const raw = /^Bearer\s+(inv_[\w-]{20,})$/i.exec(header)?.[1];
  if (!raw) throw new HttpError(401, "Missing or malformed token. Create one in Innovate → Settings → Browser extension.");
  const [t] = await db()
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256(raw)), isNull(apiTokens.revokedAt)));
  if (!t) throw new HttpError(401, "That token isn't valid any more. Create a new one in Settings.");
  void db().update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, t.id)).catch(() => {});
  return { userId: t.userId, workspaceId: t.workspaceId, tokenName: t.name };
}

/** Queue an image import (worker job) for a reference. */
export async function queueImport(workspaceId: string, referenceId: string, url: string, as: "original" | "thumbnail", userId: string) {
  const [job] = await db()
    .insert(mediaJobs)
    .values({ workspaceId, referenceId, type: "import", idempotencyKey: `import:${referenceId}:${as}`, createdBy: userId })
    .onConflictDoNothing()
    .returning();
  if (job) await enqueue({ type: "import", jobId: job.id, referenceId, workspaceId, url, as });
}
