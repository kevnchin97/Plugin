import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@innovate/shared/passwords";
import { rateLimit } from "@innovate/shared/realtime";
import { HttpError, parseJson, route } from "@/lib/api";
import { resolveShare, setUnlocked } from "@/lib/feedback";

/** Check a share password. 10 attempts per 15 minutes per link and address. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";
  if (!(await rateLimit(`unlock:${token}:${ip}`, 10, 15 * 60))) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
  const s = await resolveShare(token);
  if (!s.ok) throw new HttpError(404, "This link isn't available.");
  const { password } = await parseJson(req, z.object({ password: z.string().min(1).max(200) }));
  if (s.link.passwordHash && !(await verifyPassword(password, s.link.passwordHash))) throw new HttpError(401, "That password isn't right.");
  await setUnlocked(s.link);
  return NextResponse.json({ ok: true });
});
