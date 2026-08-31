export interface PrismaModuleOptions {
  readonly connectionString: string;

  readonly poolMax: number;

  readonly applicationName: string;

  readonly transactionTimeoutMs: number;

  readonly transactionMaxWaitMs: number;
  readonly statementTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly connectTimeoutMs: number;
}

export const PRISMA_OPTIONS = Symbol('PRISMA_OPTIONS');

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 10_000;
export const DEFAULT_TRANSACTION_MAX_WAIT_MS = 5_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
