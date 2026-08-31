import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import {
  InMemoryFileStorage,
  InMemoryStoredFileRepository,
  TestJournal,
} from '../../../../test/support/in-memory';
import { StoredFile } from '../domain/stored-file.entity';
import { PurgeUserFilesUseCase } from './purge-user-files.use-case';

const OWNER_ID = newId();
const ORGANIZATION_ID = newId();
const STRANGER_ID = newId();
const PNG = 'image/png';
const SIZE = 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function createHarness() {
  const journal = new TestJournal();
  const files = new InMemoryStoredFileRepository({ journal });
  const storage = new InMemoryFileStorage({ journal });

  return { journal, files, storage, useCase: new PurgeUserFilesUseCase(files, storage) };
}

/**
 * A repository whose delete silently does nothing — the shape a revoked grant or
 * a blocking constraint takes from the caller's side.
 */
class UndeletableStoredFileRepository extends InMemoryStoredFileRepository {
  override deleteById(): Promise<void> {
    return Promise.resolve();
  }
}

function fileOf(ownerId: string): StoredFile {
  return StoredFile.presign({
    organizationId: ORGANIZATION_ID,
    ownerId,
    filename: 'photo.png',
    mimeType: PNG,
    sizeBytes: SIZE,
    maxSizeBytes: MAX_FILE_BYTES,
  });
}

describe('PurgeUserFilesUseCase', () => {
  it('deletes the row and the stored object, in that order', async () => {
    const harness = createHarness();
    const file = fileOf(OWNER_ID);

    harness.files.seed(file);
    harness.journal.clear();

    expect(await harness.useCase.execute(OWNER_ID)).toBe(1);

    expect(harness.files.rowOf(file.id)).toBeNull();

    const trail = harness.journal.trail();

    expect(trail.indexOf('storage:remove')).toBeLessThan(trail.indexOf('files:deleteById'));
  });

  it('leaves another owner untouched', async () => {
    const harness = createHarness();
    const mine = fileOf(OWNER_ID);
    const theirs = fileOf(STRANGER_ID);

    harness.files.seed(mine);
    harness.files.seed(theirs);

    expect(await harness.useCase.execute(OWNER_ID)).toBe(1);
    expect(harness.files.rowOf(theirs.id)).not.toBeNull();
  });

  it('purges a discarded file too, not just the usable ones', async () => {
    const harness = createHarness();
    const discarded = fileOf(OWNER_ID);

    discarded.discard('never-uploaded');
    harness.files.seed(discarded);

    expect(await harness.useCase.execute(OWNER_ID)).toBe(1);
    expect(harness.files.rowOf(discarded.id)).toBeNull();
  });

  it('purges every file the owner has, not just the first batch', async () => {
    const harness = createHarness();
    const owner = newId();
    const fileCount = 520;

    for (let index = 0; index < fileCount; index++) {
      harness.files.seed(fileOf(owner));
    }

    expect(await harness.useCase.execute(owner)).toBe(fileCount);
    await expect(harness.files.findAllByOwner(owner, fileCount)).resolves.toEqual([]);
  });

  it('fails loudly instead of spinning when the delete never takes effect', async () => {
    const journal = new TestJournal();
    const files = new UndeletableStoredFileRepository({ journal });
    const storage = new InMemoryFileStorage({ journal });
    const useCase = new PurgeUserFilesUseCase(files, storage);

    files.seed(fileOf(OWNER_ID));

    await expect(useCase.execute(OWNER_ID)).rejects.toThrow('made no progress');
  });

  it('is a no-op for an owner with nothing stored', async () => {
    const harness = createHarness();

    expect(await harness.useCase.execute(newId())).toBe(0);
  });

  it('survives redelivery: the second run finds nothing left to do', async () => {
    const harness = createHarness();

    harness.files.seed(fileOf(OWNER_ID));

    expect(await harness.useCase.execute(OWNER_ID)).toBe(1);
    expect(await harness.useCase.execute(OWNER_ID)).toBe(0);
  });
});
