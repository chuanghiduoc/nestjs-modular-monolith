import { Injectable } from '@nestjs/common';

import { PrismaService } from '#platform/prisma';
import type { DecodedCursor } from '#shared/pagination';

import type {
  UserIdentity,
  UserProfileWithIdentity,
  UserRepository,
} from '../domain/user.repository';
import { UserProfile } from '../domain/user-profile.entity';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.currentTransaction ?? this.prisma.db;
  }

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const row = await this.client.userProfile.findUnique({ where: { userId } });

    return row === null ? null : toAggregate(row);
  }

  async findIdentity(userId: string): Promise<UserIdentity | null> {
    const row = await this.client.user.findUnique({ where: { id: userId } });

    return row === null
      ? null
      : {
          userId: row.id,
          email: row.email,
          emailVerified: row.emailVerified,
          role: row.role,
          createdAt: row.createdAt,
        };
  }

  async save(profile: UserProfile): Promise<void> {
    await this.client.userProfile.upsert({
      where: { userId: profile.userId },
      create: {
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        avatarFileId: profile.avatarFileId,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      update: {
        displayName: profile.displayName,
        avatarFileId: profile.avatarFileId,
        updatedAt: profile.updatedAt,
      },
    });
  }

  async deleteByUserId(userId: string): Promise<boolean> {
    const result = await this.client.userProfile.deleteMany({ where: { userId } });

    return result.count > 0;
  }

  async listPage(
    cursor: DecodedCursor | null,
    limit: number,
    organizationId?: string,
  ): Promise<UserProfileWithIdentity[]> {
    const rows = await this.client.userProfile.findMany({
      where: {
        ...(organizationId === undefined
          ? {}
          : {
              user: {
                organizationMemberships: {
                  some: { organizationId, organization: { archivedAt: null } },
                },
              },
            }),
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

    if (rows.length === 0) {
      return [];
    }

    const identities = await this.client.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
    });
    const byId = new Map(identities.map((identity) => [identity.id, identity]));

    return rows.flatMap((row): UserProfileWithIdentity[] => {
      const identity = byId.get(row.userId);

      if (identity === undefined) {
        return [];
      }

      return [
        {
          profile: toAggregate(row),
          identity: {
            userId: identity.id,
            email: identity.email,
            emailVerified: identity.emailVerified,
            role: identity.role,
            createdAt: identity.createdAt,
          },
        },
      ];
    });
  }
}

interface UserProfileRow {
  id: string;
  userId: string;
  displayName: string;
  avatarFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toAggregate(row: UserProfileRow): UserProfile {
  return UserProfile.rehydrate({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    avatarFileId: row.avatarFileId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
