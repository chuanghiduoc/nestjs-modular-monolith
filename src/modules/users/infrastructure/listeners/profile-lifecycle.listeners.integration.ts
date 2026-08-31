import type { Job } from 'bullmq';
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
} from '../../../../../test/support/queue';
import { DeleteUserProfileUseCase } from '../../application/delete-user-profile.use-case';
import { EnsureUserProfileUseCase } from '../../application/ensure-user-profile.use-case';
import { PrismaUserRepository } from '../prisma-user.repository';
import { CreateProfileOnRegistrationListener } from './create-profile-on-registration.listener';
import { DeleteProfileOnUserDeletedListener } from './delete-profile-on-user-deleted.listener';

const BATCH_CONCURRENCY = 2;

describe('users profile lifecycle listeners (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let queue: BullMqService;
  let repository: PrismaUserRepository;
  let onRegistered: CreateProfileOnRegistrationListener;
  let onDeleted: DeleteProfileOnUserDeletedListener;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();

    queue = createTestQueue(database.redisUrl, BATCH_CONCURRENCY);
    await queue.onModuleInit();

    repository = new PrismaUserRepository(prisma);
    onRegistered = new CreateProfileOnRegistrationListener(
      new EnsureUserProfileUseCase(repository),
    );
    onDeleted = new DeleteProfileOnUserDeletedListener(new DeleteUserProfileUseCase(repository));
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
    await queue.offWork(QUEUES.USERS_CREATE_PROFILE);
    await queue.offWork(QUEUES.USERS_DELETE_PROFILE);
  });

  async function userRegistered(userId: string = newId()): Promise<IntegrationEvent> {
    await prisma.db.user.create({
      data: {
        id: userId,
        name: 'Ada Lovelace',
        email: `ada.lovelace+${userId}@example.com`,
        emailVerified: false,
        role: 'member',
      },
    });

    return createIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, {
      userId,
      email: `ada.lovelace+${userId}@example.com`,
      emailVerified: false,
      registeredAt: new Date().toISOString(),
    });
  }

  function userDeleted(userId: string): IntegrationEvent {
    return createIntegrationEvent(INTEGRATION_EVENTS.USER_DELETED, {
      userId,
      deletedAt: new Date().toISOString(),
    });
  }

  async function captureBatchHandler(
    name: typeof QUEUES.USERS_CREATE_PROFILE | typeof QUEUES.USERS_DELETE_PROFILE,
    handle: (job: Job<unknown>) => Promise<void>,
  ): Promise<BatchHandler> {
    const workSpy = vi.spyOn(queue, 'work');

    await queue.work(name, handle);

    return readBatchHandler(workSpy.mock.calls);
  }

  describe('CreateProfileOnRegistrationListener', () => {
    it('creates the profile and derives a display name from the email', async () => {
      const userId = newId();

      await onRegistered.handle(makeJob(QUEUES.USERS_CREATE_PROFILE, await userRegistered(userId)));

      const profile = await repository.findByUserId(userId);

      expect(profile?.userId).toBe(userId);
      expect(profile?.displayName).toBe(`ada.lovelace+${userId}`);
    });

    it('is idempotent under redelivery: the same registration twice creates one profile', async () => {
      const event = await userRegistered();

      await onRegistered.handle(makeJob(QUEUES.USERS_CREATE_PROFILE, event));
      await onRegistered.handle(makeJob(QUEUES.USERS_CREATE_PROFILE, event));

      await expect(profileCount()).resolves.toBe(1);
    });

    it('processes EVERY job in a batch of two, not just the first', async () => {
      const handle = await captureBatchHandler(QUEUES.USERS_CREATE_PROFILE, (job) =>
        onRegistered.handle(job),
      );

      const results = await handle([
        makeJob(QUEUES.USERS_CREATE_PROFILE, await userRegistered()),
        makeJob(QUEUES.USERS_CREATE_PROFILE, await userRegistered()),
      ]);

      await expect(profileCount()).resolves.toBe(2);
      expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
    });

    it('dead-letters a payload that will never match the contract', async () => {
      const handle = await captureBatchHandler(QUEUES.USERS_CREATE_PROFILE, (job) =>
        onRegistered.handle(job),
      );

      const results = await handle([
        makeJob(QUEUES.USERS_CREATE_PROFILE, { eventId: newId(), name: 'users.registered' }),
      ]);

      expect(results.map((result) => result.status)).toEqual(['deadletter']);
      await expect(profileCount()).resolves.toBe(0);
    });
  });

  describe('DeleteProfileOnUserDeletedListener', () => {
    it('removes the profile, and a redelivery is a no-op rather than a failure', async () => {
      const userId = newId();
      await onRegistered.handle(makeJob(QUEUES.USERS_CREATE_PROFILE, await userRegistered(userId)));

      const job = makeJob(QUEUES.USERS_DELETE_PROFILE, userDeleted(userId));

      await onDeleted.handle(job);
      await expect(onDeleted.handle(job)).resolves.toBeUndefined();

      await expect(profileCount()).resolves.toBe(0);
    });

    it('processes EVERY job in a batch of two, not just the first', async () => {
      const first = newId();
      const second = newId();

      await onRegistered.handle(makeJob(QUEUES.USERS_CREATE_PROFILE, await userRegistered(first)));
      await onRegistered.handle(makeJob(QUEUES.USERS_CREATE_PROFILE, await userRegistered(second)));

      const handle = await captureBatchHandler(QUEUES.USERS_DELETE_PROFILE, (job) =>
        onDeleted.handle(job),
      );

      const results = await handle([
        makeJob(QUEUES.USERS_DELETE_PROFILE, userDeleted(first)),
        makeJob(QUEUES.USERS_DELETE_PROFILE, userDeleted(second)),
      ]);

      await expect(profileCount()).resolves.toBe(0);
      expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
    });
  });

  async function profileCount(): Promise<number> {
    const rows = await database.cleaner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM users.user_profile`,
    );

    return Number(rows[0]?.count ?? '0');
  }
});
