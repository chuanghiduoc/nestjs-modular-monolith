import { describe, expect, it } from 'vitest';

import { createIntegrationEvent, INTEGRATION_EVENTS } from '#contracts/events';
import { QUEUES } from '#platform/queue';
import { newId } from '#shared/util';

import { InMemoryAuditRepository } from '../../../../../test/support/in-memory';
import { makeJob } from '../../../../../test/support/queue';
import { RecordAuditEntryUseCase } from '../../application/record-audit-entry.use-case';
import { RecordIntegrationEventListener } from './record-integration-event.listener';

describe('RecordIntegrationEventListener', () => {
  it('maps organization lifecycle actor and tenant identifiers into the audit entry', async () => {
    const entries = new InMemoryAuditRepository();
    const listener = new RecordIntegrationEventListener(new RecordAuditEntryUseCase(entries));
    const organizationId = newId();
    const actorId = newId();
    const event = createIntegrationEvent(INTEGRATION_EVENTS.ORGANIZATION_PURGED, {
      organizationId,
      actorId,
    });

    await listener.handle(makeJob(QUEUES.AUDIT_RECORD_EVENT, event));

    expect(entries.rowOf(event.eventId)).toMatchObject({
      action: INTEGRATION_EVENTS.ORGANIZATION_PURGED,
      resource: 'organizations',
      organizationId,
      actorId,
      resourceId: organizationId,
    });
  });
});
