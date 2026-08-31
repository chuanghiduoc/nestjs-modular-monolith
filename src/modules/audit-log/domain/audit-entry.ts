import { newId } from '#shared/util';

export interface AuditEntry {
  readonly id: string;
  readonly occurredAt: Date;

  readonly actorId: string | null;
  readonly organizationId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;

  readonly requestId: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface CreateAuditEntryInput {
  readonly action: string;
  readonly resource: string;
  readonly actorId?: string | null;
  readonly organizationId?: string | null;
  readonly resourceId?: string | null;
  readonly requestId?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly occurredAt?: Date;

  readonly id?: string;
}

export function createAuditEntry(input: CreateAuditEntryInput): AuditEntry {
  return {
    id: input.id ?? newId(),
    occurredAt: input.occurredAt ?? new Date(),
    actorId: input.actorId ?? null,
    organizationId: input.organizationId ?? null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? {},
  };
}
