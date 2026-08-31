import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationEvent } from '#contracts/events';
import { createIntegrationEvent, INTEGRATION_EVENTS } from '#contracts/events';
import { type PrismaService, toTxHandle } from '#platform/prisma';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/support/database';
import { BullMqService } from './bullmq.service';
import { BullMqEventPublisher } from './bullmq-event-publisher';

describe('BullMqEventPublisher (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let queue: BullMqService;
  let publisher: BullMqEventPublisher;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();

    queue = new BullMqService({
      redisUrl: database.redisUrl,
      applicationName: 'integration-test',
      concurrency: 1,
      startWorkers: false,
      registerSchedules: false,
      shutdownTimeoutMs: 5_000,
    });
    await queue.onModuleInit();
    publisher = new BullMqEventPublisher(queue);
  });

  afterAll(async () => {
    await queue?.onModuleDestroy();
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
  });

  function event(): IntegrationEvent {
    return createIntegrationEvent(INTEGRATION_EVENTS.UPLOAD_CONFIRMED, {
      organizationId: newId(),
      fileId: newId(),
      ownerId: newId(),
      storageKey: 'uploads/test/file',
      mimeType: 'image/png',
      sizeBytes: 1,
      confirmedAt: new Date().toISOString(),
    });
  }

  it('writes the event to the outbox inside the caller transaction', async () => {
    const integrationEvent = event();

    await prisma.transaction(async (tx) => {
      await publisher.publishAll(toTxHandle(tx), [integrationEvent]);
    });

    const row = await prisma.db.outboxEvent.findUnique({
      where: { eventId: integrationEvent.eventId },
    });
    expect(row?.eventName).toBe(integrationEvent.name);
  });

  it('rolls the outbox row back with the transaction', async () => {
    const integrationEvent = event();

    await expect(
      prisma.transaction(async (tx) => {
        await publisher.publishAll(toTxHandle(tx), [integrationEvent]);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    await expect(
      prisma.db.outboxEvent.findUnique({ where: { eventId: integrationEvent.eventId } }),
    ).resolves.toBeNull();
  });

  it('rejects an event without a declared subscriber contract', async () => {
    const invented: IntegrationEvent = {
      eventId: newId(),
      name: 'users.invented',
      occurredAt: new Date().toISOString(),
      schemaVersion: 1,
      payload: {},
    };

    await expect(
      prisma.transaction((tx) => publisher.publishAll(toTxHandle(tx), [invented])),
    ).rejects.toThrow(/invalid integration event contract/);
  });
});
