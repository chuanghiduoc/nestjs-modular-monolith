import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_REPOSITORY, type AuditRepository } from '../domain/audit.repository';
import { AUDIT_RETENTION, type AuditRetention } from './audit.retention';

const PRUNE_BATCH_SIZE = 5_000;
const MAX_PASSES = 20;
const DAY_MS = 86_400_000;

@Injectable()
export class PruneAuditEntriesUseCase {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly entries: AuditRepository,
    @Inject(AUDIT_RETENTION) private readonly retention: AuditRetention,
  ) {}

  async execute(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.retention.retentionDays * DAY_MS);
    let deleted = 0;

    // Bounded batches, repeated: one large DELETE holds locks on a table that is
    // still serving reads, and a single batch per night loses to any backlog
    // bigger than itself.
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const removed = await this.entries.deleteOlderThan(cutoff, PRUNE_BATCH_SIZE);
      deleted += removed;

      if (removed < PRUNE_BATCH_SIZE) break;
    }

    return deleted;
  }
}
