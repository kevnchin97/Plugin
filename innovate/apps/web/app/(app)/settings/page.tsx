import { and, apiTokens, desc, eq, isNull, notificationPrefs } from "@innovate/db";
import { Settings } from "@/components/settings/Settings";
import { listPhones } from "@/lib/phones";
import { db } from "@/lib/server";
import { requirePageSession } from "@/lib/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requirePageSession();
  const [tokens, [pref], phoneList] = await Promise.all([
    db().select().from(apiTokens).where(and(eq(apiTokens.userId, ctx.userId), isNull(apiTokens.revokedAt))).orderBy(desc(apiTokens.createdAt)),
    db().select().from(notificationPrefs).where(eq(notificationPrefs.userId, ctx.userId)),
    listPhones(ctx.userId),
  ]);
  return (
    <Settings
      email={ctx.user.email ?? ""}
      appUrl={process.env.AUTH_URL ?? "http://localhost:3000"}
      mode={pref?.mode ?? "immediate"}
      phones={{ list: phoneList, textTo: process.env.TWILIO_PHONE_NUMBER || null, whatsappTo: process.env.TWILIO_WHATSAPP_NUMBER || null }}
      tokens={tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString() }))}
    />
  );
}
