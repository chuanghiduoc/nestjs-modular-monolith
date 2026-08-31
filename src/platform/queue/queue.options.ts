export interface QueueModuleOptions {
  readonly redisUrl: string;
  readonly applicationName: string;

  readonly concurrency: number;

  readonly startWorkers: boolean;

  readonly registerSchedules: boolean;

  readonly shutdownTimeoutMs: number;
}

export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000;
