import { z } from 'zod';

import { sha256Hex } from '#shared/util';

export const AUTH_MAIL_KINDS = ['verify-email', 'reset-password', 'delete-account'] as const;

/**
 * The queue payload deliberately carries no bare credential.
 *
 * `url` still embeds the token, because the worker cannot compose the email
 * without it — that is inherent to sending a link by mail. What the payload
 * must not do is duplicate the credential into a second field, and what the
 * broker must not do is keep it around: the auth mail queue drops completed
 * jobs immediately and retains failed ones only briefly, and the deduplication
 * key is derived from a digest so the token never appears in a Redis key name.
 */
export const authMailPayloadSchema = z.object({
  kind: z.enum(AUTH_MAIL_KINDS),
  to: z.email(),

  url: z.url(),

  tokenDigest: z.string().length(64),
});

export type AuthMailPayload = z.infer<typeof authMailPayloadSchema>;
export type AuthMailKind = (typeof AUTH_MAIL_KINDS)[number];

const FRONTEND_PATHS: Record<AuthMailKind, string> = {
  'verify-email': '/verify-email',
  'reset-password': '/reset',
  'delete-account': '/delete-account',
};

/**
 * A stable, non-reversible handle for one token: safe to use as a Redis key and
 * as an idempotency key, useless to anyone who reads it.
 */
export function digestAuthToken(token: string): string {
  return sha256Hex(token);
}

export function buildFrontendTokenUrl(
  frontendBaseUrl: string,
  kind: AuthMailKind,
  token: string,
): string {
  const url = new URL(FRONTEND_PATHS[kind], frontendBaseUrl);
  url.searchParams.set('token', token);

  return url.toString();
}
