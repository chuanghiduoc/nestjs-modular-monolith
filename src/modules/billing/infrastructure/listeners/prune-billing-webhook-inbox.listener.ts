import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';

import { PruneBillingWebhookInboxUseCase } from '../../application/prune-billing-webhook-inbox.use-case';

@Injectable()
@JobHandler(QUEUES.BILLING_WEBHOOK_PRUNE)
export class PruneBillingWebhookInboxListener implements JobConsumer {
  private readonly logger = new Logger(PruneBillingWebhookInboxListener.name);

  constructor(private readonly prune: PruneBillingWebhookInboxUseCase) {}

  async handle(_job: Job<unknown>): Promise<void> {
    const deleted = await this.prune.execute();

    if (deleted > 0) {
      this.logger.log({ msg: 'pruned processed billing webhook inbox events', deleted });
    }
  }
}
