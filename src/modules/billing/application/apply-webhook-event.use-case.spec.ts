import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import type { NormalisedBillingEvent } from '../domain/billing-event-applier.port';
import { ApplyWebhookEventUseCase } from './apply-webhook-event.use-case';

function recordingApplier() {
  const calls: { provider: string; event: NormalisedBillingEvent }[] = [];

  return {
    calls,
    apply: (provider: string, event: NormalisedBillingEvent): Promise<void> => {
      calls.push({ provider, event });

      return Promise.resolve();
    },
  };
}

beforeAll(() => {
  Logger.overrideLogger(false);
});

describe('ApplyWebhookEventUseCase', () => {
  it('hands a modelled event to the configured applier, normalised', async () => {
    const applier = recordingApplier();
    const organizationId = newId();

    await new ApplyWebhookEventUseCase(applier).execute('stripe', {
      type: 'subscription.updated',
      organizationId,
      planCode: 'pro',
      status: 'active',
    });

    expect(applier.calls).toEqual([
      {
        provider: 'stripe',
        event: {
          type: 'subscription.updated',
          organizationId,
          planCode: 'pro',
          status: 'active',
        },
      },
    ]);
  });

  it('records an unmodelled event as handled without calling the applier', async () => {
    const applier = recordingApplier();

    await expect(
      new ApplyWebhookEventUseCase(applier).execute('stripe', {
        type: 'invoice.finalized',
        organizationId: newId(),
      }),
    ).resolves.toBeUndefined();

    expect(applier.calls).toEqual([]);
  });

  it('rejects a malformed organization id instead of guessing a tenant', async () => {
    const applier = recordingApplier();

    await new ApplyWebhookEventUseCase(applier).execute('stripe', {
      type: 'subscription.updated',
      organizationId: 'not-a-uuid',
    });

    expect(applier.calls).toEqual([]);
  });

  it('settles quietly when no applier is configured', async () => {
    await expect(
      new ApplyWebhookEventUseCase().execute('stripe', {
        type: 'subscription.canceled',
        organizationId: newId(),
      }),
    ).resolves.toBeUndefined();
  });
});
