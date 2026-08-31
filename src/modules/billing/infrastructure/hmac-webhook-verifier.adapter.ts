import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors, ERROR_CODES } from '#shared/errors';

import type { BillingWebhookVerifierPort } from '../domain/billing-provider.port';

export const BILLING_WEBHOOK_SECRET = Symbol('BILLING_WEBHOOK_SECRET');

/**
 * A provider-neutral reference verifier: HMAC-SHA256 over the exact bytes that
 * arrived, compared in constant time.
 *
 * Every real provider signs differently — Stripe prefixes a timestamp, Paddle
 * uses its own header layout — so a production integration replaces this class
 * and keeps the port. What must not change is the shape: verify the raw body
 * before it is parsed, because a re-serialised payload is not the payload that
 * was signed.
 */
@Injectable()
export class HmacBillingWebhookVerifier implements BillingWebhookVerifierPort {
  constructor(@Inject(BILLING_WEBHOOK_SECRET) private readonly secret: string) {}

  verify(payload: string, signature: string): Promise<Readonly<Record<string, unknown>>> {
    const expected = createHmac('sha256', this.secret).update(payload, 'utf8').digest();
    const provided = decodeSignature(signature);

    if (provided?.length !== expected.length) {
      throw rejected();
    }
    if (!timingSafeEqual(provided, expected)) {
      throw rejected();
    }

    return Promise.resolve(parseJsonObject(payload));
  }
}

function decodeSignature(signature: string): Buffer | null {
  const trimmed = signature.trim();

  if (!/^[0-9a-f]+$/i.test(trimmed) || trimmed.length % 2 !== 0) {
    return null;
  }

  return Buffer.from(trimmed, 'hex');
}

function parseJsonObject(payload: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(payload);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw rejected();
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw rejected();
  }
}

/**
 * One answer for an unsigned, mis-signed or unparseable body. Telling a caller
 * which of those it was helps only the caller who is guessing.
 */
function rejected(): Error {
  return DomainErrors.forbidden(ERROR_CODES.FORBIDDEN, 'The webhook signature is not valid.');
}
