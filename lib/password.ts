// scrypt from node:crypto; no bcrypt dependency needed. Format: scrypt$<salt>$<hash>, both base64url.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, KEYLEN).toString("base64url")}`;
}

export function verifyPassword(password: string, stored?: string | null) {
  const [scheme, salt, hash] = stored?.split("$") ?? [];
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(expected, actual);
}
