import { and, asc, eq, inArray, isNull, notificationPrefs, notifications, users } from "@innovate/db";
import { sendMail } from "@innovate/shared/mailer";
import { db } from "../context";

/**
 * One email per person in "digest" mode, listing their unsent notifications, oldest first.
 * Idempotent: notifications are marked emailed in the same pass, so a retry sends nothing twice.
 */
export async function sendDigests(): Promise<{ emails: number; notifications: number }> {
  const rows = await db
    .select({ id: notifications.id, userId: notifications.userId, payload: notifications.payload, email: users.email })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .innerJoin(notificationPrefs, eq(notificationPrefs.userId, notifications.userId))
    .where(and(eq(notificationPrefs.mode, "digest"), isNull(notifications.emailedAt)))
    .orderBy(asc(notifications.createdAt));
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  let emails = 0;
  for (const list of byUser.values()) {
    const email = list[0]!.email;
    if (!email) continue;
    const text = list.map((n) => `• ${n.payload.title}\n  ${n.payload.body}\n  ${n.payload.url}`).join("\n\n");
    await sendMail({ to: email, subject: `Innovate: ${list.length} update${list.length === 1 ? "" : "s"} since yesterday`, text });
    await db.update(notifications).set({ emailedAt: new Date() }).where(inArray(notifications.id, list.map((n) => n.id)));
    emails++;
  }
  return { emails, notifications: rows.length };
}
