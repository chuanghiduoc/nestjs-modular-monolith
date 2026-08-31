import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';

import {
  DEFAULT_TRANSACTION_MAX_WAIT_MS,
  DEFAULT_TRANSACTION_TIMEOUT_MS,
  PrismaService,
} from '#platform/prisma';

const POSTGRES_IMAGE = 'postgres:18-alpine';
const REDIS_IMAGE = 'redis:8-alpine';

const DATABASE = 'app_test';
const USERNAME = 'app';
const PASSWORD = 'app';

const REPO_ROOT = process.cwd();

const PRISMA_CLI = join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js');

const MANAGED_SCHEMAS = [
  'auth',
  'users',
  'audit',
  'upload',
  'messaging',
  'tenancy',
  'billing',
] as const;

export interface TestDatabase {
  readonly connectionString: string;
  readonly redisUrl: string;
  readonly cleaner: DatabaseCleaner;
  stop(): Promise<void>;
}

export class DatabaseCleaner {
  private readonly pool: Pool;
  private tables: readonly string[] | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 1 });
  }

  async truncateAll(): Promise<void> {
    const tables = this.tables ?? (await this.loadTables());

    if (tables.length === 0) {
      return;
    }

    await this.pool.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    const { rows } = await this.pool.query<T>(sql, values);

    return rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async loadTables(): Promise<readonly string[]> {
    const rows = await this.query<{ qualified: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS qualified
         FROM pg_tables
        WHERE schemaname = ANY($1::text[])`,
      [[...MANAGED_SCHEMAS]],
    );

    this.tables = rows.map((row) => row.qualified);

    return this.tables;
  }
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE)
    .withUsername(USERNAME)
    .withPassword(PASSWORD)
    .start();
  let redis: Awaited<ReturnType<RedisContainer['start']>>;
  try {
    redis = await new RedisContainer(REDIS_IMAGE).start();
  } catch (error) {
    await container.stop();
    throw error;
  }

  const connectionString = `postgresql://${USERNAME}:${PASSWORD}@${container.getHost()}:${String(
    container.getPort(),
  )}/${DATABASE}`;

  try {
    await applyMigrations(connectionString);
  } catch (error) {
    await redis.stop();
    await container.stop();
    throw error;
  }

  const cleaner = new DatabaseCleaner(connectionString);

  let stopped = false;

  return {
    connectionString,
    redisUrl: redis.getConnectionUrl(),
    cleaner,
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }

      stopped = true;

      await cleaner.close();
      await container.stop();
      await redis.stop();
    },
  };
}

async function applyMigrations(connectionString: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        DATABASE_DIRECT_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();

        return;
      }

      reject(new Error(`prisma migrate deploy exited with ${String(code)}:\n${output}`));
    });
  });
}

export function createTestPrismaService(connectionString: string): PrismaService {
  return new PrismaService({
    connectionString,
    poolMax: 5,
    applicationName: 'integration-test',
    transactionTimeoutMs: DEFAULT_TRANSACTION_TIMEOUT_MS,
    statementTimeoutMs: 30_000,
    idleTimeoutMs: 10_000,
    connectTimeoutMs: 5_000,
    transactionMaxWaitMs: DEFAULT_TRANSACTION_MAX_WAIT_MS,
  });
}
