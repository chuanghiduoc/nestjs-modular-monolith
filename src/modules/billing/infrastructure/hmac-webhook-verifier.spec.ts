import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isDomainException } from '#shared/errors';

import { HmacBillingWebhookVerifier } from './hmac-webhook-verifier.adapter';

const SECRET = 'a-shared-secret-of-at-least-32-characters';

function sign(payload: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function verifier(): HmacBillingWebhookVerifier {
  return new HmacBillingWebhookVerifier(SECRET);
}

async function rejects(payload: string, signature: string): Promise<string | undefined> {
  try {
    await verifier().verify(payload, signature);

    return undefined;
  } catch (error) {
    return isDomainException(error) ? error.code : 'not-a-domain-exception';
  }
}

describe('HmacBillingWebhookVerifier', () => {
  const payload = JSON.stringify({ type: 'subscription.updated', organizationId: 'x' });

  it('accepts a body signed with the shared secret', async () => {
    await expect(verifier().verify(payload, sign(payload))).resolves.toEqual({
      type: 'subscription.updated',
      organizationId: 'x',
    });
  });

  it('rejects a signature made with a different secret', async () => {
    await expect(
      rejects(payload, sign(payload, 'another-secret-of-at-least-32-chars!!')),
    ).resolves.toBe('forbidden');
  });

  it('rejects a body that changed after it was signed', async () => {
    const signature = sign(payload);

    await expect(rejects(`${payload} `, signature)).resolves.toBe('forbidden');
  });

  it('rejects a signature that is not hex, without leaking which check failed', async () => {
    await expect(rejects(payload, 'not-hex')).resolves.toBe('forbidden');
    await expect(rejects(payload, 'abc')).resolves.toBe('forbidden');
    await expect(rejects(payload, '')).resolves.toBe('forbidden');
  });

  it('rejects a correctly signed body that is not a JSON object', async () => {
    const list = '[1,2,3]';

    await expect(rejects(list, sign(list))).resolves.toBe('forbidden');

    const broken = '{not json';

    await expect(rejects(broken, sign(broken))).resolves.toBe('forbidden');
  });
});
