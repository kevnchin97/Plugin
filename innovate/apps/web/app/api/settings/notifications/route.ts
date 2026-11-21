import { NextResponse } from "next/server";
import { notificationPrefs } from "@innovate/db";
import { notificationPrefSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

export const PUT = route(async (req: Request) => {
  const ctx = await requireApiSession();
  const { mode } = await parseJson(req, notificationPrefSchema);
  await db().insert(notificationPrefs).values({ userId: ctx.userId, mode }).onConflictDoUpdate({ target: notificationPrefs.userId, set: { mode } });
  return NextResponse.json({ mode });
});
