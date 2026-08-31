export interface RedisModuleOptions {
  readonly url: string;

  readonly maxRetriesPerRequest: number;
  readonly connectTimeoutMs: number;
}

export const REDIS_OPTIONS = Symbol('REDIS_OPTIONS');

export const DEFAULT_MAX_RETRIES_PER_REQUEST = 2;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
