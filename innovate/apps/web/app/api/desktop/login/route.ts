import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq, ensurePersonalWorkspace, sessions, users } from "@innovate/db";
import { db } from "@/lib/server";

/** The desktop app's one local account. */
const LOCAL_EMAIL = "you@innovate.local";
const SESSION_DAYS = 365;

/**
 * Desktop app sign-in: the app window opens this with the per-launch token it gave the server, and
 * gets a session for the local account (created on first launch). 404 everywhere else.
 */
export async function GET(req: Request) {
  const expected = process.env.INNOVATE_DESKTOP === "1" ? process.env.INNOVATE_DESKTOP_TOKEN : undefined;
  const url = new URL(req.url);
  const given = Buffer.from(url.searchParams.get("token") ?? "");
  if (!expected || given.length !== Buffer.byteLength(expected) || !timingSafeEqual(given, Buffer.from(expected)))
    return new NextResponse("Not found", { status: 404 });

  const d = db();
  let [user] = await d.select().from(users).where(eq(users.email, LOCAL_EMAIL));
  if (!user) {
    [user] = await d.insert(users).values({ email: LOCAL_EMAIL, name: "You", emailVerified: new Date() }).returning();
    await ensurePersonalWorkspace(d, user!.id, "You");
  }
  const sessionToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await d.insert(sessions).values({ sessionToken, userId: user!.id, expires });

  const next = url.searchParams.get("next");
  // Next sees the request as "localhost"; redirect to the origin the window actually uses, where the cookie is.
  const res = NextResponse.redirect(new URL(next?.startsWith("/") && !next.startsWith("//") ? next : "/", process.env.AUTH_URL ?? url));
  res.cookies.set("authjs.session-token", sessionToken, { httpOnly: true, sameSite: "lax", path: "/", expires });
  return res;
}
