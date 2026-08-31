import { newId } from '#shared/util';

import { CURRENT_SCHEMA_VERSION } from './integration-event';
import type {
  IntegrationEventName,
  IntegrationEventPayload,
  TypedIntegrationEvent,
} from './integration-events';

export interface CreateIntegrationEventOptions {
  readonly correlationId?: string;

  readonly eventId?: string;
  readonly occurredAt?: Date;
}

export function createIntegrationEvent<TName extends IntegrationEventName>(
  name: TName,
  payload: IntegrationEventPayload<TName>,
  options: CreateIntegrationEventOptions = {},
): TypedIntegrationEvent<TName> {
  return {
    eventId: options.eventId ?? newId(),
    name,
    occurredAt: (options.occurredAt ?? new Date()).toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    payload,
  };
}
