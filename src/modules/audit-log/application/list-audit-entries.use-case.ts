import { Inject, Injectable } from '@nestjs/common';

import { decodeOptionalCursor, encodeCursor } from '#shared/pagination';

import {
  AUDIT_REPOSITORY,
  type AuditEntryFilter,
  type AuditRepository,
} from '../domain/audit.repository';
import type { AuditEntry } from '../domain/audit-entry';
import type { AuditEntryPage, AuditEntryView } from './dto/audit-entry.dto';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface ListAuditEntriesInput {
  readonly startingAfter?: string;
  readonly limit?: number;
  readonly filter?: AuditEntryFilter;
}

@Injectable()
export class ListAuditEntriesUseCase {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly entries: AuditRepository) {}

  async execute(input: ListAuditEntriesInput): Promise<AuditEntryPage> {
    const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const cursor = decodeOptionalCursor(input.startingAfter);

    const rows = await this.entries.listPage(cursor, limit + 1, input.filter ?? {});
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      entries: page.map(toView),
      hasMore,
      lastCursor: last === undefined ? null : encodeCursor(last.occurredAt, last.id),
    };
  }
}

function toView(entry: AuditEntry): AuditEntryView {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    actorId: entry.actorId,
    organizationId: entry.organizationId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    metadata: entry.metadata,
  };
}
