import type { DecodedCursor } from '#shared/pagination';

import {
  StoredFile,
  type StoredFileStatus,
} from '../../../src/modules/upload/domain/stored-file.entity';
import type { StoredFileRepository } from '../../../src/modules/upload/domain/stored-file.repository';
import type { TransactionParticipant } from './in-memory-unit-of-work';
import { type JournalOptions, TestJournal } from './journal';
import { byKeyAscending, byKeyDescending, comesAfterCursor } from './ordering';

interface StoredFileRow {
  readonly id: string;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly storageKey: string;
  readonly filename: string;
  readonly declaredMimeType: string;
  readonly declaredSizeBytes: number;
  readonly verifiedMimeType: string | null;
  readonly verifiedSizeBytes: number | null;
  readonly status: StoredFileStatus;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
}

export class InMemoryStoredFileRepository implements StoredFileRepository, TransactionParticipant {
  readonly journal: TestJournal;

  private rows = new Map<string, StoredFileRow>();

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  snapshot(): () => void {
    const captured = new Map(this.rows);

    return () => {
      this.rows = captured;
    };
  }

  seed(file: StoredFile): void {
    this.rows.set(file.id, toRow(file));
  }

  get size(): number {
    return this.rows.size;
  }

  rowOf(id: string): StoredFile | null {
    const row = this.rows.get(id);

    return row === undefined ? null : toAggregate(row);
  }

  findByIdForOwner(
    organizationId: string,
    ownerId: string,
    id: string,
  ): Promise<StoredFile | null> {
    const row = this.rows.get(id);

    return Promise.resolve(
      row?.ownerId !== ownerId || row.organizationId !== organizationId ? null : toAggregate(row),
    );
  }

  save(file: StoredFile): Promise<void> {
    this.rows.set(file.id, toRow(file));
    this.journal.record('files', 'save', file.id);

    return Promise.resolve();
  }

  compareAndSave(file: StoredFile, expectedStatus: StoredFileStatus): Promise<boolean> {
    const current = this.rows.get(file.id);

    this.journal.record('files', 'compareAndSave', file.id);

    if (current?.status !== expectedStatus) {
      return Promise.resolve(false);
    }

    this.rows.set(file.id, toRow(file));

    return Promise.resolve(true);
  }

  listByOwner(
    organizationId: string,
    ownerId: string,
    cursor: DecodedCursor | null,
    limit: number,
  ): Promise<StoredFile[]> {
    const page = [...this.rows.values()]
      .filter((row) => row.ownerId === ownerId && row.status === 'confirmed')
      .filter((row) => row.organizationId === organizationId)
      .filter((row) => comesAfterCursor(cursor, { sortValue: row.createdAt, id: row.id }))
      .sort((left, right) =>
        byKeyDescending(
          { sortValue: left.createdAt, id: left.id },
          { sortValue: right.createdAt, id: right.id },
        ),
      )
      .slice(0, limit);

    return Promise.resolve(page.map(toAggregate));
  }

  countByOwner(organizationId: string, ownerId: string): Promise<number> {
    const total = [...this.rows.values()].filter(
      (row) =>
        row.ownerId === ownerId &&
        row.organizationId === organizationId &&
        row.status === 'confirmed',
    ).length;

    return Promise.resolve(total);
  }

  findCleanupCandidates(olderThan: Date, limit: number): Promise<StoredFile[]> {
    const page = [...this.rows.values()]
      .filter(
        (row) =>
          row.status === 'discarded' ||
          (row.status === 'pending' && row.createdAt.getTime() < olderThan.getTime()),
      )
      .sort((left, right) =>
        byKeyAscending(
          { sortValue: left.createdAt, id: left.id },
          { sortValue: right.createdAt, id: right.id },
        ),
      )
      .slice(0, limit);

    return Promise.resolve(page.map(toAggregate));
  }

  deleteById(id: string): Promise<void> {
    this.rows.delete(id);
    this.journal.record('files', 'deleteById', id);

    return Promise.resolve();
  }

  findAllByOwner(ownerId: string, limit: number): Promise<StoredFile[]> {
    const page = [...this.rows.values()]
      .filter((row) => row.ownerId === ownerId)
      .sort((left, right) =>
        byKeyAscending(
          { sortValue: left.createdAt, id: left.id },
          { sortValue: right.createdAt, id: right.id },
        ),
      )
      .slice(0, limit);

    return Promise.resolve(page.map(toAggregate));
  }
}

function toRow(file: StoredFile): StoredFileRow {
  return {
    id: file.id,
    organizationId: file.organizationId,
    ownerId: file.ownerId,
    storageKey: file.storageKey,
    filename: file.filename,
    declaredMimeType: file.declaredMimeType,
    declaredSizeBytes: file.declaredSizeBytes,
    verifiedMimeType: file.verifiedMimeType,
    verifiedSizeBytes: file.verifiedSizeBytes,
    status: file.status,
    createdAt: file.createdAt,
    confirmedAt: file.confirmedAt,
  };
}

function toAggregate(row: StoredFileRow): StoredFile {
  return StoredFile.rehydrate({
    id: row.id,
    organizationId: row.organizationId,
    ownerId: row.ownerId,
    storageKey: row.storageKey,
    filename: row.filename,
    declaredMimeType: row.declaredMimeType,
    declaredSizeBytes: row.declaredSizeBytes,
    verifiedMimeType: row.verifiedMimeType,
    verifiedSizeBytes: row.verifiedSizeBytes,
    status: row.status,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  });
}
