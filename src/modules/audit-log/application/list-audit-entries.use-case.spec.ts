import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { decodeCursor } from '#shared/pagination';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import { InMemoryAuditRepository, TestJournal } from '../../../../test/support/in-memory';
import { type AuditEntry, createAuditEntry } from '../domain/audit-entry';
import {
  DEFAULT_PAGE_SIZE,
  ListAuditEntriesUseCase,
  MAX_PAGE_SIZE,
} from './list-audit-entries.use-case';

const ACTOR_ID = newId();
const OTHER_ACTOR_ID = newId();
const BASE_TIME = new Date('2026-08-16T10:00:00.000Z');
const MINUTE_MS = 60_000;

function createHarness() {
  const journal = new TestJournal();
  const entries = new InMemoryAuditRepository({ journal });

  return { journal, entries, useCase: new ListAuditEntriesUseCase(entries) };
}

type Harness = ReturnType<typeof createHarness>;

interface SeedInput {
  readonly occurredAt: Date;
  readonly actorId?: string;
  readonly resource?: string;
}

function seedEntry(harness: Harness, input: SeedInput): AuditEntry {
  const entry = createAuditEntry({
    action: 'user.registered',
    resource: input.resource ?? 'user',
    actorId: input.actorId ?? ACTOR_ID,
    occurredAt: input.occurredAt,
  });

  harness.entries.seed(entry);

  return entry;
}

function seedEntries(harness: Harness, count: number): AuditEntry[] {
  return Array.from({ length: count }, (_unused, index) =>
    seedEntry(harness, { occurredAt: new Date(BASE_TIME.getTime() - index * MINUTE_MS) }),
  );
}

describe('ListAuditEntriesUseCase', () => {
  it('caps the page at MAX_PAGE_SIZE however large a limit is asked for', async () => {
    const harness = createHarness();
    seedEntries(harness, MAX_PAGE_SIZE + 1);

    const page = await harness.useCase.execute({ limit: 10_000 });

    expect(page.entries).toHaveLength(MAX_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it('falls back to the default page size', async () => {
    const harness = createHarness();
    seedEntries(harness, DEFAULT_PAGE_SIZE + 1);

    const page = await harness.useCase.execute({});

    expect(page.entries).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it('reports no next page when the last row exactly fills it', async () => {
    const harness = createHarness();
    seedEntries(harness, 2);

    const page = await harness.useCase.execute({ limit: 2 });

    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(false);
  });

  it('returns a lastCursor that decodes to the last row of the page', async () => {
    const harness = createHarness();
    const seeded = seedEntries(harness, 3);

    const page = await harness.useCase.execute({ limit: 2 });

    const decoded = decodeCursor(page.lastCursor!);
    expect(decoded.id).toBe(seeded[1]!.id);
    expect(decoded.sortValue.toISOString()).toBe(seeded[1]!.occurredAt.toISOString());
  });

  it('walks the whole set without dropping or repeating a row', async () => {
    const harness = createHarness();
    const seeded = seedEntries(harness, 5);

    const first = await harness.useCase.execute({ limit: 2 });
    const second = await harness.useCase.execute({ limit: 2, startingAfter: first.lastCursor! });
    const third = await harness.useCase.execute({ limit: 2, startingAfter: second.lastCursor! });

    const seen = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.id);
    expect(seen).toEqual(seeded.map((entry) => entry.id));
    expect(new Set(seen).size).toBe(seeded.length);
    expect(third.hasMore).toBe(false);
  });

  it('breaks a timestamp tie on the id, in both the order and the cursor', async () => {
    const harness = createHarness();
    const collided = [
      seedEntry(harness, { occurredAt: BASE_TIME }),
      seedEntry(harness, { occurredAt: BASE_TIME }),
      seedEntry(harness, { occurredAt: BASE_TIME }),
    ].sort((left, right) => (left.id < right.id ? 1 : -1));

    const first = await harness.useCase.execute({ limit: 2 });
    const second = await harness.useCase.execute({ limit: 2, startingAfter: first.lastCursor! });

    expect(first.entries.map((entry) => entry.id)).toEqual([collided[0]!.id, collided[1]!.id]);
    expect(second.entries.map((entry) => entry.id)).toEqual([collided[2]!.id]);
  });

  it('narrows by actor and by resource', async () => {
    const harness = createHarness();
    const mine = seedEntry(harness, { occurredAt: BASE_TIME });
    seedEntry(harness, { occurredAt: BASE_TIME, actorId: OTHER_ACTOR_ID });
    seedEntry(harness, { occurredAt: BASE_TIME, resource: 'upload' });

    const byActor = await harness.useCase.execute({ filter: { actorId: ACTOR_ID } });
    const byResource = await harness.useCase.execute({ filter: { resource: 'upload' } });

    expect(byActor.entries.map((entry) => entry.id)).toContain(mine.id);
    expect(byActor.entries).toHaveLength(2);
    expect(byResource.entries).toHaveLength(1);
  });

  it('answers a corrupted cursor with malformed, never validation', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() =>
      harness.useCase.execute({ startingAfter: 'not-a-cursor' }),
    );

    expect(error.kind).toBe('malformed');
    expect(error.code).toBe(ERROR_CODES.CURSOR_MALFORMED);
  });

  it('projects the row without the request id', async () => {
    const harness = createHarness();
    harness.entries.seed(
      createAuditEntry({
        action: 'user.registered',
        resource: 'user',
        actorId: ACTOR_ID,
        requestId: 'req-secret',
        occurredAt: BASE_TIME,
      }),
    );

    const page = await harness.useCase.execute({});

    expect(page.entries[0]).not.toHaveProperty('requestId');
  });
});
