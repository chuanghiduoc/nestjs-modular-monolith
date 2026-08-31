import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  INTEGRATION_EVENT_SCHEMAS,
  INTEGRATION_EVENTS,
  type IntegrationEventName,
} from '#contracts/events';
import type { PrismaService } from '#platform/prisma';
import { isUuidV7, newId } from '#shared/util';

import {
  createTestPrismaService,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/support/database';

interface OutboxRow extends Record<string, unknown> {
  readonly event_id: string;
  readonly occurred_at: Date;
  readonly event_name: string;
  readonly schema_version: number;
  readonly payload: unknown;
  readonly drained_at: Date | null;
}

describe('auth.user outbox trigger (integration)', () => {
  let database: TestDatabase;
  let prisma: PrismaService;

  beforeAll(async () => {
    database = await startTestDatabase();
    prisma = createTestPrismaService(database.connectionString);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await database?.stop();
  });

  beforeEach(async () => {
    await database.cleaner.truncateAll();
  });

  async function outboxRows(): Promise<OutboxRow[]> {
    return database.cleaner.query<OutboxRow>(
      `SELECT event_id, occurred_at, event_name, schema_version, payload, drained_at
         FROM messaging.outbox_events
        ORDER BY occurred_at, event_id`,
    );
  }

  async function createUser(userId: string = newId()): Promise<string> {
    await prisma.db.user.create({
      data: {
        id: userId,
        name: 'Trigger Subject',
        email: `${userId}@example.com`,
        emailVerified: false,
        role: 'member',
      },
    });

    return userId;
  }

  it('writes users.registered on INSERT, with a payload the contract parses', async () => {
    const userId = await createUser();

    const rows = await outboxRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_name).toBe(INTEGRATION_EVENTS.USER_REGISTERED);
    expect(isUuidV7(rows[0]?.event_id ?? '')).toBe(true);
    expect(rows[0]?.schema_version).toBe(1);
    expect(rows[0]?.drained_at).toBeNull();

    expectPayloadParses(INTEGRATION_EVENTS.USER_REGISTERED, rows[0]?.payload);
    expect(rows[0]?.payload).toMatchObject({
      userId,
      email: `${userId}@example.com`,
      emailVerified: false,
    });
  });

  it('writes users.email_verified only on the false -> true transition', async () => {
    const userId = await createUser();

    await prisma.db.user.update({ where: { id: userId }, data: { emailVerified: true } });

    const rows = await outboxRows();
    const verified = rows.filter(
      (row) => row.event_name === INTEGRATION_EVENTS.USER_EMAIL_VERIFIED,
    );

    expect(verified).toHaveLength(1);
    expectPayloadParses(INTEGRATION_EVENTS.USER_EMAIL_VERIFIED, verified[0]?.payload);
    expect(verified[0]?.payload).toMatchObject({ userId, email: `${userId}@example.com` });
  });

  it('publishes nothing when an unrelated column changes', async () => {
    const userId = await createUser();
    const before = await outboxRows();

    await prisma.db.user.update({ where: { id: userId }, data: { name: 'Renamed' } });

    await expect(outboxRows()).resolves.toHaveLength(before.length);
  });

  it('publishes nothing when email_verified goes true -> false', async () => {
    const userId = await createUser();
    await prisma.db.user.update({ where: { id: userId }, data: { emailVerified: true } });
    const before = await outboxRows();

    await prisma.db.user.update({ where: { id: userId }, data: { emailVerified: false } });

    await expect(outboxRows()).resolves.toHaveLength(before.length);
  });

  it('writes users.deleted on DELETE', async () => {
    const userId = await createUser();

    await prisma.db.user.delete({ where: { id: userId } });

    const deleted = (await outboxRows()).filter(
      (row) => row.event_name === INTEGRATION_EVENTS.USER_DELETED,
    );

    expect(deleted).toHaveLength(1);
    expectPayloadParses(INTEGRATION_EVENTS.USER_DELETED, deleted[0]?.payload);
    expect(deleted[0]?.payload).toMatchObject({ userId });
  });

  it('writes the row inside the caller transaction — both commit or neither', async () => {
    await expect(
      prisma.transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: newId(),
            name: 'Rolled Back',
            email: `${newId()}@example.com`,
            emailVerified: false,
            role: 'member',
          },
        });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    await expect(outboxRows()).resolves.toEqual([]);
  });
});

function expectPayloadParses(name: IntegrationEventName, payload: unknown): void {
  const parsed = INTEGRATION_EVENT_SCHEMAS[name].safeParse(payload);

  expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
}
