import { Injectable } from '@nestjs/common';

import { PrismaService } from '#platform/prisma';
import type { DecodedCursor } from '#shared/pagination';

import { StoredFile, type StoredFileStatus } from '../domain/stored-file.entity';
import type { StoredFileRepository } from '../domain/stored-file.repository';

@Injectable()
export class PrismaStoredFileRepository implements StoredFileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.currentTransaction ?? this.prisma.db;
  }

  async findByIdForOwner(
    organizationId: string,
    ownerId: string,
    id: string,
  ): Promise<StoredFile | null> {
    const row = await this.client.storedFile.findFirst({
      where: { id, organizationId, ownerId },
    });

    return row === null ? null : toAggregate(row);
  }

  async save(file: StoredFile): Promise<void> {
    await this.client.storedFile.create({
      data: {
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
      },
    });
  }

  async compareAndSave(file: StoredFile, expectedStatus: StoredFileStatus): Promise<boolean> {
    const result = await this.client.storedFile.updateMany({
      where: { id: file.id, organizationId: file.organizationId, status: expectedStatus },
      data: {
        verifiedMimeType: file.verifiedMimeType,
        verifiedSizeBytes: file.verifiedSizeBytes,
        status: file.status,
        confirmedAt: file.confirmedAt,
      },
    });

    return result.count === 1;
  }

  async listByOwner(
    organizationId: string,
    ownerId: string,
    cursor: DecodedCursor | null,
    limit: number,
  ): Promise<StoredFile[]> {
    const rows = await this.client.storedFile.findMany({
      where: {
        ownerId,
        organizationId,
        status: 'confirmed',
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: cursor.sortValue } },
                { createdAt: cursor.sortValue, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return rows.map(toAggregate);
  }

  async countByOwner(organizationId: string, ownerId: string): Promise<number> {
    return this.client.storedFile.count({
      where: { organizationId, ownerId, status: 'confirmed' },
    });
  }

  async findCleanupCandidates(olderThan: Date, limit: number): Promise<StoredFile[]> {
    const rows = await this.client.storedFile.findMany({
      where: {
        OR: [{ status: 'discarded' }, { status: 'pending', createdAt: { lt: olderThan } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return rows.map(toAggregate);
  }

  async deleteById(id: string): Promise<void> {
    await this.client.storedFile.deleteMany({ where: { id } });
  }

  async findAllByOwner(ownerId: string, limit: number): Promise<StoredFile[]> {
    const rows = await this.client.storedFile.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return rows.map(toAggregate);
  }
}

interface StoredFileRow {
  id: string;
  organizationId: string;
  ownerId: string;
  storageKey: string;
  filename: string;
  declaredMimeType: string;
  declaredSizeBytes: number;
  verifiedMimeType: string | null;
  verifiedSizeBytes: number | null;
  status: string;
  createdAt: Date;
  confirmedAt: Date | null;
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
    status: row.status as StoredFileStatus,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  });
}
