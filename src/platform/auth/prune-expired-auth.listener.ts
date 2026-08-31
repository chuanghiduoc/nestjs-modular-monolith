import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';

import { AuthRetentionService } from './auth-retention.service';

@Injectable()
@JobHandler(QUEUES.AUTH_PRUNE_EXPIRED)
export class PruneExpiredAuthListener implements JobConsumer {
  private readonly logger = new Logger(PruneExpiredAuthListener.name);

  constructor(private readonly retention: AuthRetentionService) {}

  async handle(_job: Job<unknown>): Promise<void> {
    const pruned = await this.retention.pruneUntilIdle();

    if (pruned.sessions > 0 || pruned.verifications > 0) {
      this.logger.log({
        msg: 'pruned expired auth rows',
        sessions: pruned.sessions,
        verifications: pruned.verifications,
      });
    }
  }
}
