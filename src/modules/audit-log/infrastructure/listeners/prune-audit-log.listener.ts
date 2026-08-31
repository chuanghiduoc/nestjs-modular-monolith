import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';

import { PruneAuditEntriesUseCase } from '../../application/prune-audit-entries.use-case';

@Injectable()
@JobHandler(QUEUES.AUDIT_PRUNE)
export class PruneAuditLogListener implements JobConsumer {
  private readonly logger = new Logger(PruneAuditLogListener.name);

  constructor(private readonly prune: PruneAuditEntriesUseCase) {}

  async handle(_job: Job<unknown>): Promise<void> {
    const deleted = await this.prune.execute();

    if (deleted > 0) {
      this.logger.log({ msg: 'pruned audit entries past retention', deleted });
    }
  }
}
