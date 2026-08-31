export interface OutgoingNotification {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;

  readonly idempotencyKey?: string;
}

export interface NotificationSenderPort {
  send(notification: OutgoingNotification): Promise<void>;
}

export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');
