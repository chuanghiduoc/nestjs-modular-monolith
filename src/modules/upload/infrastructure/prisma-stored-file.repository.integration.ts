import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '#platform/prisma';
import { decodeCursor, type DecodedCursor, encodeCursor } from '#shared/pagination';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../../test/support/database';
import { StoredFile } from '../domain/stored-file.entity';
import { PrismaStoredFileRepository } from './prisma-stored-file.repository';

const MAX_SIZE_BYTES = 10_485_760;
const DECLARED_SIZE_BYTES = 1024;
const ORGANIZATION_ID = newId();

describe('PrismaStoredFileRepository (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let repository: PrismaStoredFileRepository;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
    repository = new PrismaStoredFileRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
    await prisma.db.organization.create({
      data: { id: ORGANIZATION_ID, slug: `org-${ORGANIZATION_ID.slice(-12)}`, name: 'Test Org' },
    });
  });

  function presign(ownerId: string, now: Date = new Date()): StoredFile {
    return StoredFile.presign({
      organizationId: ORGANIZATION_ID,
      ownerId,
      filename: 'holiday.png',
      mimeType: 'image/png',
      sizeBytes: DECLARED_SIZE_BYTES,
      maxSizeBytes: MAX_SIZE_BYTES,
      now,
    });
  }

  async function store(ownerId: string, now: Date = new Date()): Promise<StoredFile> {
    const file = presign(ownerId, now);
    await repository.save(file);

    return file;
  }

  /** Presign, store, then confirm — the state most reads care about. */
  async function storeConfirmed(ownerId: string, now: Date = new Date()): Promise<StoredFile> {
    const file = await store(ownerId, now);

    file.confirm({ mimeType: 'image/png', sizeBytes: DECLARED_SIZE_BYTES }, now);
    await repository.compareAndSave(file, 'pending');

    return file;
  }

  async function storeDiscarded(ownerId: string, now: Date = new Date()): Promise<StoredFile> {
    const file = await store(ownerId, now);

    file.discard('content-mismatch', now);
    await repository.compareAndSave(file, 'pending');

    return file;
  }

  describe('save', () => {
    it('creates a pending row and reads every column back', async () => {
      const ownerId = newId();
      const file = presign(ownerId, new Date('2026-08-16T10:00:00.000Z'));

      await repository.save(file);

      const found = await repository.findByIdForOwner(ORGANIZATION_ID, ownerId, file.id);

      expect(found?.id).toBe(file.id);
      expect(found?.ownerId).toBe(ownerId);
      expect(found?.storageKey).toBe(`uploads/${ORGANIZATION_ID}/${ownerId}/${file.id}`);
      expect(found?.filename).toBe('holiday.png');
      expect(found?.declaredMimeType).toBe('image/png');
      expect(found?.declaredSizeBytes).toBe(DECLARED_SIZE_BYTES);
      expect(found?.status).toBe('pending');
      expect(found?.verifiedMimeType).toBeNull();
      expect(found?.verifiedSizeBytes).toBeNull();
      expect(found?.confirmedAt).toBeNull();
      expect(found?.isUsable).toBe(false);
    });

    it('hides a row from another owner, and from another organization', async () => {
      const ownerId = newId();
      const file = await store(ownerId, new Date('2026-08-16T10:00:00.000Z'));

      await expect(
        repository.findByIdForOwner(ORGANIZATION_ID, newId(), file.id),
      ).resolves.toBeNull();
      await expect(repository.findByIdForOwner(newId(), ownerId, file.id)).resolves.toBeNull();
    });

    it('returns null for an id that was never stored', async () => {
      await expect(
        repository.findByIdForOwner(ORGANIZATION_ID, newId(), newId()),
      ).resolves.toBeNull();
    });
  });

  describe('compareAndSave', () => {
    it('persists the confirm transition and every fact it verified', async () => {
      const ownerId = newId();
      const file = await store(ownerId, new Date('2026-08-16T10:00:00.000Z'));

      file.confirm(
        { mimeType: 'image/png', sizeBytes: DECLARED_SIZE_BYTES },
        new Date('2026-08-16T10:05:00.000Z'),
      );

      await expect(repository.compareAndSave(file, 'pending')).resolves.toBe(true);

      const found = await repository.findByIdForOwner(ORGANIZATION_ID, ownerId, file.id);

      expect(found?.status).toBe('confirmed');
      expect(found?.verifiedMimeType).toBe('image/png');
      expect(found?.verifiedSizeBytes).toBe(DECLARED_SIZE_BYTES);
      expect(found?.confirmedAt?.toISOString()).toBe('2026-08-16T10:05:00.000Z');
      expect(found?.isUsable).toBe(true);
    });

    it('refuses to write once the row has moved on — the loser of a race', async () => {
      const ownerId = newId();
      const file = await storeConfirmed(ownerId, new Date('2026-08-16T10:00:00.000Z'));

      // A second writer still holding the pending view must not overwrite it.
      await expect(repository.compareAndSave(file, 'pending')).resolves.toBe(false);
    });
  });

  describe('listByOwner', () => {
    it('returns this owner confirmed files, and nothing else', async () => {
      const ownerId = newId();
      const mine = await storeConfirmed(ownerId, new Date('2026-08-16T10:00:00.000Z'));
      await storeDiscarded(ownerId, new Date('2026-08-16T10:00:01.000Z'));
      await store(ownerId, new Date('2026-08-16T10:00:02.000Z'));
      await storeConfirmed(newId(), new Date('2026-08-16T10:00:03.000Z'));

      const page = await repository.listByOwner(ORGANIZATION_ID, ownerId, null, 10);

      expect(page.map((file) => file.id)).toEqual([mine.id]);
    });

    it('loses no row and repeats none when every createdAt collides', async () => {
      const ownerId = newId();
      const createdAt = new Date('2026-08-16T10:00:00.000Z');
      const written: string[] = [];

      for (let index = 0; index < 9; index += 1) {
        const file = await storeConfirmed(ownerId, createdAt);
        written.push(file.id);
      }

      const paged = await drainPages(repository, ownerId, 4);

      expect(paged).toHaveLength(written.length);
      expect(new Set(paged)).toEqual(new Set(written));
    });
  });

  describe('findCleanupCandidates', () => {
    it('returns stale pending and discarded rows, but nothing usable', async () => {
      const ownerId = newId();
      const stale = await store(ownerId, new Date('2026-08-16T09:00:00.000Z'));
      await store(ownerId, new Date('2026-08-16T11:00:00.000Z'));
      await storeConfirmed(ownerId, new Date('2026-08-16T09:00:00.000Z'));

      const discarded = await storeDiscarded(ownerId, new Date('2026-08-16T09:00:00.000Z'));

      const found = await repository.findCleanupCandidates(
        new Date('2026-08-16T10:00:00.000Z'),
        10,
      );

      expect(found.map((file) => file.id).sort()).toEqual([stale.id, discarded.id].sort());
    });

    it('honours the batch limit so one sweep cannot claim the whole table', async () => {
      const ownerId = newId();

      for (let index = 0; index < 4; index += 1) {
        await store(ownerId, new Date(Date.parse('2026-08-16T09:00:00.000Z') + index));
      }

      await expect(
        repository.findCleanupCandidates(new Date('2026-08-16T10:00:00.000Z'), 2),
      ).resolves.toHaveLength(2);
    });
  });

  describe('countByOwner', () => {
    it('counts past one page, so a total never collapses to a page size', async () => {
      const ownerId = newId();

      for (let index = 0; index < 7; index += 1) {
        await storeConfirmed(ownerId, new Date(Date.parse('2026-08-16T10:00:00.000Z') + index));
      }

      await expect(repository.countByOwner(ORGANIZATION_ID, ownerId)).resolves.toBe(7);
      await expect(repository.listByOwner(ORGANIZATION_ID, ownerId, null, 5)).resolves.toHaveLength(
        5,
      );
    });

    it('excludes discarded rows, unconfirmed rows and another owner rows', async () => {
      const ownerId = newId();
      await storeConfirmed(ownerId, new Date('2026-08-16T10:00:00.000Z'));
      await storeDiscarded(ownerId, new Date('2026-08-16T10:00:01.000Z'));
      await store(ownerId, new Date('2026-08-16T10:00:02.000Z'));
      await storeConfirmed(newId(), new Date('2026-08-16T10:00:03.000Z'));

      await expect(repository.countByOwner(ORGANIZATION_ID, ownerId)).resolves.toBe(1);
    });

    it('answers zero for an owner with nothing', async () => {
      await expect(repository.countByOwner(ORGANIZATION_ID, newId())).resolves.toBe(0);
    });
  });

  describe('findAllByOwner', () => {
    it('returns every row the owner has, whatever state it is in', async () => {
      // Account deletion has to reach uploads the listing never shows.
      const ownerId = newId();
      const live = await storeConfirmed(ownerId, new Date('2026-08-16T10:00:00.000Z'));
      const discarded = await storeDiscarded(ownerId, new Date('2026-08-16T10:00:01.000Z'));
      const pending = await store(ownerId, new Date('2026-08-16T10:00:02.000Z'));

      const found = await repository.findAllByOwner(ownerId, 10);

      expect(found.map((file) => file.id).sort()).toEqual(
        [live.id, discarded.id, pending.id].sort(),
      );
    });
  });

  describe('transaction participation', () => {
    it('writes on the caller transaction, so a rollback takes the row with it', async () => {
      const ownerId = newId();
      const file = presign(ownerId);

      await expect(
        prisma.transaction(async () => {
          await repository.save(file);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');

      await expect(
        repository.findByIdForOwner(ORGANIZATION_ID, ownerId, file.id),
      ).resolves.toBeNull();
    });
  });
});

async function drainPages(
  repository: PrismaStoredFileRepository,
  ownerId: string,
  limit: number,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: DecodedCursor | null = null;

  for (;;) {
    const page: StoredFile[] = await repository.listByOwner(
      ORGANIZATION_ID,
      ownerId,
      cursor,
      limit,
    );

    seen.push(...page.map((file) => file.id));

    const last = page.at(-1);
    if (last === undefined || page.length < limit) {
      return seen;
    }

    cursor = decodeCursor(encodeCursor(last.createdAt, last.id));
  }
}
