import { Injectable } from '@nestjs/common';

import { type Prisma, PrismaService } from '#platform/prisma';
import type { DecodedCursor } from '#shared/pagination';

import type { AuditEntryFilter, AuditRepository } from '../domain/audit.repository';
import type { AuditEntry } from '../domain/audit-entry';

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.currentTransaction ?? this.prisma.db;
  }

  async recordIfAbsent(entry: AuditEntry): Promise<boolean> {
    const result = await this.client.auditLog.createMany({
      data: [
        {
          id: entry.id,
          occurredAt: entry.occurredAt,
          actorId: entry.actorId,
          organizationId: entry.organizationId,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          requestId: entry.requestId,
          metadata: toJsonObject(entry.metadata),
        },
      ],
      skipDuplicates: true,
    });

    return result.count > 0;
  }

  async listPage(
    cursor: DecodedCursor | null,
    limit: number,
    filter: AuditEntryFilter,
  ): Promise<AuditEntry[]> {
    const rows = await this.client.auditLog.findMany({
      where: {
        ...(filter.organizationId === undefined ? {} : { organizationId: filter.organizationId }),
        ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
        ...(filter.resource === undefined ? {} : { resource: filter.resource }),

        ...(cursor === null
          ? {}
          : {
              OR: [
                { occurredAt: { lt: cursor.sortValue } },
                { occurredAt: cursor.sortValue, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return rows.map((row): AuditEntry => ({
      id: row.id,
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      organizationId: row.organizationId,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      requestId: row.requestId,
      metadata: toMetadata(row.metadata),
    }));
  }

  async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    return this.client.$executeRaw`
      DELETE FROM audit.audit_log
       WHERE id IN (
         SELECT id FROM audit.audit_log
          WHERE occurred_at < ${cutoff}
          ORDER BY occurred_at
          LIMIT ${limit}
       )`;
  }
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function toMetadata(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
