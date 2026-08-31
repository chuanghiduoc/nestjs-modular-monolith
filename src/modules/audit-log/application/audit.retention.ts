export interface AuditRetention {
  readonly retentionDays: number;
}

export const AUDIT_RETENTION = Symbol('AUDIT_RETENTION');

export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
