export interface AuthRetentionOptions {
  readonly expiredSessionGraceHours: number;
  readonly batchSize: number;
}

export const AUTH_RETENTION_OPTIONS = Symbol('AUTH_RETENTION_OPTIONS');

export const DEFAULT_EXPIRED_SESSION_GRACE_HOURS = 24;
export const DEFAULT_AUTH_PRUNE_BATCH_SIZE = 5_000;
