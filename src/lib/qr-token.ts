import { createHmac, timingSafeEqual } from "node:crypto";
const TTL_SECONDS = 15 * 60;
export function signQrToken(code: string, secret: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + TTL_SECONDS;
  return `${expires}.${createHmac("sha256", secret).update(`${code}:${expires}`).digest("base64url")}`;
}
export function verifyQrToken(
  code: string,
  token: string,
  secret: string,
  now = Date.now(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2 || !/^\d{10}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]))
    return false;
  const expires = Number(parts[0]);
  if (expires < Math.floor(now / 1000) || expires > Math.floor(now / 1000) + TTL_SECONDS)
    return false;
  const expected = createHmac("sha256", secret).update(`${code}:${expires}`).digest();
  const actual = Buffer.from(parts[1], "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
