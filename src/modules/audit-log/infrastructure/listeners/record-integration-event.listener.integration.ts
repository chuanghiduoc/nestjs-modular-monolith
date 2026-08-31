import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationEvent } from '#contracts/events';
import { createIntegrationEvent, INTEGRATION_EVENTS } from '#contracts/events';
import type { PrismaService } from '#platform/prisma';
import { type BullMqService, QUEUES } from '#platform/queue';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../../../test/support/database';
import {
  type BatchHandler,
  createTestQueue,
  makeJob,
  readBatchHandler,
  waitFor,
} from '../../../../../test/support/queue';
import { RecordAuditEntryUseCase } from '../../application/record-audit-entry.use-case';
import { PrismaAuditRepository } from '../prisma-audit.repository';
import { RecordIntegrationEventListener } from './record-integration-event.listener';

const BATCH_CONCURRENCY = 2;

describe('RecordIntegrationEventListener (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let queue: BullMqService;
  let repository: PrismaAuditRepository;
  let listener: RecordIntegrationEventListener;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();

    queue = createTestQueue(database.redisUrl, BATCH_CONCURRENCY);
    await queue.onModuleInit();

    repository = new PrismaAuditRepository(prisma);
    listener = new RecordIntegrationEventListener(new RecordAuditEntryUseCase(repository));
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

  afterEach(async () => {
    vi.restoreAllMocks();
    await queue.offWork(QUEUES.AUDIT_RECORD_EVENT);
  });

  function userRegistered(): IntegrationEvent {
    const userId = newId();

    return createIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, {
      userId,
      email: `${userId}@example.com`,
      emailVerified: false,
      registeredAt: new Date().toISOString(),
    });
  }

  async function auditRowCount(): Promise<number> {
    return (await repository.listPage(null, 50, {})).length;
  }

  async function registerAndCaptureBatchHandler(): Promise<BatchHandler> {
    const workSpy = vi.spyOn(queue, 'work');

    await queue.work(QUEUES.AUDIT_RECORD_EVENT, (job) => listener.handle(job));

    return readBatchHandler(workSpy.mock.calls);
  }

  it('turns an integration event into an audit row', async () => {
    const event = userRegistered();

    await listener.handle(makeJob(QUEUES.AUDIT_RECORD_EVENT, event));

    const [entry] = await repository.listPage(null, 10, {});

    expect(entry?.id).toBe(event.eventId);
    expect(entry?.action).toBe(INTEGRATION_EVENTS.USER_REGISTERED);
    expect(entry?.resource).toBe('users');
    expect(entry?.metadata).toEqual({ schemaVersion: 1 });
  });

  it('is idempotent under redelivery: the same event twice has one effect', async () => {
    const event = userRegistered();
    const first = makeJob(QUEUES.AUDIT_RECORD_EVENT, event);
    const second = makeJob(QUEUES.AUDIT_RECORD_EVENT, event);

    await listener.handle(first);
    await listener.handle(second);

    await expect(auditRowCount()).resolves.toBe(1);
  });

  it('processes EVERY job in a batch of two, not just the first', async () => {
    const handle = await registerAndCaptureBatchHandler();
    const first = userRegistered();
    const second = userRegistered();

    const results = await handle([
      makeJob(QUEUES.AUDIT_RECORD_EVENT, first),
      makeJob(QUEUES.AUDIT_RECORD_EVENT, second),
    ]);

    await expect(auditRowCount()).resolves.toBe(2);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
  });

  it('delivers two queued events end to end, through BullMQ', async () => {
    await queue.send(QUEUES.AUDIT_RECORD_EVENT, userRegistered());
    await queue.send(QUEUES.AUDIT_RECORD_EVENT, userRegistered());

    await queue.work(QUEUES.AUDIT_RECORD_EVENT, (job) => listener.handle(job));

    await waitFor(async () => (await auditRowCount()) === 2, {
      description: 'both queued audit events to be recorded',
    });
  });

  it('dead-letters an envelope that will never parse instead of retrying it', async () => {
    const handle = await registerAndCaptureBatchHandler();

    const results = await handle([
      makeJob(QUEUES.AUDIT_RECORD_EVENT, { eventId: 'not-a-uuid', name: 'users.registered' }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['deadletter']);
    await expect(auditRowCount()).resolves.toBe(0);
  });

  it('records the correlation id as the request id when the envelope carries one', async () => {
    const correlationId = newId();
    const userId = newId();
    const event = createIntegrationEvent(
      INTEGRATION_EVENTS.USER_REGISTERED,
      {
        userId,
        email: `${userId}@example.com`,
        emailVerified: false,
        registeredAt: new Date().toISOString(),
      },
      { correlationId },
    );

    await listener.handle(makeJob(QUEUES.AUDIT_RECORD_EVENT, event));

    const [entry] = await repository.listPage(null, 10, {});

    expect(entry?.requestId).toBe(correlationId);
    expect(entry?.actorId).toBe(userId);
  });
});
