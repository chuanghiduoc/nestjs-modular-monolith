import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOKEN_BYTES = 32;

/**
 * A one-time secret to put in a link. base64url so it survives a query string
 * without escaping.
 */
export function newSecretToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * The stable, non-reversible handle for a secret: safe as a database column, a
 * Redis key or an idempotency key, useless to whoever reads it.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Compares two strings without leaking, through timing, how much of the prefix
 * matched. Different lengths answer false rather than throwing.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}
