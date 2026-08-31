export interface AuditEntryView {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string | null;
  readonly organizationId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface AuditEntryPage {
  readonly entries: readonly AuditEntryView[];
  readonly hasMore: boolean;
  readonly lastCursor: string | null;
}
