import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const mailLog = join(mkdtempSync(join(tmpdir(), "innovate-mail-")), "mail.log");
process.env.MAIL_LOG_FILE = mailLog;

const { closeDb, eq, notificationPrefs, notifications, users } = await import("@innovate/db");
const { db } = await import("../src/context");
const { sendDigests } = await import("../src/jobs/digest");

describe("daily digest", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("sends one email per digest user and never twice", async () => {
    const email = `digest-${Date.now()}@innovate.local`;
    const [u] = await db.insert(users).values({ email, name: "Digest" }).returning();
    await db.insert(notificationPrefs).values({ userId: u!.id, mode: "digest" });
    await db.insert(notifications).values([
      { userId: u!.id, kind: "feedback", payload: { title: "Ana commented on Slow push-in", body: "Ana (guest): \"love the drift\"", url: "http://x/1" } },
      { userId: u!.id, kind: "feedback", payload: { title: "Ben favorited Dusk falloff", body: "", url: "http://x/2" } },
    ]);
    await sendDigests();
    const sent = existsSync(mailLog) ? readFileSync(mailLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.to === email) : [];
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("2 updates");
    expect(sent[0].text).toContain("Slow push-in");
    const left = await db.select().from(notifications).where(eq(notifications.userId, u!.id));
    expect(left.every((n) => n.emailedAt)).toBe(true);
    await sendDigests();
    const again = readFileSync(mailLog, "utf8").trim().split("\n").filter((l) => l.includes(email));
    expect(again).toHaveLength(1);
    await db.delete(users).where(eq(users.id, u!.id));
  });
});
