export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';

export interface BillingEntitlementSet {
  readonly features: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
}

export interface CurrentSubscription {
  readonly organizationId: string;
  readonly planCode: string;
  readonly planName: string;
  readonly status: SubscriptionStatus;
  readonly provider: string;
  readonly currentPeriodEnd: Date | null;
  readonly entitlements: BillingEntitlementSet;
}

export interface BillingRepository {
  findCurrentSubscription(organizationId: string): Promise<CurrentSubscription | null>;
}

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');
