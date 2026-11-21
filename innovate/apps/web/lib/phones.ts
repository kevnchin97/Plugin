import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, boards, eq, isNotNull, memberships, phoneNumbers, type PhoneNumber } from "@innovate/db";
import { hashPassword, verifyPassword } from "@innovate/shared/passwords";
import { rateLimit } from "@innovate/shared/realtime";
import { sendText } from "@innovate/shared/twilio";
import { HttpError } from "./api";
import { db } from "./server";

/** SPEC §5.3 text-to-save: links texted from a verified number land on this board. */
export const INBOX_BOARD = "Inbox from text";
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export const phoneDto = (p: PhoneNumber) => ({ id: p.id, phone: p.phone, verified: Boolean(p.verifiedAt), createdAt: p.createdAt.toISOString() });

export async function listPhones(userId: string) {
  const rows = await db().select().from(phoneNumbers).where(eq(phoneNumbers.userId, userId)).orderBy(asc(phoneNumbers.createdAt));
  return rows.map(phoneDto);
}

/** Start (or restart) verification: a 6-digit code by SMS (or WhatsApp), valid 10 minutes. */
export async function startVerification(ctx: { userId: string; workspaceId: string }, phone: string, channel: "sms" | "whatsapp") {
  if (!(await rateLimit(`phone-code:${ctx.userId}`, 5, 3600))) throw new HttpError(429, "Too many codes requested. Try again in an hour.");
  const [existing] = await db().select().from(phoneNumbers).where(eq(phoneNumbers.phone, phone));
  if (existing?.verifiedAt && existing.userId !== ctx.userId) throw new HttpError(409, "That number is already connected to another account.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = { userId: ctx.userId, workspaceId: ctx.workspaceId, phone, codeHash: await hashPassword(code), codeExpiresAt: new Date(Date.now() + CODE_TTL_MS), attempts: 0 };
  const [row] = await db()
    .insert(phoneNumbers)
    .values(values)
    .onConflictDoUpdate({ target: phoneNumbers.phone, set: { ...values, verifiedAt: existing?.userId === ctx.userId ? existing.verifiedAt : null, updatedAt: new Date() } })
    .returning();
  await sendText(channel === "whatsapp" ? `whatsapp:${phone}` : phone, `Your Innovate code is ${code}. It expires in 10 minutes.`);
  return phoneDto(row!);
}

export async function confirmVerification(userId: string, phone: string, code: string) {
  const [row] = await db().select().from(phoneNumbers).where(and(eq(phoneNumbers.phone, phone), eq(phoneNumbers.userId, userId)));
  if (!row?.codeHash || !row.codeExpiresAt) throw new HttpError(400, "Request a code for that number first.");
  if (row.codeExpiresAt < new Date()) throw new HttpError(400, "That code expired. Send a new one.");
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Too many wrong codes. Send a new one.");
  if (!(await verifyPassword(code.trim(), row.codeHash))) {
    await db().update(phoneNumbers).set({ attempts: row.attempts + 1 }).where(eq(phoneNumbers.id, row.id));
    throw new HttpError(400, "That code isn't right.");
  }
  const [done] = await db().update(phoneNumbers).set({ verifiedAt: new Date(), codeHash: null, codeExpiresAt: null, attempts: 0 }).where(eq(phoneNumbers.id, row.id)).returning();
  return phoneDto(done!);
}

export async function removePhone(userId: string, id: string) {
  const [row] = await db().delete(phoneNumbers).where(and(eq(phoneNumbers.id, id), eq(phoneNumbers.userId, userId))).returning({ id: phoneNumbers.id });
  if (!row) throw new HttpError(404, "That number isn't connected.");
}

/** The verified owner of a number, if they still belong to the workspace it was verified in. */
export async function ownerOf(phone: string) {
  const [row] = await db()
    .select({ userId: phoneNumbers.userId, workspaceId: phoneNumbers.workspaceId })
    .from(phoneNumbers)
    .innerJoin(memberships, and(eq(memberships.userId, phoneNumbers.userId), eq(memberships.workspaceId, phoneNumbers.workspaceId)))
    .where(and(eq(phoneNumbers.phone, phone), isNotNull(phoneNumbers.verifiedAt)));
  return row ?? null;
}

/** The workspace's "Inbox from text" board, created on first use. */
export async function inboxBoard(workspaceId: string, userId: string) {
  const [found] = await db()
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), eq(boards.title, INBOX_BOARD)))
    .orderBy(asc(boards.createdAt))
    .limit(1);
  if (found) return found.id;
  const [b] = await db().insert(boards).values({ workspaceId, title: INBOX_BOARD, createdBy: userId }).returning({ id: boards.id });
  return b!.id;
}
