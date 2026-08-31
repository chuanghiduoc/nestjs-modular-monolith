import type { SubscriptionStatus } from './billing.repository';

export interface NormalisedBillingEvent {
  readonly type: 'subscription.updated' | 'subscription.canceled';
  readonly organizationId: string;
  readonly planCode?: string;
  readonly status?: SubscriptionStatus;
  readonly providerRef?: string;
  readonly currentPeriodEnd?: string;
}

/**
 * The seam where a verified provider event becomes a change to what a customer
 * may do.
 *
 * Left unimplemented on purpose. The inbox, the signature check, the queue and
 * the retry budget are all generic and ship working; deciding that
 * "subscription.updated" means a particular row moves to a particular status is
 * not, and doing it wrong silently grants or removes paid access. Implement this
 * for your provider and grant app_worker write access to billing.subscription at
 * the same time.
 */
export interface BillingEventApplierPort {
  apply(provider: string, event: NormalisedBillingEvent): Promise<void>;
}

export const BILLING_EVENT_APPLIER = Symbol('BILLING_EVENT_APPLIER');
