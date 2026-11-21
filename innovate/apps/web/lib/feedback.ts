import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  activity,
  and,
  asc,
  boardItems,
  boards,
  comments,
  desc,
  eq,
  favorites,
  guests,
  inArray,
  memberships,
  notificationPrefs,
  notifications,
  type ShareLink,
  shareLinks,
  sql,
  users,
} from "@innovate/db";
import { canComment, canFavorite, parseMentions, type SharePermission } from "@innovate/shared";
import { sendMail } from "@innovate/shared/mailer";
import { publish } from "@innovate/shared/realtime";
import { sign, verify } from "@innovate/shared/signing";
import { HttpError } from "./api";
import { db } from "./server";

export type Actor =
  | { kind: "user"; userId: string; name: string; workspaceId: string }
  | { kind: "guest"; guestId: string; name: string; workspaceId: string; link: ShareLink };

export const boardRoom = (boardId: string) => `board:${boardId}`;
export const newShareToken = () => randomBytes(18).toString("base64url");

const UNLOCK = "share-unlock";
const GUEST = "share-guest";
const unlockCookie = (linkId: string) => `isl_${linkId.slice(0, 8)}`;
const guestCookie = (linkId: string) => `isg_${linkId.slice(0, 8)}`;

/* ---------- share links ---------- */

export type ShareState =
  | { ok: true; link: ShareLink; unlocked: boolean; guest: { id: string; name: string } | null }
  | { ok: false; reason: "missing" | "revoked" | "expired" };

export async function resolveShare(token: string): Promise<ShareState> {
  const [link] = await db().select().from(shareLinks).where(eq(shareLinks.token, token));
  if (!link) return { ok: false, reason: "missing" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const jar = await cookies();
  const unlocked = !link.passwordHash || verify<{ linkId: string }>(jar.get(unlockCookie(link.id))?.value, UNLOCK)?.linkId === link.id;
  const g = verify<{ linkId: string; guestId: string; name: string }>(jar.get(guestCookie(link.id))?.value, GUEST);
  return { ok: true, link, unlocked, guest: g && g.linkId === link.id ? { id: g.guestId, name: g.name } : null };
}

/** For API routes: a live, unlocked link or a readable error. */
export async function requireShare(token: string) {
  const s = await resolveShare(token);
  if (!s.ok) throw new HttpError(s.reason === "missing" ? 404 : 410, s.reason === "expired" ? "This link has expired." : s.reason === "revoked" ? "This link was turned off." : "This link doesn't exist.");
  if (!s.unlocked) throw new HttpError(401, "This link needs its password.");
  return s;
}

export async function setUnlocked(link: ShareLink) {
  (await cookies()).set(unlockCookie(link.id), sign({ linkId: link.id, exp: Date.now() + 30 * 864e5 }, UNLOCK), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
  });
}

export async function createGuest(link: ShareLink, name: string) {
  const [g] = await db().insert(guests).values({ shareLinkId: link.id, displayName: name }).returning();
  (await cookies()).set(guestCookie(link.id), sign({ linkId: link.id, guestId: g!.id, name, exp: Date.now() + 180 * 864e5 }, GUEST), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 180 * 86400,
  });
  return g!;
}

/** A shared board link also opens the boards nested inside it, and nothing else. */
export async function boardInShare(link: ShareLink, boardId: string): Promise<boolean> {
  if (link.targetType !== "board") return false;
  let current: string | null = boardId;
  for (let depth = 0; current && depth < 32; depth++) {
    if (current === link.targetId) return true;
    const [b] = await db().select({ parent: boards.parentBoardId, ws: boards.workspaceId }).from(boards).where(eq(boards.id, current));
    if (!b || b.ws !== link.workspaceId) return false;
    current = b.parent;
  }
  return false;
}

export function guestActor(s: Extract<ShareState, { ok: true }>, need: "favorite" | "comment"): Actor {
  const perm = s.link.permission as SharePermission;
  if (need === "favorite" && !canFavorite(perm)) throw new HttpError(403, "This link is view-only.");
  if (need === "comment" && !canComment(perm)) throw new HttpError(403, "This link doesn't allow comments.");
  if (!s.guest) throw new HttpError(401, "Tell us your name first.");
  return { kind: "guest", guestId: s.guest.id, name: s.guest.name, workspaceId: s.link.workspaceId, link: s.link };
}

/* ---------- feedback ---------- */

async function assertOnBoard(workspaceId: string, boardId: string, referenceId: string) {
  const [hit] = await db()
    .select({ id: boardItems.id })
    .from(boardItems)
    .where(and(eq(boardItems.workspaceId, workspaceId), eq(boardItems.boardId, boardId), eq(boardItems.referenceId, referenceId)))
    .limit(1);
  if (!hit) throw new HttpError(404, "That reference isn't on this board.");
}

export function serializeComment(c: typeof comments.$inferSelect) {
  return {
    id: c.id,
    referenceId: c.referenceId,
    boardId: c.boardId,
    timecode: c.timecode,
    parentId: c.parentId,
    body: c.body,
    mentions: c.mentions,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    authorName: c.authorName,
    authorKind: c.authorGuestId ? ("guest" as const) : ("user" as const),
    createdAt: c.createdAt.toISOString(),
  };
}
export type CommentDTO = ReturnType<typeof serializeComment>;

export async function loadFeedback(workspaceId: string, boardId: string, actor?: { userId?: string; guestId?: string }) {
  const d = db();
  const [rows, favs] = await Promise.all([
    d.select().from(comments).where(and(eq(comments.workspaceId, workspaceId), eq(comments.boardId, boardId))).orderBy(asc(comments.createdAt)),
    d
      .select({ referenceId: favorites.referenceId, userId: favorites.userId, guestId: favorites.guestId })
      .from(favorites)
      .where(and(eq(favorites.workspaceId, workspaceId), eq(favorites.boardId, boardId))),
  ]);
  const fav: Record<string, { count: number; mine: boolean }> = {};
  for (const f of favs) {
    const e = (fav[f.referenceId] ??= { count: 0, mine: false });
    e.count++;
    if ((actor?.userId && f.userId === actor.userId) || (actor?.guestId && f.guestId === actor.guestId)) e.mine = true;
  }
  return { comments: rows.map(serializeComment), favorites: fav };
}
export type FeedbackData = Awaited<ReturnType<typeof loadFeedback>>;

async function logActivity(workspaceId: string, boardId: string, kind: string, actorName: string, payload: Record<string, unknown>) {
  const [entry] = await db().insert(activity).values({ workspaceId, boardId, kind, actorName, payload }).returning();
  const dto = { id: entry!.id, kind, actorName, payload, createdAt: entry!.createdAt.toISOString() };
  await publish(boardRoom(boardId), { type: "activity", entry: dto });
  return dto;
}

/** Workspace owners and editors hear about feedback they didn't write (email per their preference). */
async function notifyTeam(workspaceId: string, _boardId: string, exceptUserId: string | null, title: string, body: string, url: string) {
  const d = db();
  const team = await d
    .select({ id: users.id, email: users.email, mode: notificationPrefs.mode })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(notificationPrefs, eq(notificationPrefs.userId, users.id))
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.role, ["owner", "editor"])));
  for (const u of team) {
    if (u.id === exceptUserId) continue;
    const mode = u.mode ?? "immediate";
    if (mode === "off") continue;
    const [n] = await d.insert(notifications).values({ userId: u.id, kind: "feedback", payload: { title, body, url } }).returning({ id: notifications.id });
    if (mode === "immediate" && u.email) {
      await sendMail({ to: u.email, subject: title, text: `${body}\n\nOpen: ${url}` }).catch((err) => console.warn("[mail]", err.message));
      await d.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, n!.id));
    }
  }
}

function appUrl(path: string) {
  return `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

export async function addComment(actor: Actor, boardId: string, input: { referenceId: string; body: string; timecode?: number | null; parentId?: string | null }) {
  await assertOnBoard(actor.workspaceId, boardId, input.referenceId);
  if (input.parentId) {
    const [parent] = await db().select().from(comments).where(and(eq(comments.id, input.parentId), eq(comments.boardId, boardId)));
    if (!parent) throw new HttpError(404, "The comment you're replying to is gone.");
  }
  const [row] = await db()
    .insert(comments)
    .values({
      workspaceId: actor.workspaceId,
      boardId,
      referenceId: input.referenceId,
      timecode: input.timecode ?? null,
      parentId: input.parentId ?? null,
      body: input.body,
      mentions: parseMentions(input.body),
      authorUserId: actor.kind === "user" ? actor.userId : null,
      authorGuestId: actor.kind === "guest" ? actor.guestId : null,
      authorName: actor.name,
    })
    .returning();
  const dto = serializeComment(row!);
  await publish(boardRoom(boardId), { type: "comment", comment: dto });
  const [ref] = await db().execute<{ title: string }>(sql`select title from refs where id = ${input.referenceId}`);
  const where = ref?.title ?? "a reference";
  await logActivity(actor.workspaceId, boardId, "comment", actor.name, { referenceId: input.referenceId, title: where, timecode: dto.timecode, body: input.body.slice(0, 140) });
  await notifyTeam(
    actor.workspaceId,
    boardId,
    actor.kind === "user" ? actor.userId : null,
    `${actor.name} commented on ${where}`,
    `${actor.kind === "guest" ? `${actor.name} (guest)` : actor.name}: "${input.body}"`,
    appUrl(`/boards/${boardId}?ref=${input.referenceId}`),
  );
  return dto;
}

export async function setResolved(workspaceId: string, commentId: string, resolved: boolean) {
  const [row] = await db()
    .update(comments)
    .set({ resolvedAt: resolved ? new Date() : null })
    .where(and(eq(comments.id, commentId), eq(comments.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new HttpError(404, "Comment not found");
  const dto = serializeComment(row);
  if (row.boardId) await publish(boardRoom(row.boardId), { type: "comment-updated", comment: dto });
  return dto;
}

export async function toggleFavorite(actor: Actor, boardId: string, referenceId: string) {
  await assertOnBoard(actor.workspaceId, boardId, referenceId);
  const d = db();
  const who = actor.kind === "user" ? eq(favorites.userId, actor.userId) : eq(favorites.guestId, actor.guestId);
  const [existing] = await d.select({ id: favorites.id }).from(favorites).where(and(eq(favorites.boardId, boardId), eq(favorites.referenceId, referenceId), who));
  if (existing) await d.delete(favorites).where(eq(favorites.id, existing.id));
  else
    await d.insert(favorites).values({
      workspaceId: actor.workspaceId,
      boardId,
      referenceId,
      userId: actor.kind === "user" ? actor.userId : null,
      guestId: actor.kind === "guest" ? actor.guestId : null,
    });
  const [{ n }] = (await d
    .select({ n: sql<number>`count(*)::int` })
    .from(favorites)
    .where(and(eq(favorites.boardId, boardId), eq(favorites.referenceId, referenceId)))) as [{ n: number }];
  const on = !existing;
  await publish(boardRoom(boardId), { type: "favorite", referenceId, count: n, by: actor.name, on });
  if (on) {
    const [ref] = await db().execute<{ title: string }>(sql`select title from refs where id = ${referenceId}`);
    await logActivity(actor.workspaceId, boardId, "favorite", actor.name, { referenceId, title: ref?.title ?? "" });
  }
  return { on, count: n };
}

export async function recentActivity(workspaceId: string, boardId: string) {
  const rows = await db()
    .select()
    .from(activity)
    .where(and(eq(activity.workspaceId, workspaceId), eq(activity.boardId, boardId)))
    .orderBy(desc(activity.createdAt))
    .limit(50);
  return rows.map((r) => ({ id: r.id, kind: r.kind, actorName: r.actorName, payload: r.payload, createdAt: r.createdAt.toISOString() }));
}
export type ActivityDTO = Awaited<ReturnType<typeof recentActivity>>[number];

export { logActivity };

export function realtimeTicket(room: string, who: { id: string; name: string; kind: "user" | "guest" }) {
  return {
    url: process.env.REALTIME_PUBLIC_URL || "ws://localhost:3001",
    ticket: sign({ room, ...who, exp: Date.now() + 10 * 60_000 }, "realtime"),
  };
}
