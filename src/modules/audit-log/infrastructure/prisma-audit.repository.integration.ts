import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '#platform/prisma';
import { decodeCursor, type DecodedCursor, encodeCursor } from '#shared/pagination';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../../test/support/database';
import { type AuditEntry, createAuditEntry } from '../domain/audit-entry';
import { PrismaAuditRepository } from './prisma-audit.repository';

describe('PrismaAuditRepository (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let repository: PrismaAuditRepository;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
    repository = new PrismaAuditRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
  });

  describe('recordIfAbsent', () => {
    it('writes an entry and reads it back unchanged', async () => {
      const entry = createAuditEntry({
        id: newId(),
        occurredAt: new Date('2026-08-16T10:00:00.123Z'),
        actorId: newId(),
        action: 'users.registered',
        resource: 'users',
        resourceId: newId(),
        requestId: newId(),
        metadata: { schemaVersion: 1, source: 'trigger' },
      });

      await expect(repository.recordIfAbsent(entry)).resolves.toBe(true);

      const [stored] = await repository.listPage(null, 10, {});

      expect(stored).toEqual(entry);
      expect(stored?.occurredAt.toISOString()).toBe('2026-08-16T10:00:00.123Z');
    });

    it('is idempotent: the same id twice writes one row and reports the duplicate', async () => {
      const entry = auditEntryAt(new Date('2026-08-16T10:00:00.000Z'));

      await expect(repository.recordIfAbsent(entry)).resolves.toBe(true);
      await expect(repository.recordIfAbsent(entry)).resolves.toBe(false);

      await expect(repository.listPage(null, 10, {})).resolves.toHaveLength(1);
    });

    it('drops undefined metadata values instead of handing them to the driver', async () => {
      const entry: AuditEntry = {
        ...auditEntryAt(new Date('2026-08-16T10:00:00.000Z')),
        metadata: { kept: 'yes', dropped: undefined },
      };

      await repository.recordIfAbsent(entry);

      const [stored] = await repository.listPage(null, 10, {});

      expect(stored?.metadata).toEqual({ kept: 'yes' });
    });
  });

  describe('listPage', () => {
    it('loses no row and repeats none when every timestamp collides', async () => {
      const occurredAt = new Date('2026-08-16T10:00:00.000Z');
      const written = await Promise.all(
        Array.from({ length: 9 }, async () => {
          const entry = auditEntryAt(occurredAt);
          await repository.recordIfAbsent(entry);

          return entry.id;
        }),
      );

      const paged = await drainPages(repository, 4);

      expect(paged).toHaveLength(written.length);
      expect(new Set(paged)).toEqual(new Set(written));
      expect(paged).toEqual([...paged].sort(descendingOrdinal));
    });

    it('pages correctly when timestamps are distinct', async () => {
      const base = Date.parse('2026-08-16T10:00:00.000Z');
      const written: string[] = [];

      for (let index = 0; index < 7; index += 1) {
        const entry = auditEntryAt(new Date(base + index * 1000));
        await repository.recordIfAbsent(entry);
        written.push(entry.id);
      }

      const paged = await drainPages(repository, 3);

      expect(new Set(paged)).toEqual(new Set(written));
      expect(paged).toHaveLength(written.length);
    });

    it('filters by actor and by resource', async () => {
      const actorId = newId();
      const occurredAt = new Date('2026-08-16T10:00:00.000Z');

      await repository.recordIfAbsent({ ...auditEntryAt(occurredAt), actorId, resource: 'users' });
      await repository.recordIfAbsent({ ...auditEntryAt(occurredAt), resource: 'uploads' });

      await expect(repository.listPage(null, 10, { actorId })).resolves.toHaveLength(1);
      await expect(repository.listPage(null, 10, { resource: 'uploads' })).resolves.toHaveLength(1);
      await expect(repository.listPage(null, 10, { resource: 'nothing' })).resolves.toHaveLength(0);
    });
  });

  describe('transaction participation', () => {
    it('writes on the caller transaction, so a rollback takes the row with it', async () => {
      const entry = auditEntryAt(new Date('2026-08-16T10:00:00.000Z'));

      await expect(
        prisma.transaction(async () => {
          await repository.recordIfAbsent(entry);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');

      await expect(repository.listPage(null, 10, {})).resolves.toEqual([]);
    });

    it('commits the row when the transaction commits', async () => {
      const entry = auditEntryAt(new Date('2026-08-16T10:00:00.000Z'));

      await prisma.transaction(async () => {
        await repository.recordIfAbsent(entry);
      });

      await expect(repository.listPage(null, 10, {})).resolves.toHaveLength(1);
    });
  });

  describe('deleteOlderThan', () => {
    const CUTOFF = new Date('2026-08-16T00:00:00.000Z');

    it('deletes strictly older rows and leaves the boundary row alone', async () => {
      const older = auditEntryAt(new Date('2026-08-15T23:59:59.999Z'));
      const boundary = auditEntryAt(CUTOFF);
      const newer = auditEntryAt(new Date('2026-08-16T00:00:00.001Z'));

      for (const entry of [older, boundary, newer]) {
        await repository.recordIfAbsent(entry);
      }

      await expect(repository.deleteOlderThan(CUTOFF, 100)).resolves.toBe(1);

      const remaining = await repository.listPage(null, 10, {});

      expect(remaining.map((entry) => entry.id).sort()).toEqual([boundary.id, newer.id].sort());
    });

    it('honours the batch limit, so one pass cannot lock the whole table', async () => {
      for (let index = 0; index < 5; index++) {
        await repository.recordIfAbsent(
          auditEntryAt(new Date(CUTOFF.getTime() - (index + 1) * 1_000)),
        );
      }

      await expect(repository.deleteOlderThan(CUTOFF, 2)).resolves.toBe(2);
      await expect(repository.listPage(null, 10, {})).resolves.toHaveLength(3);
    });

    it('deletes the oldest rows first, so repeated passes converge', async () => {
      const oldest = auditEntryAt(new Date('2026-08-10T00:00:00.000Z'));
      const middle = auditEntryAt(new Date('2026-08-12T00:00:00.000Z'));
      const newest = auditEntryAt(new Date('2026-08-14T00:00:00.000Z'));

      for (const entry of [newest, oldest, middle]) {
        await repository.recordIfAbsent(entry);
      }

      await repository.deleteOlderThan(CUTOFF, 1);

      const remaining = await repository.listPage(null, 10, {});

      expect(remaining.map((entry) => entry.id)).not.toContain(oldest.id);
      expect(remaining).toHaveLength(2);
    });

    it('reports zero on an empty table instead of failing', async () => {
      await expect(repository.deleteOlderThan(CUTOFF, 100)).resolves.toBe(0);
    });
  });
});

function descendingOrdinal(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
}

function auditEntryAt(occurredAt: Date): AuditEntry {
  return createAuditEntry({
    id: newId(),
    occurredAt,
    action: 'users.registered',
    resource: 'users',
  });
}

async function drainPages(repository: PrismaAuditRepository, limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: DecodedCursor | null = null;

  for (;;) {
    const page: AuditEntry[] = await repository.listPage(cursor, limit, {});

    seen.push(...page.map((entry) => entry.id));

    const last = page.at(-1);
    if (last === undefined || page.length < limit) {
      return seen;
    }

    cursor = decodeCursor(encodeCursor(last.occurredAt, last.id));
  }
}
