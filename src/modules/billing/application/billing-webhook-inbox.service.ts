import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  BILLING_WEBHOOK_VERIFIER,
  type BillingWebhookVerifierPort,
} from '../domain/billing-provider.port';
import {
  BILLING_WEBHOOK_INBOX_REPOSITORY,
  type BillingWebhookInboxRepository,
} from '../domain/billing-webhook.repository';

export type BillingWebhookResult = 'accepted' | 'duplicate';

export interface AcceptedWebhook {
  readonly result: BillingWebhookResult;

  /** Present only when this call is the one that claimed the event. */
  readonly claimToken?: string;
}

/**
 * Receiving and applying are separate on purpose.
 *
 * The endpoint that answers a provider runs in the API role, which deliberately
 * holds no write privilege on billing.subscription — changing what a customer
 * is entitled to is not something an internet-facing request handler should be
 * able to do directly. So the request verifies the signature, records the event
 * in the inbox, and stops. A worker picks it up and applies it under its own
 * credentials, with the queue supplying the retries.
 *
 * The inbox lease is what makes that safe: a provider redelivering the same
 * event finds it already claimed and the work happens once.
 */
@Injectable()
export class BillingWebhookInboxService {
  constructor(
    @Inject(BILLING_WEBHOOK_INBOX_REPOSITORY)
    private readonly inbox: BillingWebhookInboxRepository,
    @Optional()
    @Inject(BILLING_WEBHOOK_VERIFIER)
    private readonly verifier?: BillingWebhookVerifierPort,
  ) {}

  /**
   * Whether a signature can be checked at all. Without a verifier this service
   * cannot tell a provider from a stranger, and callers should refuse the
   * request rather than let it fail deeper in.
   */
  get isConfigured(): boolean {
    return this.verifier !== undefined;
  }

  async receive(input: {
    readonly provider: string;
    readonly providerEventId: string;
    readonly rawPayload: string;
    readonly signature: string;
  }): Promise<AcceptedWebhook> {
    if (this.verifier === undefined) {
      throw new Error('Billing webhook verifier is not configured.');
    }

    const payload = await this.verifier.verify(input.rawPayload, input.signature);
    const claimToken = await this.inbox.claim({
      provider: input.provider,
      providerEventId: input.providerEventId,
      payload,
    });

    return claimToken === null ? { result: 'duplicate' } : { result: 'accepted', claimToken };
  }

  /**
   * Applies an event this process holds the claim on. A claim that no longer
   * matches — the lease expired and someone else took it — is left alone.
   */
  async applyClaimed(input: {
    readonly provider: string;
    readonly providerEventId: string;
    readonly claimToken: string;
    readonly handle: (payload: Readonly<Record<string, unknown>>) => Promise<void>;
  }): Promise<'processed' | 'claim-lost'> {
    const claimed = await this.inbox.findClaimed(
      input.provider,
      input.providerEventId,
      input.claimToken,
    );

    if (claimed === null) return 'claim-lost';

    try {
      await input.handle(claimed.payload);
      await this.inbox.markProcessed(input.provider, input.providerEventId, input.claimToken);

      return 'processed';
    } catch (error) {
      await this.inbox.markFailed(
        input.provider,
        input.providerEventId,
        input.claimToken,
        describeError(error),
      );
      throw error;
    }
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return message.slice(0, 2000);
}
