import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== ''),
);

export const envBaseSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  DATABASE_URL: z.string().min(1),

  DATABASE_DIRECT_URL: z.string().optional(),

  // A pool of zero is not "unlimited", it is a process that blocks on its first
  // query and never recovers.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  DB_PASSWORD_FILE: z.string().optional(),

  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  REDIS_URL: z.url(),

  // Every role exposes /metrics, not just the API: the outbox and queue gauges
  // live in the scheduler and worker, and an alert cannot fire on a series no
  // process ever publishes.
  METRICS_ALLOW_CIDRS: csv.pipe(z.array(z.string().min(1))).default([]),
  METRICS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(10),
});

export type EnvBase = z.infer<typeof envBaseSchema>;
