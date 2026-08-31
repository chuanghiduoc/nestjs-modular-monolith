export interface NotificationLedgerPort {
  /**
   * Reserves the key for this delivery. `false` means someone already sent it.
   *
   * Claiming before the send, rather than recording after it, is what makes a
   * concurrent duplicate impossible: two workers racing on the same event both
   * reach the unique key, and only one of them gets to call the provider.
   */
  claim(idempotencyKey: string, channel: string): Promise<boolean>;

  /**
   * Releases a claim whose send never happened, so the retry is free to try
   * again. A failure to release is not fatal — it costs one undelivered message
   * rather than risking a duplicate.
   */
  release(idempotencyKey: string): Promise<void>;

  /** Retention. Returns how many rows this call removed. */
  deleteSentBefore(cutoff: Date, limit: number): Promise<number>;
}

export const NOTIFICATION_LEDGER = Symbol('NOTIFICATION_LEDGER');
