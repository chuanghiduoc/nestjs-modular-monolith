import type { DecodedCursor } from '#shared/pagination';

import type { AuditEntry } from './audit-entry';

export interface AuditEntryFilter {
  readonly organizationId?: string;
  readonly actorId?: string;
  readonly resource?: string;
}

export interface AuditRepository {
  recordIfAbsent(entry: AuditEntry): Promise<boolean>;

  listPage(
    cursor: DecodedCursor | null,
    limit: number,
    filter: AuditEntryFilter,
  ): Promise<AuditEntry[]>;

  deleteOlderThan(cutoff: Date, limit: number): Promise<number>;
}

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
