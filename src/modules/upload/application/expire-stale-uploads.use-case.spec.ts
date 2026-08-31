import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import {
  InMemoryFileStorage,
  InMemoryStoredFileRepository,
  TestJournal,
} from '../../../../test/support/in-memory';
import { StoredFile } from '../domain/stored-file.entity';
import { ExpireStaleUploadsUseCase } from './expire-stale-uploads.use-case';
import type { UploadLimits } from './upload.limits';

const OWNER_ID = newId();
const ORGANIZATION_ID = newId();
const PNG = 'image/png';
const SIZE = 1024;
const MINUTE_MS = 60_000;
const NOW = new Date('2026-08-16T12:00:00.000Z');
const LIMITS: UploadLimits = {
  maxFileBytes: 5 * 1024 * 1024,
  presignExpirySeconds: 900,
  pendingTtlMinutes: 60,
};

function createHarness() {
  const journal = new TestJournal();
  const files = new InMemoryStoredFileRepository({ journal });
  const storage = new InMemoryFileStorage({ journal });

  return {
    journal,
    files,
    storage,
    useCase: new ExpireStaleUploadsUseCase(files, storage, LIMITS),
  };
}

function presignedAt(minutesAgo: number): StoredFile {
  return StoredFile.presign({
    organizationId: ORGANIZATION_ID,
    ownerId: OWNER_ID,
    filename: 'holiday.png',
    mimeType: PNG,
    sizeBytes: SIZE,
    maxSizeBytes: LIMITS.maxFileBytes,
    now: new Date(NOW.getTime() - minutesAgo * MINUTE_MS),
  });
}

describe('ExpireStaleUploadsUseCase', () => {
  it('expires only the rows past the TTL, and leaves the recent ones alone', async () => {
    const harness = createHarness();
    const stale = presignedAt(120);
    const recent = presignedAt(5);
    harness.files.seed(stale);
    harness.files.seed(recent);

    const expired = await harness.useCase.execute(NOW);

    expect(expired).toBe(1);
    expect(harness.files.rowOf(stale.id)).toBeNull();
    expect(harness.files.rowOf(recent.id)?.status).toBe('pending');
  });

  it('claims the terminal state before deleting the object and row', async () => {
    const harness = createHarness();
    const stale = presignedAt(120);
    harness.files.seed(stale);
    harness.storage.put(stale.storageKey, { sizeBytes: SIZE, detectedMimeType: PNG });

    await harness.useCase.execute(NOW);

    expect(harness.journal.trail()).toEqual([
      'files:compareAndSave',
      'storage:remove',
      'files:deleteById',
    ]);
    expect(harness.storage.has(stale.storageKey)).toBe(false);
  });

  it('is a no-op on a second run — the schedule fires whether or not there is work', async () => {
    const harness = createHarness();
    harness.files.seed(presignedAt(120));

    expect(await harness.useCase.execute(NOW)).toBe(1);
    harness.journal.clear();

    expect(await harness.useCase.execute(NOW)).toBe(0);
    expect(harness.journal.trail()).toEqual([]);
  });

  it('never touches a confirmed file, however old', async () => {
    const harness = createHarness();
    const confirmed = presignedAt(600);
    confirmed.confirm({ mimeType: PNG, sizeBytes: SIZE });
    harness.files.seed(confirmed);
    harness.storage.put(confirmed.storageKey, { sizeBytes: SIZE, detectedMimeType: PNG });

    const expired = await harness.useCase.execute(NOW);

    expect(expired).toBe(0);
    expect(harness.files.rowOf(confirmed.id)?.status).toBe('confirmed');
    expect(harness.storage.has(confirmed.storageKey)).toBe(true);
  });

  it('retains an expired row when object deletion fails, so retry can recover', async () => {
    const harness = createHarness();
    const stale = presignedAt(120);
    harness.files.seed(stale);
    harness.storage.put(stale.storageKey, { sizeBytes: SIZE, detectedMimeType: PNG });
    harness.storage.failNextRemoveWith(new Error('object storage unavailable'));

    await expect(harness.useCase.execute(NOW)).rejects.toThrow('object storage unavailable');

    expect(harness.files.rowOf(stale.id)?.status).toBe('discarded');
    expect(await harness.useCase.execute(NOW)).toBe(1);
    expect(harness.storage.has(stale.storageKey)).toBe(false);
    expect(harness.files.rowOf(stale.id)).toBeNull();
  });

  it('removes the object even when nothing was ever uploaded under the key', async () => {
    const harness = createHarness();
    const stale = presignedAt(120);
    harness.files.seed(stale);

    await expect(harness.useCase.execute(NOW)).resolves.toBe(1);
    expect(harness.journal.trail()).toEqual([
      'files:compareAndSave',
      'storage:remove',
      'files:deleteById',
    ]);
  });
});
