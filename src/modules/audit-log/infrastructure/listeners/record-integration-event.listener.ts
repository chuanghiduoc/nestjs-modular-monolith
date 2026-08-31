import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { parseAnyIntegrationEvent } from '#contracts/events';
import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { RecordAuditEntryUseCase } from '../../application/record-audit-entry.use-case';

@Injectable()
@JobHandler(QUEUES.AUDIT_RECORD_EVENT)
export class RecordIntegrationEventListener implements JobConsumer {
  private readonly logger = new Logger(RecordIntegrationEventListener.name);

  constructor(private readonly record: RecordAuditEntryUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = parseAnyIntegrationEvent(job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.AUDIT_ENTRY_INVALID,
        'Integration event envelope did not match the published contract.',
      );
    }

    const event = parsed.data;
    const payload = readPayload(event.payload);

    const written = await this.record.execute({
      id: event.eventId,
      occurredAt: new Date(event.occurredAt),
      action: event.name,
      resource: event.name.split('.')[0] ?? 'unknown',
      organizationId: readString(payload, 'organizationId'),
      actorId: readString(payload, 'actorId') ?? readString(payload, 'userId'),
      resourceId:
        readString(payload, 'fileId') ??
        readString(payload, 'userId') ??
        readString(payload, 'organizationId'),
      requestId: event.correlationId ?? null,
      metadata: { schemaVersion: event.schemaVersion },
    });

    if (!written) {
      this.logger.debug({ msg: 'audit entry already recorded', eventId: event.eventId });
    }
  }
}

function readPayload(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];

  return typeof value === 'string' ? value : null;
}
