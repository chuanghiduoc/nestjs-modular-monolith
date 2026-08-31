import { z } from 'zod';

import { envBaseSchema } from './env.base';
import { envStorageSchema } from './env.storage';

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== ''),
);

export const envApiSchema = envBaseSchema.extend(envStorageSchema.shape).extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z.string().min(1).default('api'),

  CORS_ORIGINS: csv.pipe(z.array(z.url()).min(1)),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  FRONTEND_BASE_URL: z.url(),

  HTTP_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

  TRUST_INBOUND_REQUEST_ID: z.stringbool().default(false),

  /**
   * Where this process sits relative to the client. Rate limiting, request
   * logging and the metrics allow-list all read a peer address, and behind a
   * load balancer that address belongs to the balancer, not the caller — one
   * shared bucket for the whole internet. Stating the topology lets the
   * production refinement reject a TRUST_PROXY that contradicts it instead of
   * letting the deployment discover it under load.
   */
  DEPLOYMENT_TOPOLOGY: z.enum(['direct', 'behind-proxy']).default('direct'),

  TRUST_PROXY: z.stringbool().default(false),

  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),

  AUTH_ACCOUNT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  AUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  AUTH_SESSION_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  AUTH_SESSION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),

  UPLOAD_MAX_FILE_BYTES: z.coerce.number().int().min(1).default(10_485_760),

  // Unset means the billing webhook endpoint refuses every call: an unsigned
  // payload is indistinguishable from an attacker's. Empty counts as unset —
  // that is how the env files spell it, the same convention MAIL_USER and
  // DATABASE_DIRECT_URL follow. Kept on one line so scripts/doctor.sh can read
  // "optional" straight off the declaration.
  BILLING_WEBHOOK_SECRET: z.string().min(32).or(z.literal('')).optional(),
});

export type EnvApi = z.infer<typeof envApiSchema>;
