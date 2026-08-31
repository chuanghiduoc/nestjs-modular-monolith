import { Inject, Injectable } from '@nestjs/common';

import { JOB_QUEUE, type JobQueuePort } from '#contracts/ports';
import { QUEUES } from '#platform/queue';

import type { ClaimedWebhook, WebhookDispatcherPort } from '../domain/webhook-dispatcher.port';

@Injectable()
export class QueueWebhookDispatcher implements WebhookDispatcherPort {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueuePort) {}

  async dispatchClaimed(event: ClaimedWebhook): Promise<void> {
    // Keyed on the claim: a provider that redelivers gets a fresh claim or none
    // at all, so one claim never produces two applications.
    await this.queue.send(
      QUEUES.BILLING_APPLY_WEBHOOK,
      {
        provider: event.provider,
        providerEventId: event.providerEventId,
        claimToken: event.claimToken,
      },
      { singletonKey: `billing-webhook:${event.claimToken}` },
    );
  }
}
