import { Injectable } from '@nestjs/common';

import { PrismaService } from '#platform/prisma';

import type { AvatarFileRepository } from '../domain/avatar-file.repository';

@Injectable()
export class PrismaAvatarFileRepository implements AvatarFileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async existsUsableForOwner(fileId: string, ownerId: string): Promise<boolean> {
    const count = await this.prisma.db.storedFile.count({
      where: { id: fileId, ownerId, status: 'confirmed' },
    });

    return count > 0;
  }
}
