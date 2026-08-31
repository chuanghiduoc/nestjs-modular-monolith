import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { type EnvApi, envApiSchema } from './env.api';
import {
  refineApiForProduction,
  refineSchedulerForProduction,
  refineWorkerForProduction,
} from './env.production';
import { type EnvScheduler, envSchedulerSchema } from './env.scheduler';
import { type EnvWorker, envWorkerSchema } from './env.worker';

export type Role = 'api' | 'worker' | 'scheduler';

export interface EnvByRole {
  api: EnvApi;
  worker: EnvWorker;
  scheduler: EnvScheduler;
}

const SCHEMAS = {
  api: envApiSchema.superRefine(refineApiForProduction),
  worker: envWorkerSchema.superRefine(refineWorkerForProduction),
  scheduler: envSchedulerSchema.superRefine(refineSchedulerForProduction),
} as const;

export function injectDatabasePassword(dsn: string, password: string): string {
  const url = new URL(dsn);
  url.password = encodeURIComponent(password);

  return url.toString();
}

function applyPasswordFile<T extends { DATABASE_URL: string; DATABASE_DIRECT_URL?: string }>(
  env: T,
  passwordFile: string | undefined,
): T {
  if (passwordFile === undefined || passwordFile === '') {
    return env;
  }

  const password = readFileSync(passwordFile, 'utf8').trim();

  return {
    ...env,
    DATABASE_URL: injectDatabasePassword(env.DATABASE_URL, password),
    ...(env.DATABASE_DIRECT_URL === undefined || env.DATABASE_DIRECT_URL === ''
      ? {}
      : { DATABASE_DIRECT_URL: injectDatabasePassword(env.DATABASE_DIRECT_URL, password) }),
  };
}

export class EnvValidationError extends Error {
  constructor(
    readonly role: Role,
    readonly issues: string,
  ) {
    super(`Invalid environment for role "${role}":\n${issues}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv<R extends Role>(
  role: R,
  source: NodeJS.ProcessEnv = process.env,
): EnvByRole[R] {
  const result = SCHEMAS[role].safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(role, z.prettifyError(result.error));
  }

  return applyPasswordFile(result.data as EnvByRole[R], result.data.DB_PASSWORD_FILE);
}

export function loadEnvOrExit<R extends Role>(role: R): EnvByRole[R] {
  try {
    return loadEnv(role);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
