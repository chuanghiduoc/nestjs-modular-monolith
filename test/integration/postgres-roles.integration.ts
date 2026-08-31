import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { startTestDatabase, type TestDatabase } from '../support/database';

const ROLES_SQL = join(process.cwd(), 'ops', 'postgres', 'roles.sql');
const PASSWORD = 'role-test-password';
const INSUFFICIENT_PRIVILEGE = '42501';

type RoleName = 'app_api' | 'app_worker' | 'app_scheduler';

interface PgError {
  readonly code?: string;
}

describe('per-role Postgres credentials (integration)', () => {
  let database: TestDatabase | undefined;
  let pools: Partial<Record<RoleName, Pool>> = {};
  let userId: string;

  beforeAll(async () => {
    database = await startTestDatabase();

    if (database === undefined) return;

    await database.cleaner.query(readFileSync(ROLES_SQL, 'utf8'));

    for (const role of ['app_api', 'app_worker', 'app_scheduler'] as const) {
      await database.cleaner.query(`ALTER ROLE ${role} PASSWORD '${PASSWORD}'`);
    }

    pools = {
      app_api: poolFor('app_api'),
      app_worker: poolFor('app_worker'),
      app_scheduler: poolFor('app_scheduler'),
    };

    userId = newId();

    await database.cleaner.query(
      `INSERT INTO auth."user" (id, name, email, email_verified, role, created_at, updated_at)
       VALUES ($1, 'Role Test', $2, true, 'member', now(), now())`,
      [userId, `${userId}@example.com`],
    );
  });

  afterAll(async () => {
    await Promise.all(
      Object.values(pools)
        .filter((pool): pool is Pool => pool !== undefined)
        .map((pool) => pool.end()),
    );
    await database?.stop();
  });

  function poolFor(role: RoleName): Pool {
    if (database === undefined) throw new Error('Test database was not started.');

    const url = new URL(database.connectionString);
    url.username = role;
    url.password = PASSWORD;

    return new Pool({ connectionString: url.toString(), max: 1 });
  }

  async function attempt(role: RoleName, sql: string, params: unknown[] = []): Promise<void> {
    const pool = pools[role];
    if (pool === undefined) throw new Error(`Pool for ${role} was not started.`);

    await pool.query(sql, params);
  }

  async function expectDenied(role: RoleName, sql: string, params: unknown[] = []): Promise<void> {
    const error: unknown = await attempt(role, sql, params).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error, `${role} was allowed to run: ${sql}`).not.toBeNull();
    expect((error as PgError).code).toBe(INSUFFICIENT_PRIVILEGE);
  }

  describe('app_api', () => {
    it('writes identity, profiles and uploads — the tables it owns at runtime', async () => {
      await attempt(
        'app_api',
        `INSERT INTO users.user_profile (id, user_id, display_name, created_at, updated_at)
         VALUES ($1, $2, 'Api Written', now(), now())`,
        [newId(), userId],
      );

      await attempt('app_api', `UPDATE auth."user" SET name = 'renamed' WHERE id = $1`, [userId]);
    });

    it('inserts the outbox row the auth trigger writes inside its own transaction', async () => {
      await attempt('app_api', `DELETE FROM auth."user" WHERE id = $1`, [userId]);

      const drained = await requireDatabase().cleaner.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM messaging.outbox_events`,
      );

      expect(Number(drained[0]?.count)).toBeGreaterThan(0);
    });

    it('reads the audit trail but cannot write or erase it', async () => {
      await attempt('app_api', 'SELECT id FROM audit.audit_log LIMIT 1');

      await expectDenied(
        'app_api',
        `INSERT INTO audit.audit_log (id, occurred_at, action, resource, metadata)
         VALUES ($1, now(), 'forged', 'audit', '{}'::jsonb)`,
        [newId()],
      );
      await expectDenied('app_api', 'DELETE FROM audit.audit_log');
    });

    it('cannot drain the outbox — that is the scheduler role', async () => {
      await expectDenied('app_api', 'SELECT event_id FROM messaging.outbox_events');
      await expectDenied('app_api', 'DELETE FROM messaging.outbox_events');
    });

    it('writes webhook inbox state but cannot mutate plans or subscriptions', async () => {
      const id = newId();

      await attempt(
        'app_api',
        `INSERT INTO billing.webhook_inbox_event
           (id, provider, provider_event_id, payload, processing_at, processing_token)
         VALUES ($1, 'test', $2, '{}'::jsonb, now(), $3)`,
        [id, `evt-${id}`, newId()],
      );
      await attempt(
        'app_api',
        `UPDATE billing.webhook_inbox_event SET processed_at = now() WHERE id = $1`,
        [id],
      );

      await expectDenied('app_api', `UPDATE billing.plan SET active = false`);
      await expectDenied('app_api', `UPDATE billing.subscription SET status = 'paused'`);
      await expectDenied('app_api', `DELETE FROM billing.webhook_inbox_event WHERE id = $1`, [id]);
    });
  });

  describe('app_worker', () => {
    it('writes audit rows and prunes them', async () => {
      const id = newId();

      await attempt(
        'app_worker',
        `INSERT INTO audit.audit_log (id, occurred_at, action, resource, metadata)
         VALUES ($1, now(), 'users.registered', 'user', '{}'::jsonb)`,
        [id],
      );

      await attempt('app_worker', 'DELETE FROM audit.audit_log WHERE id = $1', [id]);
    });

    it('reads identity but never writes it — Better Auth owns that table', async () => {
      await attempt('app_worker', 'SELECT id FROM auth."user" LIMIT 1');

      await expectDenied('app_worker', `UPDATE auth."user" SET role = 'admin'`);
      await expectDenied('app_worker', `DELETE FROM auth."user"`);
    });

    it('deletes expired sessions and verification tokens — the retention job needs it', async () => {
      await attempt('app_worker', `DELETE FROM auth.session WHERE expires_at < now()`);
      await attempt('app_worker', `DELETE FROM auth.verification WHERE expires_at < now()`);

      await expectDenied('app_worker', `UPDATE auth.session SET expires_at = now()`);
    });

    it('owns billing webhook processing and retention, but not billing configuration', async () => {
      const id = newId();

      await attempt(
        'app_worker',
        `INSERT INTO billing.webhook_inbox_event
           (id, provider, provider_event_id, payload, processing_at, processing_token)
         VALUES ($1, 'worker-test', $2, '{}'::jsonb, now(), $3)`,
        [id, `evt-${id}`, newId()],
      );
      await attempt(
        'app_worker',
        `UPDATE billing.webhook_inbox_event SET failed_at = now() WHERE id = $1`,
        [id],
      );
      await attempt('app_worker', `DELETE FROM billing.webhook_inbox_event WHERE id = $1`, [id]);

      await expectDenied('app_worker', `UPDATE billing.plan SET active = false`);
      await expectDenied('app_worker', `UPDATE billing.subscription SET status = 'paused'`);
    });
  });

  describe('app_scheduler', () => {
    it('drains and prunes the outbox', async () => {
      await attempt('app_scheduler', 'SELECT event_id FROM messaging.outbox_events LIMIT 1');
      await attempt(
        'app_scheduler',
        'UPDATE messaging.outbox_events SET drained_at = now() WHERE drained_at IS NULL',
      );
      await attempt('app_scheduler', 'DELETE FROM messaging.outbox_events');
    });

    it('cannot touch business data — it only moves events', async () => {
      await expectDenied('app_scheduler', 'SELECT id FROM users.user_profile');
      await expectDenied('app_scheduler', 'SELECT id FROM audit.audit_log');
      await expectDenied('app_scheduler', 'SELECT id FROM auth."user"');
    });
  });

  it('lets no application role create tables in a business schema', async () => {
    for (const role of ['app_api', 'app_worker', 'app_scheduler'] as const) {
      await expectDenied(role, 'CREATE TABLE users.smuggled (id int)');
    }
  });

  function requireDatabase(): TestDatabase {
    if (database === undefined) throw new Error('Test database was not started.');

    return database;
  }
});
