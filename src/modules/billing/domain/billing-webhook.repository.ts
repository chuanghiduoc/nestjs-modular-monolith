export interface BillingWebhookInboxRepository {
  claim(input: {
    readonly provider: string;
    readonly providerEventId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<string | null>;

  /** The claimed event, or null when the lease has moved on to someone else. */
  findClaimed(
    provider: string,
    providerEventId: string,
    claimToken: string,
  ): Promise<{ readonly payload: Readonly<Record<string, unknown>> } | null>;

  markProcessed(provider: string, providerEventId: string, claimToken: string): Promise<void>;

  markFailed(
    provider: string,
    providerEventId: string,
    claimToken: string,
    error: string,
  ): Promise<void>;

  deleteProcessedBefore(cutoff: Date, limit: number): Promise<number>;
}

export const BILLING_WEBHOOK_INBOX_REPOSITORY = Symbol('BILLING_WEBHOOK_INBOX_REPOSITORY');
