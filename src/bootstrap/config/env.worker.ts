import { z } from 'zod';

import { envBaseSchema } from './env.base';
import { envStorageSchema } from './env.storage';

export const envWorkerSchema = envBaseSchema.extend(envStorageSchema.shape).extend({
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),

  FRONTEND_BASE_URL: z.url().optional(),

  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.email(),

  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(365),

  UPLOAD_MAX_FILE_BYTES: z.coerce.number().int().min(1).default(10_485_760),
});

export type EnvWorker = z.infer<typeof envWorkerSchema>;
