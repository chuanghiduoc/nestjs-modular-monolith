import { type DynamicModule, Module, type Provider } from '@nestjs/common';

import { ApplyWebhookEventUseCase } from './application/apply-webhook-event.use-case';
import { BillingWebhookInboxService } from './application/billing-webhook-inbox.service';
import { GetEntitlementsUseCase } from './application/get-entitlements.use-case';
import { PruneBillingWebhookInboxUseCase } from './application/prune-billing-webhook-inbox.use-case';
import { BILLING_REPOSITORY, type BillingRepository } from './domain/billing.repository';
import { BILLING_WEBHOOK_VERIFIER } from './domain/billing-provider.port';
import { BILLING_WEBHOOK_INBOX_REPOSITORY } from './domain/billing-webhook.repository';
import { DefaultEntitlementService, ENTITLEMENT_SERVICE } from './domain/entitlement.service';
import { WEBHOOK_DISPATCHER } from './domain/webhook-dispatcher.port';
import { BillingController } from './http/billing.controller';
import { BillingWebhookController } from './http/billing-webhook.controller';
import {
  BILLING_WEBHOOK_SECRET,
  HmacBillingWebhookVerifier,
} from './infrastructure/hmac-webhook-verifier.adapter';
import { ApplyBillingWebhookListener } from './infrastructure/listeners/apply-billing-webhook.listener';
import { PruneBillingWebhookInboxListener } from './infrastructure/listeners/prune-billing-webhook-inbox.listener';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { PrismaBillingWebhookInboxRepository } from './infrastructure/prisma-billing-webhook.repository';
import { QueueWebhookDispatcher } from './infrastructure/queue-webhook-dispatcher.adapter';

@Module({})
export class BillingModule {
  static forRoot(input: BillingModuleInput = {}): DynamicModule {
    return {
      module: BillingModule,
      controllers: input.exposeHttp === false ? [] : [BillingController, BillingWebhookController],
      providers: [
        GetEntitlementsUseCase,
        ApplyWebhookEventUseCase,
        BillingWebhookInboxService,
        PruneBillingWebhookInboxUseCase,
        ApplyBillingWebhookListener,
        PruneBillingWebhookInboxListener,
        ...verifierProviders(input.webhookSecret),
        { provide: BILLING_REPOSITORY, useClass: PrismaBillingRepository },
        { provide: WEBHOOK_DISPATCHER, useClass: QueueWebhookDispatcher },
        {
          provide: BILLING_WEBHOOK_INBOX_REPOSITORY,
          useClass: PrismaBillingWebhookInboxRepository,
        },
        {
          provide: ENTITLEMENT_SERVICE,
          inject: [BILLING_REPOSITORY],
          useFactory: (billing: BillingRepository) => new DefaultEntitlementService(billing),
        },
      ],
      exports: [ENTITLEMENT_SERVICE, BILLING_REPOSITORY, BillingWebhookInboxService],
    };
  }
}

/**
 * Without a secret there is no verifier, and the endpoint answers 503 rather
 * than trusting an unsigned payload. Wiring a broken verifier would be worse
 * than wiring none.
 */
function verifierProviders(secret: string | undefined): Provider[] {
  if (secret === undefined || secret === '') return [];

  return [
    { provide: BILLING_WEBHOOK_SECRET, useValue: secret },
    { provide: BILLING_WEBHOOK_VERIFIER, useClass: HmacBillingWebhookVerifier },
  ];
}

export interface BillingModuleInput {
  readonly exposeHttp?: boolean;

  /** Shared secret for the reference HMAC verifier. */
  readonly webhookSecret?: string;
}
