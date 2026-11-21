import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@innovate/shared/twilio";
import { HttpError, parseJson, route } from "@/lib/api";
import { confirmVerification, listPhones, startVerification } from "@/lib/phones";
import { requireApiSession } from "@/lib/session";

const phoneField = z.string().max(40).transform((v, c) => {
  const p = normalizePhone(v);
  if (!p) c.addIssue({ code: "custom", message: "Use the full international number, starting with + and the country code." });
  return p ?? "";
});

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ phones: await listPhones(ctx.userId), textTo: process.env.TWILIO_PHONE_NUMBER || null, whatsappTo: process.env.TWILIO_WHATSAPP_NUMBER || null });
});

/** Send a verification code to a number. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const { phone, channel } = await parseJson(req, z.object({ phone: phoneField, channel: z.enum(["sms", "whatsapp"]).default("sms") }));
  return NextResponse.json({ phone: await startVerification(ctx, phone, channel) }, { status: 201 });
});

/** Confirm the code. */
export const PUT = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const { phone, code } = await parseJson(req, z.object({ phone: phoneField, code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits.") }));
  if (!phone) throw new HttpError(400, "Enter the number you verified.");
  return NextResponse.json({ phone: await confirmVerification(ctx.userId, phone, code) });
});
