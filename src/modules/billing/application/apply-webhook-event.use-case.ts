import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';

import {
  BILLING_EVENT_APPLIER,
  type BillingEventApplierPort,
} from '../domain/billing-event-applier.port';

/**
 * The normalised shape this application accepts, whatever the provider sent.
 *
 * Mapping a provider's own event onto this belongs in that provider's adapter —
 * keeping the translation there is what stops an SDK's types from leaking into
 * the domain.
 */
const webhookEventSchema = z.object({
  type: z.enum(['subscription.updated', 'subscription.canceled']),
  organizationId: z.uuid({ version: 'v7' }),
  planCode: z.string().min(1).max(64).optional(),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'paused']).optional(),
  providerRef: z.string().max(255).optional(),
  currentPeriodEnd: z.iso.datetime().optional(),
});

export type BillingWebhookEvent = z.infer<typeof webhookEventSchema>;

/**
 * Turns a verified, recorded webhook into a normalised event and hands it to the
 * applier — if one is configured.
 *
 * There is no applier by default, and no application role may write
 * billing.subscription (see ops/postgres/roles.sql). That is deliberate: what a
 * customer is entitled to is configuration, and a boilerplate should not ship a
 * path that lets an internet-facing endpoint change it under whatever semantics
 * it guessed. Implement BillingEventApplierPort for your provider, grant the
 * worker the privilege it needs, and this becomes the seam it plugs into.
 */
@Injectable()
export class ApplyWebhookEventUseCase {
  private readonly logger = new Logger(ApplyWebhookEventUseCase.name);

  constructor(
    @Optional()
    @Inject(BILLING_EVENT_APPLIER)
    private readonly applier?: BillingEventApplierPort,
  ) {}

  async execute(provider: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const parsed = webhookEventSchema.safeParse(payload);

    if (!parsed.success) {
      // Not something the provider fixes by retrying, and not worth failing the
      // inbox row over: an event this deployment does not model is recorded as
      // handled and ignored.
      this.logger.warn({
        msg: 'ignoring a billing webhook this application does not model',
        provider,
      });

      return;
    }

    if (this.applier === undefined) {
      this.logger.log({
        msg: 'billing webhook recorded; no applier is configured to act on it',
        provider,
        type: parsed.data.type,
        organizationId: parsed.data.organizationId,
      });

      return;
    }

    await this.applier.apply(provider, parsed.data);
  }
}
