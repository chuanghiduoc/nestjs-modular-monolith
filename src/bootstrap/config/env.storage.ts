import { z } from 'zod';

export const envStorageSchema = z.object({
  // `local` keeps uploads on disk and needs no object storage running; the S3_*
  // values below are still parsed but unused. `s3-presigned` is the production
  // driver.
  FILE_DRIVER: z.enum(['s3-presigned', 'local']).default('s3-presigned'),

  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),

  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
});

export type EnvStorage = z.infer<typeof envStorageSchema>;
