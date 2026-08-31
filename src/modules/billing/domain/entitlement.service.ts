import type { BillingEntitlementSet, BillingRepository } from './billing.repository';

export interface EntitlementService {
  hasFeature(organizationId: string, feature: string): Promise<boolean>;
  limitFor(organizationId: string, metric: string): Promise<number | null>;
  getFor(organizationId: string): Promise<BillingEntitlementSet>;
}

export const ENTITLEMENT_SERVICE = Symbol('ENTITLEMENT_SERVICE');

const EMPTY: BillingEntitlementSet = { features: [], limits: {} };

/**
 * Entitlements change when a webhook arrives, which is rare, but they are read
 * on the hot path — potentially several times per request, since every
 * `hasFeature` call is its own question. A short per-process window collapses
 * those into one query without making a plan change wait noticeably.
 */
const CACHE_TTL_MS = 30_000;
const MAX_CACHED_TENANTS = 10_000;

interface CacheEntry {
  readonly value: BillingEntitlementSet;
  readonly freshUntilMs: number;
}

export class DefaultEntitlementService implements EntitlementService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly billing: BillingRepository) {}

  async hasFeature(organizationId: string, feature: string): Promise<boolean> {
    const entitlements = await this.getFor(organizationId);

    return entitlements.features.includes(feature);
  }

  async limitFor(organizationId: string, metric: string): Promise<number | null> {
    const entitlements = await this.getFor(organizationId);

    return entitlements.limits[metric] ?? null;
  }

  async getFor(organizationId: string): Promise<BillingEntitlementSet> {
    const cached = this.cache.get(organizationId);
    const now = Date.now();

    if (cached !== undefined && cached.freshUntilMs > now) {
      return cached.value;
    }

    const subscription = await this.billing.findCurrentSubscription(organizationId);
    const value = subscription?.entitlements ?? EMPTY;

    this.remember(organizationId, { value, freshUntilMs: now + CACHE_TTL_MS });

    return value;
  }

  /**
   * A bounded map, because the key space is "every tenant that ever called".
   * Dropping the oldest insertion is enough: entries expire on their own, and
   * the cost of a miss is one query.
   */
  private remember(organizationId: string, entry: CacheEntry): void {
    if (this.cache.size >= MAX_CACHED_TENANTS) {
      const oldest = this.cache.keys().next();

      if (oldest.done !== true) this.cache.delete(oldest.value);
    }

    this.cache.set(organizationId, entry);
  }
}
