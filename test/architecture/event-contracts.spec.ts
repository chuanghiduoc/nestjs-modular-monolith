import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  INTEGRATION_EVENT_SCHEMAS,
  INTEGRATION_EVENTS,
  type IntegrationEventName,
  parseIntegrationEvent,
} from '#contracts/events';
import { EVENT_SUBSCRIBERS } from '#platform/queue';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

function readAllMigrations(): string {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
}

function eventNamesInSql(sql: string): Set<string> {
  const names = new Set<string>();
  const pattern = /v_event_name\s*:=\s*'([^']+)'/g;

  for (const match of sql.matchAll(pattern)) {
    const [, name] = match;
    if (name !== undefined) {
      names.add(name);
    }
  }

  return names;
}

describe('integration event contracts', () => {
  const sql = readAllMigrations();
  const sqlNames = eventNamesInSql(sql);
  const declared = new Set<string>(Object.values(INTEGRATION_EVENTS));

  it('the trigger emits at least one event', () => {
    expect(sqlNames.size).toBeGreaterThan(0);
  });

  it('every event name in the trigger SQL is a declared contract', () => {
    const undeclared = [...sqlNames].filter((name) => !declared.has(name));

    expect(undeclared).toEqual([]);
  });

  it('every declared event has a payload schema', () => {
    const missing = Object.values(INTEGRATION_EVENTS).filter(
      (name) => INTEGRATION_EVENT_SCHEMAS[name] === undefined,
    );

    expect(missing).toEqual([]);
  });

  it('every declared event has a subscriber list', () => {
    const orphaned = Object.values(INTEGRATION_EVENTS).filter(
      (name) => EVENT_SUBSCRIBERS[name] === undefined,
    );

    expect(orphaned).toEqual([]);
  });

  it('parses a stored payload fixture — the record of what old rows look like', () => {
    const stored = {
      eventId: '01a00a95-919d-7550-b99c-98c5c61d8a18',
      name: 'users.registered',
      occurredAt: '2026-08-16T12:39:29.436Z',
      schemaVersion: 1,
      payload: {
        userId: '01a00a95-919d-7550-b99c-98c5c61d8a18',
        email: 'probe@example.com',
        emailVerified: false,
        registeredAt: '2026-08-16T12:39:29.436Z',
      },
    };

    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, stored);

    expect(parsed.success).toBe(true);
  });

  it('refuses a payload that does not match the contract', () => {
    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, {
      eventId: '01a00a95-919d-7550-b99c-98c5c61d8a18',
      name: 'users.registered',
      occurredAt: '2026-08-16T12:39:29.436Z',
      schemaVersion: 1,
      payload: { userId: 'not-a-uuid', email: 'nope', emailVerified: 'yes' },
    });

    expect(parsed.success).toBe(false);
  });

  it('every queue in a subscriber list is a real queue definition', async () => {
    const { QUEUE_DEFINITIONS } = await import('#platform/queue');
    const defined = new Set(QUEUE_DEFINITIONS.map((definition) => definition.name));

    const unknown = Object.entries(EVENT_SUBSCRIBERS).flatMap(([, queues]) =>
      (queues as readonly string[]).filter((queue) => !defined.has(queue as never)),
    );

    expect(unknown).toEqual([]);
  });

  it('names follow the business-milestone convention, not implementation language', () => {
    for (const name of Object.values(INTEGRATION_EVENTS) as IntegrationEventName[]) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/);
    }
  });
});
