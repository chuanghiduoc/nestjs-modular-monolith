import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';

import { PruneNotificationLedgerUseCase } from '../../application/prune-notification-ledger.use-case';

@Injectable()
@JobHandler(QUEUES.NOTIFICATIONS_PRUNE_LEDGER)
export class PruneNotificationLedgerListener implements JobConsumer {
  private readonly logger = new Logger(PruneNotificationLedgerListener.name);

  constructor(private readonly prune: PruneNotificationLedgerUseCase) {}

  async handle(_job: Job<unknown>): Promise<void> {
    const deleted = await this.prune.execute();

    if (deleted > 0) {
      this.logger.log({ msg: 'pruned notification ledger rows past retention', deleted });
    }
  }
}
