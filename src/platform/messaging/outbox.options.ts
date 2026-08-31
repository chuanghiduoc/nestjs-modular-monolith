export interface OutboxModuleOptions {
  readonly drainBatchSize: number;

  readonly drainIntervalSeconds: number;
  readonly retentionDays: number;
}

export const OUTBOX_OPTIONS = Symbol('OUTBOX_OPTIONS');
