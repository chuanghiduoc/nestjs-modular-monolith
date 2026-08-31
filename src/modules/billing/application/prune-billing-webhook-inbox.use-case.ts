import { Inject, Injectable } from '@nestjs/common';

import {
  BILLING_WEBHOOK_INBOX_REPOSITORY,
  type BillingWebhookInboxRepository,
} from '../domain/billing-webhook.repository';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 5_000;
const MAX_PASSES = 20;

export const DEFAULT_BILLING_WEBHOOK_RETENTION_DAYS = 90;

@Injectable()
export class PruneBillingWebhookInboxUseCase {
  constructor(
    @Inject(BILLING_WEBHOOK_INBOX_REPOSITORY)
    private readonly inbox: BillingWebhookInboxRepository,
  ) {}

  async execute(
    now: Date = new Date(),
    retentionDays = DEFAULT_BILLING_WEBHOOK_RETENTION_DAYS,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    let deleted = 0;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const removed = await this.inbox.deleteProcessedBefore(cutoff, BATCH_SIZE);
      deleted += removed;

      if (removed < BATCH_SIZE) break;
    }

    return deleted;
  }
}
