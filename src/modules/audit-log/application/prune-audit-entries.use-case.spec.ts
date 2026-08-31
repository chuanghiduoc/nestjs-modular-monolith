import { beforeEach, describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { InMemoryAuditRepository } from '../../../../test/support/in-memory/in-memory-audit.repository';
import type { AuditEntry } from '../domain/audit-entry';
import { PruneAuditEntriesUseCase } from './prune-audit-entries.use-case';

const NOW = new Date('2026-08-17T00:00:00.000Z');
const RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

describe('PruneAuditEntriesUseCase', () => {
  let entries: InMemoryAuditRepository;
  let useCase: PruneAuditEntriesUseCase;

  beforeEach(() => {
    entries = new InMemoryAuditRepository();
    useCase = new PruneAuditEntriesUseCase(entries, { retentionDays: RETENTION_DAYS });
  });

  function seedAt(daysAgo: number): AuditEntry {
    const entry: AuditEntry = {
      id: newId(),
      occurredAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
      actorId: null,
      organizationId: null,
      action: 'users.registered',
      resource: 'user',
      resourceId: null,
      requestId: null,
      metadata: {},
    };

    entries.seed(entry);

    return entry;
  }

  it('deletes only what is older than the retention window', async () => {
    const stale = seedAt(RETENTION_DAYS + 1);
    const fresh = seedAt(RETENTION_DAYS - 1);

    const deleted = await useCase.execute(NOW);

    expect(deleted).toBe(1);
    expect(entries.rowOf(stale.id)).toBeNull();
    expect(entries.rowOf(fresh.id)).not.toBeNull();
  });

  it('keeps an entry that sits exactly on the boundary', async () => {
    const boundary = seedAt(RETENTION_DAYS);

    expect(await useCase.execute(NOW)).toBe(0);
    expect(entries.rowOf(boundary.id)).not.toBeNull();
  });

  it('reports nothing to do on an empty table', async () => {
    expect(await useCase.execute(NOW)).toBe(0);
  });
});
