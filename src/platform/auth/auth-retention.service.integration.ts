import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '#platform/prisma';
import { newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/support/database';
import { AuthRetentionService } from './auth-retention.service';

const NOW = new Date('2026-08-17T12:00:00.000Z');
const GRACE_HOURS = 24;
const HOUR_MS = 3_600_000;

describe('AuthRetentionService (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let service: AuthRetentionService;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
    service = new AuthRetentionService(prisma, {
      expiredSessionGraceHours: GRACE_HOURS,
      batchSize: 1_000,
    });
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
  });

  async function seedUser(): Promise<string> {
    const id = newId();

    await database.cleaner.query(
      `INSERT INTO auth."user" (id, name, email, email_verified, role, created_at, updated_at)
       VALUES ($1, 'Retention', $2, true, 'member', now(), now())`,
      [id, `${id}@example.com`],
    );

    return id;
  }

  async function seedSession(userId: string, expiresAt: Date): Promise<string> {
    const id = newId();

    await database.cleaner.query(
      `INSERT INTO auth.session (id, user_id, token, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [id, userId, newId(), expiresAt],
    );

    return id;
  }

  async function seedVerification(expiresAt: Date): Promise<string> {
    const id = newId();

    await database.cleaner.query(
      `INSERT INTO auth.verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [id, `verify-email:${id}`, newId(), expiresAt],
    );

    return id;
  }

  async function sessionExists(id: string): Promise<boolean> {
    const rows = await database.cleaner.query<{ id: string }>(
      'SELECT id FROM auth.session WHERE id = $1',
      [id],
    );

    return rows.length > 0;
  }

  async function verificationExists(id: string): Promise<boolean> {
    const rows = await database.cleaner.query<{ id: string }>(
      'SELECT id FROM auth.verification WHERE id = $1',
      [id],
    );

    return rows.length > 0;
  }

  it('deletes a session that expired longer ago than the grace window', async () => {
    const userId = await seedUser();
    const stale = await seedSession(userId, new Date(NOW.getTime() - (GRACE_HOURS + 1) * HOUR_MS));

    const pruned = await service.pruneExpired(NOW);

    expect(pruned.sessions).toBe(1);
    await expect(sessionExists(stale)).resolves.toBe(false);
  });

  it('keeps a session that expired inside the grace window', async () => {
    const userId = await seedUser();
    const recent = await seedSession(userId, new Date(NOW.getTime() - (GRACE_HOURS - 1) * HOUR_MS));

    const pruned = await service.pruneExpired(NOW);

    expect(pruned.sessions).toBe(0);
    await expect(sessionExists(recent)).resolves.toBe(true);
  });

  it('never touches a live session', async () => {
    const userId = await seedUser();
    const live = await seedSession(userId, new Date(NOW.getTime() + 7 * 24 * HOUR_MS));

    await service.pruneExpired(NOW);

    await expect(sessionExists(live)).resolves.toBe(true);
  });

  it('deletes a verification token the moment it expires, with no grace', async () => {
    const expired = await seedVerification(new Date(NOW.getTime() - 1_000));
    const live = await seedVerification(new Date(NOW.getTime() + HOUR_MS));

    const pruned = await service.pruneExpired(NOW);

    expect(pruned.verifications).toBe(1);
    await expect(verificationExists(expired)).resolves.toBe(false);
    await expect(verificationExists(live)).resolves.toBe(true);
  });

  it('honours the batch size, so one pass cannot lock the tables', async () => {
    const userId = await seedUser();
    const bounded = new AuthRetentionService(prisma, {
      expiredSessionGraceHours: GRACE_HOURS,
      batchSize: 2,
    });

    for (let index = 0; index < 5; index++) {
      await seedSession(userId, new Date(NOW.getTime() - (GRACE_HOURS + index + 1) * HOUR_MS));
    }

    expect((await bounded.pruneExpired(NOW)).sessions).toBe(2);
    expect((await bounded.pruneExpired(NOW)).sessions).toBe(2);
    expect((await bounded.pruneExpired(NOW)).sessions).toBe(1);
    expect((await bounded.pruneExpired(NOW)).sessions).toBe(0);
  });

  it('clears a backlog larger than one batch in a single run', async () => {
    const userId = await seedUser();
    const bounded = new AuthRetentionService(prisma, {
      expiredSessionGraceHours: GRACE_HOURS,
      batchSize: 2,
    });
    const stale: string[] = [];

    for (let index = 0; index < 5; index++) {
      stale.push(
        await seedSession(userId, new Date(NOW.getTime() - (GRACE_HOURS + index + 1) * HOUR_MS)),
      );
    }
    await seedVerification(new Date(NOW.getTime() - 1_000));

    const pruned = await bounded.pruneUntilIdle(NOW);

    expect(pruned).toEqual({ sessions: 5, verifications: 1 });
    for (const id of stale) {
      await expect(sessionExists(id)).resolves.toBe(false);
    }
  });

  it('leaves a live session alone while draining a backlog', async () => {
    const userId = await seedUser();
    const bounded = new AuthRetentionService(prisma, {
      expiredSessionGraceHours: GRACE_HOURS,
      batchSize: 2,
    });

    for (let index = 0; index < 3; index++) {
      await seedSession(userId, new Date(NOW.getTime() - (GRACE_HOURS + index + 1) * HOUR_MS));
    }
    const live = await seedSession(userId, new Date(NOW.getTime() + 7 * 24 * HOUR_MS));

    expect((await bounded.pruneUntilIdle(NOW)).sessions).toBe(3);
    await expect(sessionExists(live)).resolves.toBe(true);
  });

  it('reports zero on empty tables instead of failing', async () => {
    await expect(service.pruneExpired(NOW)).resolves.toEqual({ sessions: 0, verifications: 0 });
  });
});
