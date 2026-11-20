import "server-only";
import { redirect } from "next/navigation";
import { ensurePersonalWorkspace } from "@innovate/db";
import { auth } from "@/auth";
import { HttpError } from "./api";
import { db } from "./server";

export interface SessionContext {
  userId: string;
  workspaceId: string;
  role: "owner" | "editor" | "commenter" | "viewer";
  user: { name?: string | null; email?: string | null; image?: string | null };
}

async function load(): Promise<SessionContext | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  // TODO(M2): workspace switcher; M1 uses the user's first (personal) workspace.
  const ws = await ensurePersonalWorkspace(db(), id, session.user?.name);
  return { userId: id, workspaceId: ws.id, role: ws.role, user: session.user ?? {} };
}

export async function requirePageSession(): Promise<SessionContext> {
  const ctx = await load();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For route handlers. `write` requires an Owner or Editor role. */
export async function requireApiSession(opts: { write?: boolean } = {}): Promise<SessionContext> {
  const ctx = await load();
  if (!ctx) throw new HttpError(401, "Sign in to continue.");
  if (opts.write && ctx.role !== "owner" && ctx.role !== "editor") throw new HttpError(403, "You can view this workspace but not edit it.");
  return ctx;
}
