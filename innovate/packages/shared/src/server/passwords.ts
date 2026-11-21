import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

type Scrypt = (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

const scrypt: Scrypt = (pw, salt, keylen, opts) =>
  new Promise((resolve, reject) => scryptCb(pw, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));

const COST = 16384;

/** Stored as "scrypt:N:salt:hash" (base64url). Share-link passwords are never stored in plain text. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, { N: COST, r: 8, p: 1 });
  return ["scrypt", COST, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split(":");
  if (alg !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: 8, p: 1 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
