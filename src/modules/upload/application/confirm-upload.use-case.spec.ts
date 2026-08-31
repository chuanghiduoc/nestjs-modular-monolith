import { describe, expect, it } from 'vitest';

import { INTEGRATION_EVENTS } from '#contracts/events';
import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import {
  InMemoryFileStorage,
  InMemoryStoredFileRepository,
  InMemoryUnitOfWork,
  RecordingEventPublisher,
  TestJournal,
} from '../../../../test/support/in-memory';
import type { StoredObjectFacts } from '../domain/file-storage.port';
import { StoredFile } from '../domain/stored-file.entity';
import { ConfirmUploadUseCase } from './confirm-upload.use-case';

const OWNER_ID = newId();
const ORGANIZATION_ID = newId();
const STRANGER_ID = newId();
const PNG = 'image/png';
const DECLARED_SIZE = 2048;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function createHarness() {
  const journal = new TestJournal();
  const files = new InMemoryStoredFileRepository({ journal });
  const storage = new InMemoryFileStorage({ journal });
  const publisher = new RecordingEventPublisher({ journal });
  const uow = new InMemoryUnitOfWork({ journal, participants: [files] });

  return {
    journal,
    files,
    storage,
    publisher,
    uow,
    useCase: new ConfirmUploadUseCase(files, storage, uow, publisher),
  };
}

type Harness = ReturnType<typeof createHarness>;

function presignedFile(ownerId: string = OWNER_ID): StoredFile {
  return StoredFile.presign({
    organizationId: ORGANIZATION_ID,
    ownerId,
    filename: 'holiday.png',
    mimeType: PNG,
    sizeBytes: DECLARED_SIZE,
    maxSizeBytes: MAX_FILE_BYTES,
  });
}

function seedUploaded(
  harness: Harness,
  facts: StoredObjectFacts = { sizeBytes: DECLARED_SIZE, detectedMimeType: PNG },
): StoredFile {
  const file = presignedFile();
  harness.files.seed(file);
  harness.storage.put(file.storageKey, facts);

  return file;
}

describe('ConfirmUploadUseCase', () => {
  it('saves the aggregate and publishes uploads.confirmed inside ONE transaction', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness);
    const correlationId = newId();

    const view = await harness.useCase.execute({
      organizationId: ORGANIZATION_ID,
      callerId: OWNER_ID,
      fileId: file.id,
      correlationId,
    });

    expect(view.status).toBe('confirmed');
    expect(view.mimeType).toBe(PNG);
    expect(view.sizeBytes).toBe(DECLARED_SIZE);

    const stored = harness.files.rowOf(file.id);
    expect(stored?.status).toBe('confirmed');
    expect(stored?.verifiedMimeType).toBe(PNG);
    expect(stored?.verifiedSizeBytes).toBe(DECLARED_SIZE);
    expect(stored?.confirmedAt).not.toBeNull();

    expect(harness.uow.handles).toHaveLength(1);
    expect(harness.publisher.calls).toHaveLength(1);
    expect(harness.publisher.calls[0]!.tx).toBe(harness.uow.handles[0]);

    expect(harness.journal.trail()).toEqual([
      'storage:inspect',
      'uow:begin',
      'files:compareAndSave',
      'publisher:publishAll',
      'uow:commit',
    ]);
  });

  it('publishes ids and facts, never the aggregate', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness);
    const correlationId = newId();

    await harness.useCase.execute({
      organizationId: ORGANIZATION_ID,
      callerId: OWNER_ID,
      fileId: file.id,
      correlationId,
    });

    const [event] = harness.publisher.published;
    expect(event?.name).toBe(INTEGRATION_EVENTS.UPLOAD_CONFIRMED);
    expect(event?.correlationId).toBe(correlationId);
    expect(event?.payload).toEqual({
      fileId: file.id,
      organizationId: file.organizationId,
      ownerId: OWNER_ID,
      storageKey: file.storageKey,
      mimeType: PNG,
      sizeBytes: DECLARED_SIZE,
      confirmedAt: harness.files.rowOf(file.id)!.confirmedAt!.toISOString(),
    });
    expect(event?.payload).not.toHaveProperty('filename');
  });

  it('rejects an upload whose bytes never arrived, and publishes nothing', async () => {
    const harness = createHarness();
    const file = presignedFile();
    harness.files.seed(file);

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    );

    expect(error.kind).toBe('validation');
    expect(error.code).toBe(ERROR_CODES.UPLOAD_OBJECT_MISSING);
    expect(harness.journal.trail()).toEqual(['storage:inspect']);
    expect(harness.publisher.calls).toEqual([]);
    expect(harness.files.rowOf(file.id)?.status).toBe('pending');
  });

  it('PERSISTS the rejection when the stored size does not match, then throws', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness, { sizeBytes: DECLARED_SIZE + 1, detectedMimeType: PNG });

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.UPLOAD_CONTENT_MISMATCH);
    expect(harness.files.rowOf(file.id)?.status).toBe('discarded');
    expect(harness.journal.trail()).toEqual(['storage:inspect', 'files:compareAndSave']);
    expect(harness.publisher.calls).toEqual([]);
  });

  it('rejects bytes whose real type is not on the allow-list, whatever was declared', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness, {
      sizeBytes: DECLARED_SIZE,
      detectedMimeType: 'application/zip',
    });

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED);
    expect(harness.files.rowOf(file.id)?.status).toBe('discarded');
    expect(harness.publisher.calls).toEqual([]);
  });

  it('rejects an allowed type that is not the declared one, and persists the discard', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness, {
      sizeBytes: DECLARED_SIZE,
      detectedMimeType: 'application/pdf',
    });

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.UPLOAD_CONTENT_MISMATCH);
    expect(harness.files.rowOf(file.id)?.status).toBe('discarded');
    expect(harness.publisher.calls).toEqual([]);
  });

  it('rejects bytes no signature recognised — unrecognised is not "safe"', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness, { sizeBytes: DECLARED_SIZE, detectedMimeType: null });

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED);
    expect(harness.files.rowOf(file.id)?.status).toBe('discarded');
  });

  it("answers a stranger's file exactly as it answers an absent one", async () => {
    const harness = createHarness();
    const file = seedUploaded(harness);

    const notMine = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: STRANGER_ID,
        fileId: file.id,
      }),
    );
    const absent = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: STRANGER_ID,
        fileId: newId(),
      }),
    );

    expect(notMine.kind).toBe('not_found');
    expect(notMine.code).toBe(ERROR_CODES.UPLOAD_NOT_FOUND);
    expect(absent.kind).toBe(notMine.kind);
    expect(absent.code).toBe(notMine.code);
    expect(notMine.detail).toBe(absent.detail);

    expect(harness.storage.inspections).toEqual([]);
    expect(harness.files.rowOf(file.id)?.status).toBe('pending');
  });

  it('answers a second confirm with conflict and publishes the event once', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness);

    await harness.useCase.execute({
      organizationId: ORGANIZATION_ID,
      callerId: OWNER_ID,
      fileId: file.id,
    });
    const error = await captureDomainError(() =>
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    );

    expect(error.kind).toBe('conflict');
    expect(error.code).toBe(ERROR_CODES.UPLOAD_ALREADY_CONFIRMED);
    expect(harness.publisher.calls).toHaveLength(1);
    expect(harness.uow.handles).toHaveLength(1);
  });

  it('rolls the aggregate write back when publishing fails', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness);
    harness.publisher.failNextWith(new Error('queue unavailable'));

    await expect(
      harness.useCase.execute({
        organizationId: ORGANIZATION_ID,
        callerId: OWNER_ID,
        fileId: file.id,
      }),
    ).rejects.toThrow('queue unavailable');

    expect(harness.files.rowOf(file.id)?.status).toBe('pending');
    expect(harness.files.rowOf(file.id)?.confirmedAt).toBeNull();
    expect(harness.uow.rollbacks).toHaveLength(1);
    expect(harness.uow.commits).toEqual([]);
    expect(harness.journal.trail()).toEqual([
      'storage:inspect',
      'uow:begin',
      'files:compareAndSave',
      'publisher:publishAll',
      'uow:rollback',
    ]);
  });

  it('reads the object before opening the transaction, never inside it', async () => {
    const harness = createHarness();
    const file = seedUploaded(harness);

    await harness.useCase.execute({
      organizationId: ORGANIZATION_ID,
      callerId: OWNER_ID,
      fileId: file.id,
    });

    const trail = harness.journal.trail();
    expect(harness.storage.inspections).toEqual([file.storageKey]);
    expect(trail.indexOf('storage:inspect')).toBeLessThan(trail.indexOf('uow:begin'));
  });
});
