import type { IntegrationEvent } from '../events/integration-event';
import type { TxHandle } from './unit-of-work.port';

export interface EventPublisherPort {
  publishAll(tx: TxHandle, events: readonly IntegrationEvent[]): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
