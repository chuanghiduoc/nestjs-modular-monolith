import { describe, expect, it, vi } from 'vitest';

import type { BillingRepository, CurrentSubscription } from './billing.repository';
import { DefaultEntitlementService } from './entitlement.service';

const ORGANIZATION_ID = '01a00000-0000-7000-8000-000000000001';

function subscription(features: readonly string[]): CurrentSubscription {
  return {
    organizationId: ORGANIZATION_ID,
    planCode: 'pro',
    planName: 'Pro',
    status: 'active',
    provider: 'test',
    currentPeriodEnd: null,
    entitlements: { features, limits: { seats: 10 } },
  };
}

function repository(row: CurrentSubscription | null): BillingRepository {
  return { findCurrentSubscription: vi.fn(() => Promise.resolve(row)) };
}

describe('DefaultEntitlementService', () => {
  it('answers several questions from a single read', async () => {
    const billing = repository(subscription(['exports']));
    const service = new DefaultEntitlementService(billing);

    await expect(service.hasFeature(ORGANIZATION_ID, 'exports')).resolves.toBe(true);
    await expect(service.hasFeature(ORGANIZATION_ID, 'sso')).resolves.toBe(false);
    await expect(service.limitFor(ORGANIZATION_ID, 'seats')).resolves.toBe(10);

    expect(billing.findCurrentSubscription).toHaveBeenCalledTimes(1);
  });

  it('reads again once the cached window has passed', async () => {
    vi.useFakeTimers();

    try {
      const billing = repository(subscription(['exports']));
      const service = new DefaultEntitlementService(billing);

      await service.getFor(ORGANIZATION_ID);
      vi.advanceTimersByTime(31_000);
      await service.getFor(ORGANIZATION_ID);

      expect(billing.findCurrentSubscription).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches per organization, not globally', async () => {
    const billing = repository(subscription(['exports']));
    const service = new DefaultEntitlementService(billing);

    await service.getFor(ORGANIZATION_ID);
    await service.getFor('01a00000-0000-7000-8000-000000000002');

    expect(billing.findCurrentSubscription).toHaveBeenCalledTimes(2);
  });

  it('reports no entitlements when there is no live subscription', async () => {
    const service = new DefaultEntitlementService(repository(null));

    await expect(service.getFor(ORGANIZATION_ID)).resolves.toEqual({ features: [], limits: {} });
    await expect(service.limitFor(ORGANIZATION_ID, 'seats')).resolves.toBeNull();
  });
});
