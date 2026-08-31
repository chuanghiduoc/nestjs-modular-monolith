import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const modelsDir = join(process.cwd(), 'prisma', 'models');

function migrationNames(): readonly string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationSql(): string {
  return migrationNames()
    .map((name) => readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'))
    .join('\n');
}

function prismaSchemas(): readonly string[] {
  const schemaPattern = /@@schema\("([a-z_]+)"\)/g;

  return [
    ...new Set(
      readdirSync(modelsDir)
        .filter((name) => name.endsWith('.prisma'))
        .flatMap((name) => [...readFileSync(join(modelsDir, name), 'utf8').matchAll(schemaPattern)])
        .flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
    ),
  ];
}

describe('migration contracts', () => {
  const names = migrationNames();
  const sql = migrationSql();

  it('keeps one baseline, because a boilerplate has no deployed history to replay', () => {
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/_init$/);
  });

  it('creates every Prisma schema namespace before using it', () => {
    for (const schema of prismaSchemas()) {
      expect(sql).toMatch(new RegExp(`CREATE SCHEMA(?: IF NOT EXISTS)? "${schema}"`, 'i'));
    }
  });

  it('creates a table before anything references it', () => {
    // Ordering inside one file matters exactly as much as ordering between
    // files did: a foreign key to a table that does not exist yet fails on the
    // first run against an empty database.
    const organizationTable = sql.indexOf('CREATE TABLE "tenancy"."organization"');
    const userTable = sql.indexOf('CREATE TABLE "auth"."user"');

    expect(organizationTable).toBeGreaterThanOrEqual(0);
    expect(userTable).toBeGreaterThanOrEqual(0);

    for (const constraint of [
      'subscription_organization_id_fkey',
      'stored_file_organization_id_fkey',
      'organization_member_organization_id_fkey',
      'organization_invitation_organization_id_fkey',
    ]) {
      expect(sql.indexOf(constraint)).toBeGreaterThan(organizationTable);
    }

    for (const constraint of [
      'organization_member_user_id_fkey',
      'user_profile_user_id_fkey',
      'session_user_id_fkey',
      'account_user_id_fkey',
    ]) {
      expect(sql.indexOf(constraint)).toBeGreaterThan(userTable);
    }
  });

  it('preserves the tenant identifier in audit history after organization purge', () => {
    // Audit rows are evidence. A live foreign key would either block the purge
    // or blank organization_id out of the history it exists to record, so the
    // column deliberately carries no constraint.
    expect(sql).not.toContain('audit_log_organization_id_fkey');
    expect(sql).toContain('"organization_id" UUID');
  });

  it('writes identity events to the outbox from the transaction that caused them', () => {
    expect(sql).toContain('"messaging"."enqueue_auth_user_event"');

    for (const trigger of [
      'auth_user_registered',
      'auth_user_email_verified',
      'auth_user_deleted',
    ]) {
      expect(sql).toContain(trigger);
    }
  });

  it('guards the last owner below the application, where the cascade runs', () => {
    expect(sql).toContain('"tenancy"."refuse_last_owner_deletion"');
    expect(sql).toContain('BEFORE DELETE ON "auth"."user"');
  });

  it('indexes the rows each retention job actually scans', () => {
    // Every other index on outbox_events filters for undrained rows, so pruning
    // drained ones needs an index of its own.
    expect(sql).toContain('"outbox_events_drained_at_idx"');
    expect(sql).toContain('"webhook_inbox_event_processed_at_idx"');
    expect(sql).toContain('"outbox_events_pending_claim_idx"');
  });
});
