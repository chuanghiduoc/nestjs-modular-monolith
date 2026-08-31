import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';

import {
  CORRELATION_ID_HEADER,
  ensureRequestIds,
  REQUEST_ID_HEADER,
} from '#platform/observability';
import { ERROR_CODES } from '#shared/errors';

import { buildProblemDetails } from '../http/problem-details';

export interface FastifyPluginOptions {
  readonly corsOrigins: readonly string[];

  readonly redis: Redis;
  readonly globalRateLimit: { readonly max: number; readonly timeWindowMs: number };
  readonly trustInboundRequestId: boolean;
}

export async function registerFastifyPlugins(
  instance: FastifyInstance,
  options: FastifyPluginOptions,
): Promise<void> {
  instance.addHook('onRequest', (request, reply, done) => {
    const ids = ensureRequestIds(request.raw, {
      trustInboundRequestId: options.trustInboundRequestId,
    });

    void reply.header(REQUEST_ID_HEADER, ids.requestId);
    void reply.header(CORRELATION_ID_HEADER, ids.correlationId);
    done();
  });

  await instance.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },

    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await instance.register(cors, {
    origin: [...options.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposedHeaders: [REQUEST_ID_HEADER, CORRELATION_ID_HEADER, 'retry-after'],
    allowedHeaders: ['content-type', CORRELATION_ID_HEADER, 'x-organization-id'],
    maxAge: 600,
  });

  await instance.register(rateLimit, {
    global: true,
    max: options.globalRateLimit.max,
    timeWindow: options.globalRateLimit.timeWindowMs,

    redis: options.redis,

    skipOnError: true,

    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },

    errorResponseBuilder: (request, context) => {
      const { requestId } = ensureRequestIds(request.raw);

      return buildProblemDetails({
        status: 429,
        code: ERROR_CODES.RATE_LIMITED,
        detail: `Rate limit exceeded. Retry in ${String(Math.ceil(context.ttl / 1000))} seconds.`,
        instance: request.url.split('?')[0] ?? request.url,
        requestId,
      });
    },
  });
}
