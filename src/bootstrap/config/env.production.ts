import type { z } from 'zod';

import type { EnvApi } from './env.api';
import type { EnvScheduler } from './env.scheduler';
import type { EnvWorker } from './env.worker';

const HTTPS_SCHEME = 'https://';
const HTTPS_ONLY_KEYS = ['BETTER_AUTH_URL', 'FRONTEND_BASE_URL'] as const;

const FORBIDDEN_SECRET_SUBSTRINGS = [
  'changeme',
  'change-me',
  'placeholder',
  'example',
  'development',
  'insecure',
  'password',
  'secret-key',
  'your-secret',
];

export function refineApiForProduction(env: EnvApi, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const secret = env.BETTER_AUTH_SECRET.toLowerCase();
  const placeholder = FORBIDDEN_SECRET_SUBSTRINGS.find((word) => secret.includes(word));

  if (placeholder !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['BETTER_AUTH_SECRET'],
      message: `must not contain "${placeholder}" in production — every session depends on it`,
    });
  }

  refineMetricsExposure(env, ctx);

  for (const origin of env.CORS_ORIGINS) {
    if (origin === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'a wildcard origin is incompatible with credentialed cookie sessions',
      });
    }
  }

  if (!env.CORS_ORIGINS.includes(env.FRONTEND_BASE_URL)) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'must include FRONTEND_BASE_URL, or every browser request is rejected',
    });
  }

  for (const key of HTTPS_ONLY_KEYS) {
    if (!env[key].startsWith(HTTPS_SCHEME)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          'must be https in production: session cookies are issued Secure, and a browser never sends those over http',
      });
    }
  }

  for (const origin of env.CORS_ORIGINS) {
    if (origin !== '*' && !origin.startsWith(HTTPS_SCHEME)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `${origin} cannot send a Secure cookie — an http origin is a broken login, not a relaxed one`,
      });
    }
  }

  if (env.TRUST_INBOUND_REQUEST_ID && !env.TRUST_PROXY) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_INBOUND_REQUEST_ID'],
      message:
        'trusts a header from a caller that is not behind a trusted proxy — anyone could forge the id every log line is correlated by',
    });
  }

  if (env.DEPLOYMENT_TOPOLOGY === 'behind-proxy' && !env.TRUST_PROXY) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_PROXY'],
      message:
        'must be true behind a proxy: every request would otherwise arrive with the balancer address, so the whole deployment shares one rate-limit bucket and locks itself out',
    });
  }

  if (env.DEPLOYMENT_TOPOLOGY === 'direct' && env.TRUST_PROXY) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUST_PROXY'],
      message:
        'must be false when clients connect directly: trusting X-Forwarded-For from an arbitrary caller lets anyone spoof their address past the rate limiter',
    });
  }
}

function refineMetricsExposure(
  env: { readonly METRICS_ALLOW_CIDRS: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  if (env.METRICS_ALLOW_CIDRS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['METRICS_ALLOW_CIDRS'],
      message: 'must list at least one CIDR in production — an empty allow-list fails closed',
    });
  }
}

export function refineWorkerForProduction(env: EnvWorker, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  refineMetricsExposure(env, ctx);

  if (env.MAIL_HOST === 'localhost' || env.MAIL_HOST === '127.0.0.1') {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_HOST'],
      message: 'points at the container itself in production — no mail would ever leave',
    });
  }

  if (env.FRONTEND_BASE_URL === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['FRONTEND_BASE_URL'],
      message: 'is required in production: email links have nowhere else to point',
    });
  }
}

export function refineSchedulerForProduction(env: EnvScheduler, ctx: z.RefinementCtx): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  refineMetricsExposure(env, ctx);

  if (env.OUTBOX_DRAIN_INTERVAL_SECONDS > 60) {
    ctx.addIssue({
      code: 'custom',
      path: ['OUTBOX_DRAIN_INTERVAL_SECONDS'],
      message: 'above 60s the p95 < 30s dispatch target cannot be met',
    });
  }
}
