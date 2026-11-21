import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/server/passwords";
import { sign, verify } from "../src/server/signing";

process.env.AUTH_SECRET ??= "test-secret-test-secret";

describe("share passwords", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("winter-ad");
    expect(h).toMatch(/^scrypt:16384:/);
    expect(h).not.toContain("winter-ad");
    expect(await verifyPassword("winter-ad", h)).toBe(true);
    expect(await verifyPassword("winter-ae", h)).toBe(false);
  });
});

describe("signed tokens", () => {
  it("round-trips, rejects tampering, other purposes and expiry", () => {
    const t = sign({ room: "board:1", exp: Date.now() + 60_000 }, "rt");
    expect(verify<{ room: string }>(t, "rt")?.room).toBe("board:1");
    expect(verify(t, "guest")).toBeNull();
    expect(verify(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "rt")).toBeNull();
    expect(verify(sign({ exp: Date.now() - 1 }, "rt"), "rt")).toBeNull();
  });
});

describe("twilio", async () => {
  const { linksIn, normalizePhone, parseSender, twilioSignature, twiml, validTwilioSignature } = await import("../src/server/twilio");
  it("matches the signature test vector from Twilio's own SDK tests", () => {
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675309", Digits: "1234", From: "+14158675309", To: "+18005551212" };
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    expect(twilioSignature("12345", url, params)).toBe("RSOYDt4T1cUTdK1PDd93/VVr8B8=");
    expect(validTwilioSignature("12345", url, params, "RSOYDt4T1cUTdK1PDd93/VVr8B8=")).toBe(true);
    expect(validTwilioSignature("12345", url, { ...params, Digits: "9" }, "RSOYDt4T1cUTdK1PDd93/VVr8B8=")).toBe(false);
    expect(validTwilioSignature("12345", url, params, null)).toBe(false);
  });
  it("normalises numbers and senders", () => {
    expect(normalizePhone("+44 (0) 7700-900 123")).toBe("+4407700900123");
    expect(normalizePhone("07700 900123")).toBeNull();
    expect(parseSender("whatsapp:+14155550100")).toEqual({ phone: "+14155550100", channel: "whatsapp" });
    expect(parseSender("+14155550100")).toEqual({ phone: "+14155550100", channel: "sms" });
  });
  it("finds links in a text and escapes replies", () => {
    expect(linksIn("look at https://vimeo.com/123456, and vimeo.com/789 too! e.g. this. http://x.io/a.mp4")).toEqual(["https://vimeo.com/123456", "https://vimeo.com/789", "http://x.io/a.mp4"]);
    expect(linksIn("no links here, just words.")).toEqual([]);
    expect(linksIn("dev: http://localhost:3199/page.html.")).toEqual(["http://localhost:3199/page.html"]);
    expect(twiml("Saved <2> & done")).toContain("<Message>Saved &lt;2&gt; &amp; done</Message>");
  });
});
