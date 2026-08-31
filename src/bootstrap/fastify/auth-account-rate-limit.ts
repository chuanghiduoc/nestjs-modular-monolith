import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { RateLimiterRedis, type RateLimiterRes } from 'rate-limiter-flexible';

import { ensureRequestIds } from '#platform/observability';
import { ERROR_CODES } from '#shared/errors';

import { buildProblemDetails, PROBLEM_CONTENT_TYPE } from '../http/problem-details';

const KEY_PREFIX = 'auth:account';
const MILLISECONDS_PER_SECOND = 1000;

export interface AuthAccountRateLimitOptions {
  readonly redis: Redis;
  readonly max: number;
  readonly timeWindowMs: number;
  readonly credentialPaths: readonly string[];
}

export function registerAuthAccountRateLimit(
  scope: FastifyInstance,
  options: AuthAccountRateLimitOptions,
): void {
  const limiter = new RateLimiterRedis({
    storeClient: options.redis,
    keyPrefix: KEY_PREFIX,
    points: options.max,
    duration: Math.ceil(options.timeWindowMs / MILLISECONDS_PER_SECOND),
    // A Redis outage must not close the door on sign-in. The per-IP bucket is a
    // separate plugin and still applies, so failing open here loses one of two
    // defences rather than the whole login surface.
    insuranceLimiter: undefined,
  });

  const guarded = new Set(options.credentialPaths);

  scope.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guarded.has(request.routeOptions.url ?? '')) {
      return;
    }

    const email = readEmail(request.body);

    if (email === null) {
      return;
    }

    try {
      await limiter.consume(hashEmail(email));
    } catch (rejection) {
      if (!isRateLimiterRes(rejection)) {
        request.log.warn({ msg: 'account rate limiter unavailable, failing open' });

        return;
      }

      await replyTooManyRequests(request, reply, rejection);
    }
  });
}

async function replyTooManyRequests(
  request: FastifyRequest,
  reply: FastifyReply,
  rejection: RateLimiterRes,
): Promise<void> {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(rejection.msBeforeNext / MILLISECONDS_PER_SECOND),
  );
  const { requestId } = ensureRequestIds(request.raw);

  await reply
    .status(429)
    .header('content-type', PROBLEM_CONTENT_TYPE)
    .header('retry-after', String(retryAfterSeconds))
    .send(
      buildProblemDetails({
        status: 429,
        code: ERROR_CODES.RATE_LIMITED,
        detail: `Too many attempts for this account. Retry in ${String(retryAfterSeconds)} seconds.`,
        instance: request.url.split('?')[0] ?? request.url,
        requestId,
      }),
    );
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function readEmail(body: unknown): string | null {
  const parsed = parseBody(body);

  if (parsed === null) {
    return null;
  }

  const email = parsed.email;

  return typeof email === 'string' && email.length > 0 ? email : null;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (Buffer.isBuffer(body)) {
    return parseJson(body.toString('utf8'));
  }

  if (typeof body === 'string') {
    return parseJson(body);
  }

  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);

    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isRateLimiterRes(value: unknown): value is RateLimiterRes {
  return typeof value === 'object' && value !== null && 'msBeforeNext' in value;
}
