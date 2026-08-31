import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { Public } from '#platform/auth';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { BillingWebhookInboxService } from '../application/billing-webhook-inbox.service';
import { WEBHOOK_DISPATCHER, type WebhookDispatcherPort } from '../domain/webhook-dispatcher.port';

const PROVIDER_PATTERN = /^[a-z0-9-]{1,32}$/;
const SIGNATURE_HEADER = 'x-billing-signature';
const EVENT_ID_HEADER = 'x-billing-event-id';

/** A provider retrying hard must not be able to crowd out real traffic. */
const WEBHOOK_LIMIT = { default: { limit: 120, ttl: 60_000 } };

interface RawBodyRequest extends FastifyRequest {
  readonly rawBody?: Buffer;
}

/**
 * The endpoint the inbox was built for.
 *
 * It is deliberately thin: verify, claim, apply, acknowledge. The inbox owns
 * idempotency, so a provider that delivers the same event twice — which every
 * provider eventually does — gets the same 204 both times and the work happens
 * once.
 */
@ApiExcludeController()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(
    private readonly inbox: BillingWebhookInboxService,
    @Inject(WEBHOOK_DISPATCHER) private readonly dispatcher: WebhookDispatcherPort,
  ) {}

  @Post(':provider')
  @Public()
  @Throttle(WEBHOOK_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Headers(EVENT_ID_HEADER) eventId: string | undefined,
  ): Promise<void> {
    this.assertConfigured();

    if (!PROVIDER_PATTERN.test(provider)) {
      throw DomainErrors.validation(ERROR_CODES.VALIDATION_FAILED, 'Unknown billing provider.');
    }
    if (signature === undefined || eventId === undefined || eventId.length > 255) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        `${SIGNATURE_HEADER} and ${EVENT_ID_HEADER} are both required.`,
      );
    }

    // The bytes as they arrived. A re-serialised body is a different document
    // and would fail its own signature.
    const raw = request.rawBody;

    if (raw === undefined) {
      throw new ServiceUnavailableException('The raw request body was not captured.');
    }

    const accepted = await this.inbox.receive({
      provider,
      providerEventId: eventId,
      rawPayload: raw.toString('utf8'),
      signature,
    });

    // A redelivery finds the event already claimed and is acknowledged without
    // queueing a second application of it.
    if (accepted.claimToken === undefined) return;

    await this.dispatcher.dispatchClaimed({
      provider,
      providerEventId: eventId,
      claimToken: accepted.claimToken,
    });
  }

  /**
   * No verifier configured means no way to tell a real provider from anyone who
   * found this URL. Answering 503 says that plainly instead of accepting a
   * payload it cannot authenticate.
   */
  private assertConfigured(): void {
    if (!this.inbox.isConfigured) {
      throw new ServiceUnavailableException('Billing webhooks are not configured.');
    }
  }
}
