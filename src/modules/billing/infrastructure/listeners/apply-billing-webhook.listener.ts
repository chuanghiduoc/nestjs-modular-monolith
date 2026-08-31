import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { ApplyWebhookEventUseCase } from '../../application/apply-webhook-event.use-case';
import { BillingWebhookInboxService } from '../../application/billing-webhook-inbox.service';

const jobSchema = z.object({
  provider: z.string().min(1).max(32),
  providerEventId: z.string().min(1).max(255),
  claimToken: z.uuid({ version: 'v7' }),
});

/**
 * Applies a webhook the API already verified and recorded. This is the only
 * place a provider's event reaches billing state, and it runs under the worker's
 * credentials rather than the API's.
 */
@Injectable()
@JobHandler(QUEUES.BILLING_APPLY_WEBHOOK)
export class ApplyBillingWebhookListener implements JobConsumer {
  private readonly logger = new Logger(ApplyBillingWebhookListener.name);

  constructor(
    private readonly inbox: BillingWebhookInboxService,
    private readonly applyEvent: ApplyWebhookEventUseCase,
  ) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = jobSchema.safeParse(job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'Billing webhook job payload did not match its schema.',
      );
    }

    const outcome = await this.inbox.applyClaimed({
      provider: parsed.data.provider,
      providerEventId: parsed.data.providerEventId,
      claimToken: parsed.data.claimToken,
      handle: (payload) => this.applyEvent.execute(parsed.data.provider, payload),
    });

    if (outcome === 'claim-lost') {
      // Someone else owns the lease now, or it is already processed. Retrying
      // would only race them for work that is already being done.
      this.logger.debug({
        msg: 'billing webhook claim no longer held; leaving it to its current owner',
        provider: parsed.data.provider,
        providerEventId: parsed.data.providerEventId,
      });
    }
  }
}
