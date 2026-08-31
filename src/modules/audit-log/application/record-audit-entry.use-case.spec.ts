import { describe, expect, it } from 'vitest';

import { isUuidV7, newId } from '#shared/util';

import { InMemoryAuditRepository, TestJournal } from '../../../../test/support/in-memory';
import { RecordAuditEntryUseCase } from './record-audit-entry.use-case';

const ACTOR_ID = newId();
const EVENT_ID = newId();

function createHarness() {
  const journal = new TestJournal();
  const entries = new InMemoryAuditRepository({ journal });

  return { journal, entries, useCase: new RecordAuditEntryUseCase(entries) };
}

describe('RecordAuditEntryUseCase', () => {
  it('records an entry and reports that a row was written', async () => {
    const harness = createHarness();
    const occurredAt = new Date('2026-08-16T10:00:00.000Z');

    const written = await harness.useCase.execute({
      id: EVENT_ID,
      action: 'user.registered',
      resource: 'user',
      resourceId: ACTOR_ID,
      actorId: ACTOR_ID,
      organizationId: null,
      requestId: 'req-1',
      metadata: { source: 'queue' },
      occurredAt,
    });

    expect(written).toBe(true);
    expect(harness.entries.rowOf(EVENT_ID)).toEqual({
      id: EVENT_ID,
      occurredAt,
      actorId: ACTOR_ID,
      organizationId: null,
      action: 'user.registered',
      resource: 'user',
      resourceId: ACTOR_ID,
      requestId: 'req-1',
      metadata: { source: 'queue' },
    });
  });

  it('reports false for a redelivered event instead of writing a second row', async () => {
    const harness = createHarness();
    const input = { id: EVENT_ID, action: 'user.registered', resource: 'user' };

    expect(await harness.useCase.execute(input)).toBe(true);
    expect(await harness.useCase.execute(input)).toBe(false);
    expect(harness.entries.size).toBe(1);
  });

  it('does not overwrite the first row when the same event arrives again', async () => {
    const harness = createHarness();
    await harness.useCase.execute({
      id: EVENT_ID,
      action: 'user.registered',
      resource: 'user',
      metadata: { attempt: 'first' },
    });

    await harness.useCase.execute({
      id: EVENT_ID,
      action: 'user.registered',
      resource: 'user',
      metadata: { attempt: 'second' },
    });

    expect(harness.entries.rowOf(EVENT_ID)?.metadata).toEqual({ attempt: 'first' });
  });

  it('mints an id and fills the optional columns for an entry with no event behind it', async () => {
    const harness = createHarness();

    await harness.useCase.execute({ action: 'upload.presigned', resource: 'upload' });

    const [entry] = await harness.entries.listPage(null, 10, {});
    expect(isUuidV7(entry!.id)).toBe(true);
    expect(entry?.actorId).toBeNull();
    expect(entry?.resourceId).toBeNull();
    expect(entry?.requestId).toBeNull();
    expect(entry?.metadata).toEqual({});
  });
});
