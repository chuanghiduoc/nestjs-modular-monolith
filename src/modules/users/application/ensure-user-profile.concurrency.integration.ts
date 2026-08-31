import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '#platform/prisma';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../../test/support/database';
import { PrismaUserRepository } from '../infrastructure/prisma-user.repository';
import { EnsureUserProfileUseCase } from './ensure-user-profile.use-case';

describe('EnsureUserProfileUseCase under redelivery (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let useCase: EnsureUserProfileUseCase;
  let userId: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
    useCase = new EnsureUserProfileUseCase(new PrismaUserRepository(prisma));
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
    userId = newId();

    await database.cleaner.query(
      `INSERT INTO auth."user" (id, name, email, email_verified, role, created_at, updated_at)
       VALUES ($1, 'Race', $2, true, 'member', now(), now())`,
      [userId, `${userId}@example.com`],
    );
  });

  async function profileCount(): Promise<number> {
    const rows = await database.cleaner.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users.user_profile WHERE user_id = $1',
      [userId],
    );

    return Number(rows[0]?.count ?? 0);
  }

  it('creates one profile when the same job is redelivered sequentially', async () => {
    await useCase.execute({ userId, email: `${userId}@example.com`, displayName: 'Race' });
    await useCase.execute({ userId, email: `${userId}@example.com`, displayName: 'Race' });

    expect(await profileCount()).toBe(1);
  });

  it('creates one profile when two deliveries land together', async () => {
    const outcomes = await Promise.allSettled([
      useCase.execute({ userId, email: `${userId}@example.com`, displayName: 'Race' }),
      useCase.execute({ userId, email: `${userId}@example.com`, displayName: 'Race' }),
    ]);

    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(rejected, 'a redelivered job must not crash the consumer').toEqual([]);
    expect(await profileCount()).toBe(1);
  });
});
