export interface ClaimedWebhook {
  readonly provider: string;
  readonly providerEventId: string;
  readonly claimToken: string;
}

/**
 * Hands a recorded webhook to whatever will apply it. The transport is an
 * implementation detail: the endpoint's job ends once the event is durable in
 * the inbox and someone has been told about it.
 */
export interface WebhookDispatcherPort {
  dispatchClaimed(event: ClaimedWebhook): Promise<void>;
}

export const WEBHOOK_DISPATCHER = Symbol('WEBHOOK_DISPATCHER');
