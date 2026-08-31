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
import { ExpireStaleUploadsUseCase } from '../../application/expire-stale-uploads.use-case';
import { PurgeUserFilesUseCase } from '../../application/purge-user-files.use-case';
import type { UploadLimits } from '../../application/upload.limits';
import type {
  FileStoragePort,
  StoredObjectFacts,
  UploadPolicy,
} from '../../domain/file-storage.port';
import { StoredFile } from '../../domain/stored-file.entity';
import { PrismaStoredFileRepository } from '../prisma-stored-file.repository';
import { PurgeFilesOnUserDeletedListener } from './purge-files-on-user-deleted.listener';
import { SweepUnconfirmedUploadsListener } from './sweep-unconfirmed-uploads.listener';

const BATCH_CONCURRENCY = 2;

const LIMITS: UploadLimits = {
  maxFileBytes: 10_485_760,
  presignExpirySeconds: 900,
  pendingTtlMinutes: 60,
};

class RecordingFileStorage implements FileStoragePort {
  readonly removed: string[] = [];

  createUploadPolicy(): Promise<UploadPolicy> {
    return Promise.reject(new Error('not used by these consumers'));
  }

  inspect(): Promise<StoredObjectFacts | null> {
    return Promise.reject(new Error('not used by these consumers'));
  }

  remove(key: string): Promise<void> {
    this.removed.push(key);

    return Promise.resolve();
  }
}

describe('upload file lifecycle listeners (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let queue: BullMqService;
  let repository: PrismaStoredFileRepository;
  let storage: RecordingFileStorage;
  let onUserDeleted: PurgeFilesOnUserDeletedListener;
  let onSweep: SweepUnconfirmedUploadsListener;
  let organizationId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();

    queue = createTestQueue(database.redisUrl, BATCH_CONCURRENCY);
    await queue.onModuleInit();

    repository = new PrismaStoredFileRepository(prisma);
    storage = new RecordingFileStorage();
    onUserDeleted = new PurgeFilesOnUserDeletedListener(
      new PurgeUserFilesUseCase(repository, storage),
    );
    onSweep = new SweepUnconfirmedUploadsListener(
      new ExpireStaleUploadsUseCase(repository, storage, LIMITS),
    );
  });

  afterAll(async () => {
    await queue?.onModuleDestroy();
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
    await queue.deleteAllJobs();
    storage.removed.length = 0;
    organizationId = newId();
    await prisma.db.organization.create({
      data: { id: organizationId, slug: `org-${organizationId.slice(-12)}`, name: 'Test Org' },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await queue.offWork(QUEUES.UPLOAD_PURGE_USER_FILES);
    await queue.offWork(QUEUES.UPLOAD_SWEEP_UNCONFIRMED);
  });

  async function storeFile(ownerId: string, createdAt: Date): Promise<StoredFile> {
    const file = StoredFile.presign({
      organizationId,
      ownerId,
      filename: 'holiday.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      maxSizeBytes: LIMITS.maxFileBytes,
      now: createdAt,
    });

    await repository.save(file);

    return file;
  }

  function userDeleted(userId: string): IntegrationEvent {
    return createIntegrationEvent(INTEGRATION_EVENTS.USER_DELETED, {
      userId,
      deletedAt: new Date().toISOString(),
    });
  }

  async function captureBatchHandler(
    name: typeof QUEUES.UPLOAD_PURGE_USER_FILES | typeof QUEUES.UPLOAD_SWEEP_UNCONFIRMED,
    handle: (job: Job<unknown>) => Promise<void>,
  ): Promise<BatchHandler> {
    const workSpy = vi.spyOn(queue, 'work');

    await queue.work(name, handle);

    return readBatchHandler(workSpy.mock.calls);
  }

  describe('PurgeFilesOnUserDeletedListener', () => {
    it('erases every row the deleted owner had, and the objects behind them', async () => {
      const ownerId = newId();
      const first = await storeFile(ownerId, new Date('2026-08-16T10:00:00.000Z'));
      const second = await storeFile(ownerId, new Date('2026-08-16T10:00:01.000Z'));
      const untouched = await storeFile(newId(), new Date('2026-08-16T10:00:02.000Z'));

      await onUserDeleted.handle(makeJob(QUEUES.UPLOAD_PURGE_USER_FILES, userDeleted(ownerId)));

      await expect(rowExists(first.id)).resolves.toBe(false);
      await expect(rowExists(second.id)).resolves.toBe(false);
      await expect(rowExists(untouched.id)).resolves.toBe(true);

      expect(storage.removed).toContain(first.storageKey);
      expect(storage.removed).toContain(second.storageKey);
      expect(storage.removed).not.toContain(untouched.storageKey);
    });

    it('is idempotent under redelivery: the second run finds nothing left', async () => {
      const ownerId = newId();
      const file = await storeFile(ownerId, new Date('2026-08-16T10:00:00.000Z'));
      const job = makeJob(QUEUES.UPLOAD_PURGE_USER_FILES, userDeleted(ownerId));

      await onUserDeleted.handle(job);
      storage.removed.length = 0;

      await onUserDeleted.handle(job);

      await expect(rowExists(file.id)).resolves.toBe(false);
      expect(storage.removed).toEqual([]);
    });

    it('processes EVERY job in a batch of two, not just the first', async () => {
      const firstOwner = newId();
      const secondOwner = newId();
      const first = await storeFile(firstOwner, new Date('2026-08-16T10:00:00.000Z'));
      const second = await storeFile(secondOwner, new Date('2026-08-16T10:00:01.000Z'));

      const handle = await captureBatchHandler(QUEUES.UPLOAD_PURGE_USER_FILES, (job) =>
        onUserDeleted.handle(job),
      );

      const results = await handle([
        makeJob(QUEUES.UPLOAD_PURGE_USER_FILES, userDeleted(firstOwner)),
        makeJob(QUEUES.UPLOAD_PURGE_USER_FILES, userDeleted(secondOwner)),
      ]);

      await expect(rowExists(first.id)).resolves.toBe(false);
      await expect(rowExists(second.id)).resolves.toBe(false);
      expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
    });

    it('dead-letters a payload that will never match the contract', async () => {
      const handle = await captureBatchHandler(QUEUES.UPLOAD_PURGE_USER_FILES, (job) =>
        onUserDeleted.handle(job),
      );

      const results = await handle([
        makeJob(QUEUES.UPLOAD_PURGE_USER_FILES, { eventId: newId(), name: 'users.deleted' }),
      ]);

      expect(results.map((result) => result.status)).toEqual(['deadletter']);
    });
  });

  describe('SweepUnconfirmedUploadsListener', () => {
    it('expires pending rows past the TTL and then removes their objects', async () => {
      const ownerId = newId();
      const stale = await storeFile(ownerId, hoursAgo(3));
      const fresh = await storeFile(ownerId, new Date());

      await onSweep.handle(makeJob(QUEUES.UPLOAD_SWEEP_UNCONFIRMED, {}));

      await expect(rowExists(stale.id)).resolves.toBe(false);
      await expect(statusOf(fresh.id)).resolves.toBe('pending');
      expect(storage.removed).toEqual([stale.storageKey]);
    });

    it('is idempotent under redelivery: a second sweep expires nothing again', async () => {
      const stale = await storeFile(newId(), hoursAgo(3));
      const job = makeJob(QUEUES.UPLOAD_SWEEP_UNCONFIRMED, {});

      await onSweep.handle(job);
      await onSweep.handle(job);

      await expect(rowExists(stale.id)).resolves.toBe(false);
      expect(storage.removed).toEqual([stale.storageKey]);
    });

    it('settles EVERY job in a batch of two, not just the first', async () => {
      await storeFile(newId(), hoursAgo(3));

      const handle = await captureBatchHandler(QUEUES.UPLOAD_SWEEP_UNCONFIRMED, (job) =>
        onSweep.handle(job),
      );

      const results = await handle([
        makeJob(QUEUES.UPLOAD_SWEEP_UNCONFIRMED, {}),
        makeJob(QUEUES.UPLOAD_SWEEP_UNCONFIRMED, {}),
      ]);

      expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
    });
  });

  async function rowExists(fileId: string): Promise<boolean> {
    const rows = await database.cleaner.query<{ id: string }>(
      `SELECT id FROM upload.stored_file WHERE id = $1`,
      [fileId],
    );

    return rows.length > 0;
  }

  async function statusOf(fileId: string): Promise<string | undefined> {
    const rows = await database.cleaner.query<{ status: string }>(
      `SELECT status FROM upload.stored_file WHERE id = $1`,
      [fileId],
    );

    return rows[0]?.status;
  }
});

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}
