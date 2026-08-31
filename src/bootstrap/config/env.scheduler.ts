import { z } from 'zod';

import { envBaseSchema } from './env.base';

export const envSchedulerSchema = envBaseSchema.extend({
  OUTBOX_DRAIN_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(300).default(10),

  OUTBOX_DRAIN_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
});

export type EnvScheduler = z.infer<typeof envSchedulerSchema>;
