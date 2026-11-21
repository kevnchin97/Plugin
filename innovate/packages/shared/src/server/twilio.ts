/**
 * Text-to-save over Twilio (SMS or WhatsApp): webhook signature checks, TwiML replies, and outgoing
 * messages (verification codes). Without Twilio credentials, outgoing messages are printed and
 * appended to SMS_LOG_FILE (development and e2e), like the dev mailer.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + each POST param name+value,
 * params sorted by name)). `url` must be exactly the URL Twilio was configured to call.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Element text only needs &, < and > escaped (quotes are fine, and stay readable in the SMS).
const escapeXml = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

/** A TwiML reply with one message (Twilio sends it back to the texter). */
export const twiml = (message: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;

/** "whatsapp:+44 7700 900123" → { phone: "+447700900123", channel: "whatsapp" }. Null if it isn't E.164-like. */
export function parseSender(from: string): { phone: string; channel: "sms" | "whatsapp" } | null {
  const channel = from.startsWith("whatsapp:") ? "whatsapp" : "sms";
  const phone = normalizePhone(from.replace(/^whatsapp:/, ""));
  return phone ? { phone, channel } : null;
}

/** E.164 with a leading +, digits only (8–15). Users type spaces, dashes and brackets. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("+")) return null;
  const digits = trimmed.slice(1).replace(/[\s().-]/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** Links in a text message (http(s) URLs, or bare domains like vimeo.com/123). */
export function linksIn(text: string): string[] {
  const found = new Set<string>();
  // Either an explicit http(s) URL (any host), or a bare domain with a path (so "e.g." or
  // "hi.there" in prose isn't taken for a link).
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/[^\s<>"]*/gi)) {
    let raw = m[0].replace(/[).,!?;:'"]+$/, "");
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    try {
      found.add(new URL(raw).toString());
    } catch {
      /* not a URL */
    }
  }
  return [...found].slice(0, 10);
}

/** Send an SMS (or WhatsApp message when `to` starts with "whatsapp:") via Twilio, or log it in dev. */
export async function sendText(to: string, body: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = to.startsWith("whatsapp:") ? env.TWILIO_WHATSAPP_NUMBER : env.TWILIO_PHONE_NUMBER;
  if (sid && token && from) {
    const base = env.TWILIO_API_BASE || "https://api.twilio.com";
    const res = await fetch(`${base}/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio couldn't send the message (HTTP ${res.status}).`);
    return;
  }
  console.log(`\n[sms] to ${to}: ${body}\n`);
  const log = env.SMS_LOG_FILE;
  if (log) {
    const file = isAbsolute(log) ? log : resolve(env.INNOVATE_ROOT ?? process.cwd(), log);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ to, body, at: new Date().toISOString() }) + "\n");
  }
}
