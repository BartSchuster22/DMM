import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const params = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p }).toString('hex');
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt}$${derived}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, n, r, p, salt, expectedHex] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, Buffer.from(expectedHex, 'hex').length, { N: Number(n), r: Number(r), p: Number(p) });
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
