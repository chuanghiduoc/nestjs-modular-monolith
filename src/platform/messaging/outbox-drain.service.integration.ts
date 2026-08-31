import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTEGRATION_EVENTS, parseIntegrationEvent } from '#contracts/events';
import type { PrismaService } from '#platform/prisma';
import {
  BullMqEventPublisher,
  type BullMqService,
  EVENT_SUBSCRIBERS,
  QUEUES,
} from '#platform/queue';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/support/database';
import { createTestQueue, sleep, waitFor } from '../../../test/support/queue';
import type { OutboxModuleOptions } from './outbox.options';
import { OutboxDrainService } from './outbox-drain.service';

const OPTIONS: OutboxModuleOptions = {
  drainBatchSize: 10,
  drainIntervalSeconds: 10,
  retentionDays: 14,
};

const SETTLE_MS = 500;

describe('OutboxDrainService (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let queue: BullMqService;
  let publisher: BullMqEventPublisher;
  let drain: OutboxDrainService;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();

    queue = createTestQueue(database.redisUrl);
    await queue.onModuleInit();

    publisher = new BullMqEventPublisher(queue);
    drain = new OutboxDrainService(prisma, publisher, queue, OPTIONS);
  });

  afterAll(async () => {
    await queue?.onModuleDestroy();
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
    await queue.deleteAllJobs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function registerUser(userId: string = newId()): Promise<string> {
    await prisma.db.user.create({
      data: {
        id: userId,
        name: 'Drain Subject',
        email: `${userId}@example.com`,
        emailVerified: false,
        role: 'member',
      },
    });

    return userId;
  }

  async function undrainedCount(): Promise<number> {
    return drain.countUndrained();
  }

  async function jobCount(name: string): Promise<number> {
    return (await queue.findJobs(name)).length;
  }

  it('turns a trigger-written row into one job per declared subscriber', async () => {
    const userId = await registerUser();

    await expect(drain.drainOnce()).resolves.toBe(1);

    const subscribers = EVENT_SUBSCRIBERS[INTEGRATION_EVENTS.USER_REGISTERED];

    for (const subscriber of subscribers) {
      await expect(jobCount(subscriber)).resolves.toBe(1);
    }

    const [job] = await queue.findJobs(QUEUES.AUDIT_RECORD_EVENT);
    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, job?.data);

    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    expect(parsed.data?.payload.userId).toBe(userId);

    await expect(undrainedCount()).resolves.toBe(0);
  });

  it('redelivers after an interruption between the send and the stamp, and the effect happens once', async () => {
    const handled: string[] = [];

    await queue.work(QUEUES.AUDIT_RECORD_EVENT, (job) => {
      if (job.id !== undefined) handled.push(job.id);

      return Promise.resolve();
    });

    try {
      await registerUser();

      const realDispatch = publisher.dispatch.bind(publisher);
      const publishSpy = vi.spyOn(publisher, 'dispatch');

      publishSpy.mockImplementationOnce(async (event) => {
        await realDispatch(event);
        throw new Error('process died before the drained_at stamp');
      });

      // The relay absorbs a per-event failure: nothing is stamped drained, the
      // claim is released, and the run reports that it settled nothing.
      await expect(drain.drainOnce()).resolves.toBe(0);

      await expect(jobCount(QUEUES.AUDIT_RECORD_EVENT)).resolves.toBe(1);
      await expect(undrainedCount()).resolves.toBe(1);

      await sleep(SETTLE_MS);
      expect(handled).toHaveLength(1);

      publishSpy.mockRestore();
      await expect(drain.drainOnce()).resolves.toBe(1);
      await expect(undrainedCount()).resolves.toBe(0);

      await waitFor(() => handled.length > 0, { description: 'the audit consumer to run' });
      await sleep(SETTLE_MS);

      expect(handled).toHaveLength(1);
    } finally {
      await queue.offWork(QUEUES.AUDIT_RECORD_EVENT);
    }
  });

  it('quarantines rows whose event name has no subscriber contract', async () => {
    const id = await insertOutboxRow('users.invented_by_a_migration', { userId: newId() });

    await expect(drain.drainOnce()).resolves.toBe(1);
    await expect(undrainedCount()).resolves.toBe(0);
    await expect(jobCount(QUEUES.AUDIT_RECORD_EVENT)).resolves.toBe(0);
    const [row] = await database.cleaner.query<{ dead_lettered_at: Date | null }>(
      'SELECT dead_lettered_at FROM messaging.outbox_events WHERE event_id = $1',
      [id],
    );
    expect(row?.dead_lettered_at).not.toBeNull();
  });

  it('claims a bounded batch and leaves the remainder for the next pass', async () => {
    const smallBatch = new OutboxDrainService(prisma, publisher, queue, {
      ...OPTIONS,
      drainBatchSize: 2,
    });

    for (let index = 0; index < 5; index += 1) {
      await registerUser();
    }

    await expect(smallBatch.drainOnce()).resolves.toBe(2);
    await expect(undrainedCount()).resolves.toBe(3);
  });

  it('clears a backlog larger than one batch inside a single run', async () => {
    const smallBatch = new OutboxDrainService(prisma, publisher, queue, {
      ...OPTIONS,
      drainBatchSize: 2,
    });

    for (let index = 0; index < 5; index += 1) {
      await registerUser();
    }

    await expect(smallBatch.drainUntilIdle()).resolves.toBe(5);
    await expect(undrainedCount()).resolves.toBe(0);
  });

  it('lets one failing event fail alone, and drains the rest of its batch', async () => {
    const failing = await registerUser();

    for (let index = 0; index < 3; index += 1) {
      await registerUser();
    }

    const realDispatch = publisher.dispatch.bind(publisher);
    vi.spyOn(publisher, 'dispatch').mockImplementation(async (event) => {
      const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, event);

      if (parsed.success && parsed.data.payload.userId === failing) {
        throw new Error('this one event cannot be dispatched');
      }

      await realDispatch(event);
    });

    // Four claimed, one poisonous: the other three settle rather than being
    // dragged back for a retry they do not need.
    await expect(drain.drainOnce()).resolves.toBe(3);
    await expect(undrainedCount()).resolves.toBe(1);

    const [row] = await database.cleaner.query<{
      attempt_count: number;
      last_error: string | null;
    }>(
      `SELECT attempt_count, last_error FROM messaging.outbox_events
        WHERE payload->>'userId' = $1`,
      [failing],
    );

    expect(row?.attempt_count).toBe(1);
    expect(row?.last_error).toContain('this one event cannot be dispatched');
  });

  it('drains nothing and reports zero when the table is empty', async () => {
    await expect(drain.drainOnce()).resolves.toBe(0);
  });

  describe('pruneOnce', () => {
    it('deletes drained rows past the retention window and keeps the rest', async () => {
      const staleId = await insertOutboxRow(INTEGRATION_EVENTS.USER_DELETED, {
        userId: newId(),
        deletedAt: new Date().toISOString(),
      });
      const recentId = await insertOutboxRow(INTEGRATION_EVENTS.USER_DELETED, {
        userId: newId(),
        deletedAt: new Date().toISOString(),
      });
      const undrainedId = await insertOutboxRow(INTEGRATION_EVENTS.USER_DELETED, {
        userId: newId(),
        deletedAt: new Date().toISOString(),
      });

      await database.cleaner.query(
        `UPDATE messaging.outbox_events
            SET drained_at = now() - interval '30 days'
          WHERE event_id = $1`,
        [staleId],
      );
      await database.cleaner.query(
        `UPDATE messaging.outbox_events SET drained_at = now() WHERE event_id = $1`,
        [recentId],
      );

      await expect(drain.pruneOnce()).resolves.toBe(1);

      const remaining = await database.cleaner.query<{ event_id: string }>(
        `SELECT event_id FROM messaging.outbox_events ORDER BY event_id`,
      );

      expect(new Set(remaining.map((row) => row.event_id))).toEqual(
        new Set([recentId, undrainedId]),
      );
    });
  });

  async function insertOutboxRow(eventName: string, payload: object): Promise<string> {
    const eventId = newId();

    await database.cleaner.query(
      `INSERT INTO messaging.outbox_events (event_id, occurred_at, event_name, schema_version, payload)
       VALUES ($1, now(), $2, 1, $3::jsonb)`,
      [eventId, eventName, JSON.stringify(payload)],
    );

    return eventId;
  }
});
