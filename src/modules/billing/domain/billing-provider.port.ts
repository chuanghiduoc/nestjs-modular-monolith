export interface BillingProviderPort {
  readonly providerName: string;

  createCheckoutSession(input: {
    organizationId: string;
    planCode: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ readonly checkoutUrl: string; readonly providerReference: string }>;

  cancelSubscription(providerReference: string): Promise<void>;
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export interface BillingWebhookVerifierPort {
  verify(payload: string, signature: string): Promise<Readonly<Record<string, unknown>>>;
}

export const BILLING_WEBHOOK_VERIFIER = Symbol('BILLING_WEBHOOK_VERIFIER');
