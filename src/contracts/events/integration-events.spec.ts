import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { createIntegrationEvent } from './create-integration-event';
import {
  INTEGRATION_EVENT_SCHEMAS,
  INTEGRATION_EVENTS,
  type IntegrationEventName,
  type IntegrationEventPayload,
  parseAnyIntegrationEvent,
} from './integration-events';

const NOW = '2026-08-16T12:39:29.436Z';

const VALID_PAYLOADS: { [TName in IntegrationEventName]: IntegrationEventPayload<TName> } = {
  [INTEGRATION_EVENTS.USER_REGISTERED]: {
    userId: newId(),
    email: 'probe@example.com',
    emailVerified: false,
    registeredAt: NOW,
  },
  [INTEGRATION_EVENTS.USER_EMAIL_VERIFIED]: {
    userId: newId(),
    email: 'probe@example.com',
    verifiedAt: NOW,
  },
  [INTEGRATION_EVENTS.USER_DELETED]: {
    userId: newId(),
    deletedAt: NOW,
  },
  [INTEGRATION_EVENTS.UPLOAD_CONFIRMED]: {
    organizationId: newId(),
    fileId: newId(),
    ownerId: newId(),
    storageKey: 'tenants/x/file.bin',
    mimeType: 'application/octet-stream',
    sizeBytes: 42,
    confirmedAt: NOW,
  },
  [INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED]: {
    organizationId: newId(),
    actorId: newId(),
  },
  [INTEGRATION_EVENTS.ORGANIZATION_RESTORED]: {
    organizationId: newId(),
    actorId: newId(),
  },
  [INTEGRATION_EVENTS.ORGANIZATION_PURGED]: {
    organizationId: newId(),
    actorId: newId(),
  },
};

describe('parseAnyIntegrationEvent', () => {
  const declaredNames = Object.keys(INTEGRATION_EVENT_SCHEMAS) as IntegrationEventName[];

  it.each(declaredNames)('accepts a valid %s event without touching a union by hand', (name) => {
    const event = createIntegrationEvent(name, VALID_PAYLOADS[name]);

    const parsed = parseAnyIntegrationEvent(event);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(event);
  });

  it('refuses an event whose name is not a declared contract', () => {
    const event = {
      ...createIntegrationEvent(INTEGRATION_EVENTS.USER_DELETED, {
        userId: newId(),
        deletedAt: NOW,
      }),
      name: 'users.renamed',
    };

    const parsed = parseAnyIntegrationEvent(event);

    expect(parsed.success).toBe(false);
  });

  it('refuses a declared name carrying a payload that violates its schema', () => {
    const event = {
      ...createIntegrationEvent(INTEGRATION_EVENTS.USER_DELETED, {
        userId: newId(),
        deletedAt: NOW,
      }),
      payload: { userId: 'not-a-uuid' },
    };

    const parsed = parseAnyIntegrationEvent(event);

    expect(parsed.success).toBe(false);
  });

  it('refuses a broken envelope before looking at the payload', () => {
    const parsed = parseAnyIntegrationEvent({
      name: INTEGRATION_EVENTS.USER_DELETED,
      payload: VALID_PAYLOADS[INTEGRATION_EVENTS.USER_DELETED],
    });

    expect(parsed.success).toBe(false);
  });

  it('refuses non-object input', () => {
    expect(parseAnyIntegrationEvent(null).success).toBe(false);
    expect(parseAnyIntegrationEvent('users.deleted').success).toBe(false);
    expect(parseAnyIntegrationEvent(undefined).success).toBe(false);
  });
});
