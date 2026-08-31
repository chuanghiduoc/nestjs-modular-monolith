import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_REPOSITORY, type AuditRepository } from '../domain/audit.repository';
import { createAuditEntry, type CreateAuditEntryInput } from '../domain/audit-entry';

@Injectable()
export class RecordAuditEntryUseCase {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly entries: AuditRepository) {}

  async execute(input: CreateAuditEntryInput): Promise<boolean> {
    return this.entries.recordIfAbsent(createAuditEntry(input));
  }
}
