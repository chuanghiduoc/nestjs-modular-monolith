import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '#platform/prisma';
import { decodeCursor, type DecodedCursor, encodeCursor } from '#shared/pagination';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../../test/support/database';
import type { UserProfileWithIdentity } from '../domain/user.repository';
import { UserProfile } from '../domain/user-profile.entity';
import { PrismaUserRepository } from './prisma-user.repository';

describe('PrismaUserRepository (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let repository: PrismaUserRepository;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
    repository = new PrismaUserRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
  });

  async function seedIdentity(userId: string = newId()): Promise<string> {
    await prisma.db.user.create({
      data: {
        id: userId,
        name: 'Seeded User',
        email: `${userId}@example.com`,
        emailVerified: false,
        role: 'member',
      },
    });

    return userId;
  }

  async function seedProfile(userId: string, createdAt: Date): Promise<UserProfile> {
    const profile = UserProfile.create({ userId, displayName: 'Seeded Name', now: createdAt });
    await repository.save(profile);

    return profile;
  }

  describe('save', () => {
    it('creates a profile and reads it back as an aggregate', async () => {
      const userId = await seedIdentity();
      const profile = UserProfile.create({ userId, displayName: 'Ada Lovelace' });

      await repository.save(profile);

      const found = await repository.findByUserId(userId);

      expect(found).toBeInstanceOf(UserProfile);
      expect(found?.id).toBe(profile.id);
      expect(found?.displayName).toBe('Ada Lovelace');
      expect(found?.avatarFileId).toBeNull();
    });

    it('updates an existing profile without changing its id or creation time', async () => {
      const userId = await seedIdentity();
      const profile = await seedProfile(userId, new Date('2026-08-16T10:00:00.000Z'));
      const avatarFileId = newId();

      profile.rename('Grace Hopper', new Date('2026-08-16T11:00:00.000Z'));
      profile.changeAvatar(avatarFileId, new Date('2026-08-16T11:00:00.000Z'));
      await repository.save(profile);

      const found = await repository.findByUserId(userId);

      expect(found?.id).toBe(profile.id);
      expect(found?.displayName).toBe('Grace Hopper');
      expect(found?.avatarFileId).toBe(avatarFileId);
      expect(found?.createdAt.toISOString()).toBe('2026-08-16T10:00:00.000Z');
      expect(found?.updatedAt.toISOString()).toBe('2026-08-16T11:00:00.000Z');
    });

    it('returns null for a user that has no profile', async () => {
      await expect(repository.findByUserId(newId())).resolves.toBeNull();
    });
  });

  describe('findIdentity', () => {
    it('reads the identity Better Auth owns', async () => {
      const userId = await seedIdentity();

      const identity = await repository.findIdentity(userId);

      expect(identity).toMatchObject({
        userId,
        email: `${userId}@example.com`,
        emailVerified: false,
        role: 'member',
      });
    });

    it('returns null for an unknown id', async () => {
      await expect(repository.findIdentity(newId())).resolves.toBeNull();
    });
  });

  describe('deleteByUserId', () => {
    it('reports whether a row was removed', async () => {
      const userId = await seedIdentity();
      await seedProfile(userId, new Date());

      await expect(repository.deleteByUserId(userId)).resolves.toBe(true);
      await expect(repository.deleteByUserId(userId)).resolves.toBe(false);
    });
  });

  describe('listPage', () => {
    it('loses no row and repeats none when every createdAt collides', async () => {
      const createdAt = new Date('2026-08-16T10:00:00.000Z');
      const written: string[] = [];

      for (let index = 0; index < 9; index += 1) {
        const userId = await seedIdentity();
        const profile = await seedProfile(userId, createdAt);
        written.push(profile.id);
      }

      const paged = await drainPages(repository, 4);

      expect(paged).toHaveLength(written.length);
      expect(new Set(paged)).toEqual(new Set(written));
      expect(paged).toEqual([...paged].sort(descendingOrdinal));
    });

    it('returns no profile after identity deletion cascades its dependent row', async () => {
      const present = await seedIdentity();
      await seedProfile(present, new Date('2026-08-16T10:00:00.000Z'));
      await prisma.db.user.delete({ where: { id: present } });

      const page = await repository.listPage(null, 10);

      expect(page).toEqual([]);
    });

    it('returns an empty page rather than querying identities for nothing', async () => {
      await expect(repository.listPage(null, 10)).resolves.toEqual([]);
    });
  });

  describe('transaction participation', () => {
    it('writes on the caller transaction, so a rollback takes the row with it', async () => {
      const userId = await seedIdentity();
      const profile = UserProfile.create({ userId, displayName: 'Rolled Back' });

      await expect(
        prisma.transaction(async () => {
          await repository.save(profile);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');

      await expect(repository.findByUserId(userId)).resolves.toBeNull();
    });
  });
});

function descendingOrdinal(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
}

async function drainPages(repository: PrismaUserRepository, limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: DecodedCursor | null = null;

  for (;;) {
    const page: UserProfileWithIdentity[] = await repository.listPage(cursor, limit);

    seen.push(...page.map((row) => row.profile.id));

    const last = page.at(-1);
    if (last === undefined || page.length < limit) {
      return seen;
    }

    cursor = decodeCursor(encodeCursor(last.profile.createdAt, last.profile.id));
  }
}
