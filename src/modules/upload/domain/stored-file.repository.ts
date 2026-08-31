import type { DecodedCursor } from '#shared/pagination';

import type { StoredFile, StoredFileStatus } from './stored-file.entity';

export interface StoredFileRepository {
  findByIdForOwner(organizationId: string, ownerId: string, id: string): Promise<StoredFile | null>;
  save(file: StoredFile): Promise<void>;

  /**
   * Writes only if the row is still in the state this aggregate was loaded
   * from. Two confirmations of the same upload race here, and exactly one wins.
   */
  compareAndSave(file: StoredFile, expectedStatus: StoredFileStatus): Promise<boolean>;

  listByOwner(
    organizationId: string,
    ownerId: string,
    cursor: DecodedCursor | null,
    limit: number,
  ): Promise<StoredFile[]>;
  countByOwner(organizationId: string, ownerId: string): Promise<number>;

  /** Discarded uploads, plus pending ones the caller never finished. */
  findCleanupCandidates(olderThan: Date, limit: number): Promise<StoredFile[]>;
  findAllByOwner(ownerId: string, limit: number): Promise<StoredFile[]>;

  deleteById(id: string): Promise<void>;
}

export const STORED_FILE_REPOSITORY = Symbol('STORED_FILE_REPOSITORY');
