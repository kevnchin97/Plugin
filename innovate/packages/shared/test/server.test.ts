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
