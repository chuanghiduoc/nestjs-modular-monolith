import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationEvent } from '#contracts/events';
import type { EventPublisherPort, TxHandle } from '#contracts/ports';
import { type PrismaService, PrismaUnitOfWork } from '#platform/prisma';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../../test/support/database';
import type { FileStoragePort, StoredObjectFacts, UploadPolicy } from '../domain/file-storage.port';
import { StoredFile } from '../domain/stored-file.entity';
import { PrismaStoredFileRepository } from '../infrastructure/prisma-stored-file.repository';
import { ConfirmUploadUseCase } from './confirm-upload.use-case';

const DECLARED_SIZE = 1_024;
const DECLARED_MIME = 'image/png';

class StubStorage implements FileStoragePort {
  createUploadPolicy(): Promise<UploadPolicy> {
    return Promise.reject(new Error('not used'));
  }

  inspect(): Promise<StoredObjectFacts | null> {
    return Promise.resolve({ detectedMimeType: DECLARED_MIME, sizeBytes: DECLARED_SIZE });
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingPublisher implements EventPublisherPort {
  readonly published: IntegrationEvent[] = [];

  publishAll(_tx: TxHandle, events: readonly IntegrationEvent[]): Promise<void> {
    this.published.push(...events);

    return Promise.resolve();
  }
}

describe('ConfirmUploadUseCase under concurrency (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let repository: PrismaStoredFileRepository;
  let publisher: RecordingPublisher;
  let useCase: ConfirmUploadUseCase;
  let ownerId: string;
  let organizationId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
    repository = new PrismaStoredFileRepository(prisma);

    publisher = new RecordingPublisher();
    useCase = new ConfirmUploadUseCase(
      repository,
      new StubStorage(),
      new PrismaUnitOfWork(prisma),
      publisher,
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
    publisher.published.length = 0;
    ownerId = newId();
    organizationId = newId();
    await prisma.db.organization.create({
      data: { id: organizationId, slug: `org-${organizationId.slice(-12)}`, name: 'Test Org' },
    });
  });

  async function seedPendingFile(): Promise<string> {
    const file = StoredFile.presign({
      organizationId,
      ownerId,
      filename: 'photo.png',
      mimeType: DECLARED_MIME,
      sizeBytes: DECLARED_SIZE,
      maxSizeBytes: 10_485_760,
    });

    await repository.save(file);
    file.pullEvents();

    return file.id;
  }

  it('confirms exactly once when two requests arrive together', async () => {
    const fileId = await seedPendingFile();

    const outcomes = await Promise.allSettled([
      useCase.execute({ organizationId, callerId: ownerId, fileId }),
      useCase.execute({ organizationId, callerId: ownerId, fileId }),
    ]);

    const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled');

    expect(succeeded).toHaveLength(1);
    expect(publisher.published).toHaveLength(1);
  });

  it('confirms exactly once when the same request is retried sequentially', async () => {
    const fileId = await seedPendingFile();

    await useCase.execute({ organizationId, callerId: ownerId, fileId });

    await expect(
      useCase.execute({ organizationId, callerId: ownerId, fileId }),
    ).rejects.toMatchObject({
      code: 'upload_already_confirmed',
    });

    expect(publisher.published).toHaveLength(1);
  });
});
