import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { InMemoryStoredFileRepository } from '../../../../test/support/in-memory';
import { StoredFile } from '../domain/stored-file.entity';
import { CountUserUploadsUseCase } from './count-user-uploads.use-case';

const ORGANIZATION_ID = newId();
const OWNER_ID = newId();
const STRANGER_ID = newId();
const PNG = 'image/png';
const SIZE = 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BASE_TIME = new Date('2026-08-16T10:00:00.000Z');
const MINUTE_MS = 60_000;

function createHarness() {
  const files = new InMemoryStoredFileRepository();

  const useCase = new CountUserUploadsUseCase(files);

  return {
    files,
    useCase,
    execute: (input: Omit<Parameters<typeof useCase.execute>[0], 'organizationId'>) =>
      useCase.execute({ organizationId: ORGANIZATION_ID, ...input }),
  };
}

type Harness = ReturnType<typeof createHarness>;

function seedFile(harness: Harness, ownerId: string, createdAt: Date): StoredFile {
  const file = StoredFile.presign({
    organizationId: ORGANIZATION_ID,
    ownerId,
    filename: 'holiday.png',
    mimeType: PNG,
    sizeBytes: SIZE,
    maxSizeBytes: MAX_FILE_BYTES,
    now: createdAt,
  });

  // Confirmed on the way in: listing and counting are about files a caller can
  // actually use, and an unconfirmed presign is not one yet.
  file.confirm({ mimeType: PNG, sizeBytes: SIZE }, createdAt);
  file.pullEvents();
  harness.files.seed(file);

  return file;
}

describe('CountUserUploadsUseCase', () => {
  it('counts every non-archived file in the organization, past any page size', async () => {
    const harness = createHarness();

    for (let index = 0; index < 7; index += 1) {
      seedFile(harness, OWNER_ID, new Date(BASE_TIME.getTime() - index * MINUTE_MS));
    }

    await expect(harness.execute({ ownerId: OWNER_ID })).resolves.toBe(7);
  });

  it("never counts another owner's files or another organization's rows", async () => {
    const harness = createHarness();
    const mine = seedFile(harness, OWNER_ID, BASE_TIME);
    seedFile(harness, STRANGER_ID, BASE_TIME);

    const elsewhere = StoredFile.presign({
      organizationId: newId(),
      ownerId: OWNER_ID,
      filename: 'holiday.png',
      mimeType: PNG,
      sizeBytes: SIZE,
      maxSizeBytes: MAX_FILE_BYTES,
      now: BASE_TIME,
    });
    harness.files.seed(elsewhere);

    expect(mine.organizationId).not.toBe(elsewhere.organizationId);

    await expect(harness.execute({ ownerId: OWNER_ID })).resolves.toBe(1);
  });

  it('counts confirmed files only — a presign nobody finished is not a file', async () => {
    const harness = createHarness();
    seedFile(harness, OWNER_ID, BASE_TIME);

    const abandoned = StoredFile.presign({
      organizationId: ORGANIZATION_ID,
      ownerId: OWNER_ID,
      filename: 'never-finished.png',
      mimeType: PNG,
      sizeBytes: SIZE,
      maxSizeBytes: MAX_FILE_BYTES,
      now: new Date(BASE_TIME.getTime() - MINUTE_MS),
    });
    harness.files.seed(abandoned);

    await expect(harness.execute({ ownerId: OWNER_ID })).resolves.toBe(1);
    expect(abandoned.status).toBe('pending');
  });

  it('answers zero for an owner with nothing', async () => {
    const harness = createHarness();

    await expect(harness.execute({ ownerId: newId() })).resolves.toBe(0);
  });
});
