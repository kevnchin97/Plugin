import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

/** Compact signed token: base64url(JSON payload) "." base64url(HMAC-SHA256 over purpose + payload). */
export function sign<T extends object>(payload: T, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(`${purpose}.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

/** Returns the payload if the signature matches this purpose and it hasn't expired (`exp`, ms). */
export function verify<T>(token: string | undefined | null, purpose: string): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(`${purpose}.${body}`).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface RealtimeTicket {
  /** e.g. "board:<uuid>" */
  room: string;
  /** Stable id for presence: a user id or a guest id. */
  id: string;
  name: string;
  kind: "user" | "guest";
  exp: number;
}
