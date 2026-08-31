import { Injectable, Logger } from '@nestjs/common';

import {
  INTEGRATION_EVENTS,
  type IntegrationEvent,
  type IntegrationEventName,
  parseAnyIntegrationEvent,
} from '#contracts/events';
import type { EventPublisherPort, TxHandle } from '#contracts/ports';
import { fromTxHandle, Prisma } from '#platform/prisma';

import { BullMqService } from './bullmq.service';
import { DEDUP_WINDOW_SECONDS, EVENT_SUBSCRIBERS, type QueueName } from './queues';

@Injectable()
export class BullMqEventPublisher implements EventPublisherPort {
  private readonly logger = new Logger(BullMqEventPublisher.name);
  constructor(private readonly queue: BullMqService) {}

  async publishAll(tx: TxHandle, events: readonly IntegrationEvent[]): Promise<void> {
    if (events.length === 0) return;

    for (const event of events) {
      if (!parseAnyIntegrationEvent(event).success) {
        throw new Error(`Cannot persist an invalid integration event contract: ${event.name}`);
      }
      subscribersOf(event.name);
    }

    const db = fromTxHandle(tx);
    await db.outboxEvent.createMany({
      data: events.map((event) => ({
        eventId: event.eventId,
        occurredAt: new Date(event.occurredAt),
        eventName: event.name,
        schemaVersion: event.schemaVersion,
        payload: toJsonObject(event.payload),
      })),
      skipDuplicates: true,
    });
    this.logger.debug({ msg: 'integration events written to outbox', count: events.length });
  }

  async dispatch(event: IntegrationEvent): Promise<void> {
    const parsed = parseAnyIntegrationEvent(event);
    if (!parsed.success) throw new Error('Cannot dispatch an invalid integration event envelope.');

    for (const target of subscribersOf(event.name)) {
      await this.queue.send(target, event, {
        singletonKey: `${target}:${event.eventId}`,
        singletonSeconds: DEDUP_WINDOW_SECONDS,
      });
    }
  }
}

function subscribersOf(name: string): readonly QueueName[] {
  if (!isIntegrationEventName(name)) {
    throw new Error(`No subscriber list declared for integration event "${name}"`);
  }

  const subscribers = EVENT_SUBSCRIBERS[name];

  return subscribers;
}

function toJsonObject(value: unknown): Prisma.InputJsonObject {
  if (!isRecord(value)) throw new Error('Integration event payload must be a JSON object.');

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, toJsonMember(entry)]),
  );
}

function toJsonMember(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonMember(entry));
  }
  if (isRecord(value)) return toJsonObject(value);

  throw new Error(`Cannot serialize integration event payload value of type ${typeof value}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegrationEventName(value: string): value is IntegrationEventName {
  return (Object.values(INTEGRATION_EVENTS) as readonly string[]).includes(value);
}
