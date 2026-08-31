import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { decodeCursor } from '#shared/pagination';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import { InMemoryStoredFileRepository } from '../../../../test/support/in-memory';
import { StoredFile } from '../domain/stored-file.entity';
import { DEFAULT_PAGE_SIZE, ListMyUploadsUseCase, MAX_PAGE_SIZE } from './list-my-uploads.use-case';

const OWNER_ID = newId();
const ORGANIZATION_ID = newId();
const STRANGER_ID = newId();
const PNG = 'image/png';
const SIZE = 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BASE_TIME = new Date('2026-08-16T10:00:00.000Z');
const MINUTE_MS = 60_000;

function createHarness() {
  const files = new InMemoryStoredFileRepository();

  const useCase = new ListMyUploadsUseCase(files);

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

function seedFiles(harness: Harness, count: number): StoredFile[] {
  return Array.from({ length: count }, (_unused, index) =>
    seedFile(harness, OWNER_ID, new Date(BASE_TIME.getTime() - index * MINUTE_MS)),
  );
}

describe('ListMyUploadsUseCase', () => {
  it('caps the page at MAX_PAGE_SIZE however large a limit is asked for', async () => {
    const harness = createHarness();
    seedFiles(harness, MAX_PAGE_SIZE + 1);

    const page = await harness.execute({ ownerId: OWNER_ID, limit: 1_000 });

    expect(page.files).toHaveLength(MAX_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it('falls back to the default page size', async () => {
    const harness = createHarness();
    seedFiles(harness, DEFAULT_PAGE_SIZE + 1);

    const page = await harness.execute({ ownerId: OWNER_ID });

    expect(page.files).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it("never shows another owner's files", async () => {
    const harness = createHarness();
    const mine = seedFile(harness, OWNER_ID, BASE_TIME);
    seedFile(harness, STRANGER_ID, BASE_TIME);

    const page = await harness.execute({ ownerId: OWNER_ID });

    expect(page.files.map((file) => file.id)).toEqual([mine.id]);
  });

  it('hides a discarded file while its row is still awaiting the sweep', async () => {
    const harness = createHarness();
    const discarded = StoredFile.presign({
      organizationId: ORGANIZATION_ID,
      ownerId: OWNER_ID,
      filename: 'bad-bytes.png',
      mimeType: PNG,
      sizeBytes: SIZE,
      maxSizeBytes: MAX_FILE_BYTES,
      now: BASE_TIME,
    });
    discarded.discard('content-mismatch');
    harness.files.seed(discarded);

    const page = await harness.execute({ ownerId: OWNER_ID });

    expect(page.files).toEqual([]);
    expect(harness.files.rowOf(discarded.id)).not.toBeNull();
  });

  it('walks the whole set without dropping or repeating a row', async () => {
    const harness = createHarness();
    const seeded = seedFiles(harness, 5);

    const first = await harness.execute({ ownerId: OWNER_ID, limit: 2 });
    const second = await harness.execute({
      ownerId: OWNER_ID,
      limit: 2,
      startingAfter: first.lastCursor!,
    });
    const third = await harness.execute({
      ownerId: OWNER_ID,
      limit: 2,
      startingAfter: second.lastCursor!,
    });

    const seen = [...first.files, ...second.files, ...third.files].map((file) => file.id);
    expect(seen).toEqual(seeded.map((file) => file.id));
    expect(new Set(seen).size).toBe(seeded.length);
    expect(third.hasMore).toBe(false);
    expect(decodeCursor(first.lastCursor!).id).toBe(seeded[1]!.id);
  });

  it('reports the verified facts once they are known, not the declared ones', async () => {
    const harness = createHarness();
    // Declared as png, verified as webp. Confirm no longer lets that pair
    // through, but rows written before it did are still in the table — and the
    // listing has to report what was actually stored, never the claim.
    const file = StoredFile.rehydrate({
      id: newId(),
      organizationId: ORGANIZATION_ID,
      ownerId: OWNER_ID,
      storageKey: `uploads/${ORGANIZATION_ID}/${OWNER_ID}/legacy`,
      filename: 'holiday.png',
      declaredMimeType: PNG,
      declaredSizeBytes: SIZE,
      verifiedMimeType: 'image/webp',
      verifiedSizeBytes: SIZE,
      status: 'confirmed',
      createdAt: BASE_TIME,
      confirmedAt: BASE_TIME,
    });
    harness.files.seed(file);

    const page = await harness.execute({ ownerId: OWNER_ID });

    expect(page.files[0]!.mimeType).toBe('image/webp');
    expect(page.files[0]!.status).toBe('confirmed');
  });

  it('answers a corrupted cursor with malformed, never validation', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() =>
      harness.execute({ ownerId: OWNER_ID, startingAfter: 'not-a-cursor' }),
    );

    expect(error.kind).toBe('malformed');
    expect(error.code).toBe(ERROR_CODES.CURSOR_MALFORMED);
  });
});
