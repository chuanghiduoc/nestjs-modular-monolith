import type { DecodedCursor } from '#shared/pagination';

import type {
  AuditEntryFilter,
  AuditRepository,
} from '../../../src/modules/audit-log/domain/audit.repository';
import type { AuditEntry } from '../../../src/modules/audit-log/domain/audit-entry';
import type { TransactionParticipant } from './in-memory-unit-of-work';
import { type JournalOptions, TestJournal } from './journal';
import { byKeyDescending, comesAfterCursor } from './ordering';

export class InMemoryAuditRepository implements AuditRepository, TransactionParticipant {
  readonly journal: TestJournal;

  private rows = new Map<string, AuditEntry>();

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  snapshot(): () => void {
    const captured = new Map(this.rows);

    return () => {
      this.rows = captured;
    };
  }

  seed(entry: AuditEntry): void {
    this.rows.set(entry.id, entry);
  }

  get size(): number {
    return this.rows.size;
  }

  rowOf(id: string): AuditEntry | null {
    return this.rows.get(id) ?? null;
  }

  recordIfAbsent(entry: AuditEntry): Promise<boolean> {
    this.journal.record('audit', 'recordIfAbsent', entry.id);

    if (this.rows.has(entry.id)) {
      return Promise.resolve(false);
    }

    this.rows.set(entry.id, { ...entry, metadata: { ...entry.metadata } });

    return Promise.resolve(true);
  }

  listPage(
    cursor: DecodedCursor | null,
    limit: number,
    filter: AuditEntryFilter,
  ): Promise<AuditEntry[]> {
    const page = [...this.rows.values()]
      .filter((row) => filter.actorId === undefined || row.actorId === filter.actorId)
      .filter((row) => filter.resource === undefined || row.resource === filter.resource)
      .filter((row) => comesAfterCursor(cursor, { sortValue: row.occurredAt, id: row.id }))
      .sort((left, right) =>
        byKeyDescending(
          { sortValue: left.occurredAt, id: left.id },
          { sortValue: right.occurredAt, id: right.id },
        ),
      )
      .slice(0, limit);

    return Promise.resolve(page);
  }

  deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    this.journal.record('audit', 'deleteOlderThan', cutoff.toISOString());

    const doomed = [...this.rows.values()]
      .filter((row) => row.occurredAt < cutoff)
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
      .slice(0, limit);

    for (const row of doomed) {
      this.rows.delete(row.id);
    }

    return Promise.resolve(doomed.length);
  }
}
