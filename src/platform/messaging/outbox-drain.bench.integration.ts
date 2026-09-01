import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INTEGRATION_EVENTS } from '#contracts/events';
import type { PrismaService } from '#platform/prisma';
import { BullMqEventPublisher, type BullMqService } from '#platform/queue';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/support/database';
import { createTestQueue } from '../../../test/support/queue';
import type { OutboxModuleOptions } from './outbox.options';
import { OutboxDrainService } from './outbox-drain.service';

const RUN_BENCH = process.env.OUTBOX_BENCH === '1';
const SEED_COUNT = Number(process.env.OUTBOX_BENCH_EVENTS ?? '2000');
const INSERT_CHUNK = 500;

const PRODUCTION_DEFAULTS: OutboxModuleOptions = {
  drainBatchSize: 100,
  drainIntervalSeconds: 10,
  retentionDays: 14,
};

describe.runIf(RUN_BENCH)('OutboxDrainService capacity (bench)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let queue: BullMqService;
  let drain: OutboxDrainService;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();

    queue = createTestQueue(database.redisUrl);
    await queue.onModuleInit();

    drain = new OutboxDrainService(
      prisma,
      new BullMqEventPublisher(queue),
      queue,
      PRODUCTION_DEFAULTS,
    );
  });

  afterAll(async () => {
    await queue?.onModuleDestroy();
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  it(
    `settles a backlog of ${String(SEED_COUNT)} events and reports throughput`,
    { timeout: 600_000 },
    async () => {
      await seedBacklog(SEED_COUNT);
      await expect(drain.countUndrained()).resolves.toBe(SEED_COUNT);

      const startedAt = performance.now();
      let settled = 0;

      while (settled < SEED_COUNT) {
        const drained = await drain.drainUntilIdle();

        if (drained === 0) break;
        settled += drained;
      }

      const seconds = (performance.now() - startedAt) / 1000;

      expect(settled).toBe(SEED_COUNT);
      await expect(drain.countUndrained()).resolves.toBe(0);
      await expect(drain.countQuarantined()).resolves.toBe(0);

      process.stdout.write(
        [
          'outbox bench:',
          `events=${String(SEED_COUNT)}`,
          `batchSize=${String(PRODUCTION_DEFAULTS.drainBatchSize)}`,
          `seconds=${seconds.toFixed(2)}`,
          `events/sec=${(SEED_COUNT / seconds).toFixed(1)}`,
        ].join(' ') + '\n',
      );
    },
  );

  async function seedBacklog(count: number): Promise<void> {
    for (let offset = 0; offset < count; offset += INSERT_CHUNK) {
      const size = Math.min(INSERT_CHUNK, count - offset);
      const values: string[] = [];
      const params: unknown[] = [];

      for (let index = 0; index < size; index += 1) {
        const base = index * 2;
        values.push(
          `($${String(base + 1)}, now(), '${INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED}', 1, $${String(base + 2)}::jsonb)`,
        );
        params.push(newId(), JSON.stringify({ organizationId: newId(), actorId: newId() }));
      }

      await database.cleaner.query(
        `INSERT INTO messaging.outbox_events (event_id, occurred_at, event_name, schema_version, payload)
         VALUES ${values.join(', ')}`,
        params,
      );
    }
  }
});
