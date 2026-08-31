import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  NOTIFICATION_LEDGER,
  type NotificationLedgerPort,
} from '../domain/notification-ledger.port';
import type {
  NotificationSenderPort,
  OutgoingNotification,
} from '../domain/notification-sender.port';
import { MailerNotificationSender } from './mailer-notification-sender.adapter';

/**
 * Wraps the real sender in a once-only guarantee.
 *
 * A provider-side idempotency header is a request, not a contract — most SMTP
 * servers ignore it entirely. This keeps the promise on our side of the wire,
 * where it can be relied on.
 */
@Injectable()
export class IdempotentNotificationSender implements NotificationSenderPort {
  private readonly logger = new Logger(IdempotentNotificationSender.name);

  constructor(
    private readonly delegate: MailerNotificationSender,
    @Inject(NOTIFICATION_LEDGER) private readonly ledger: NotificationLedgerPort,
  ) {}

  async send(notification: OutgoingNotification): Promise<void> {
    const key = notification.idempotencyKey;

    // An unkeyed notification cannot be deduplicated; sending it is still better
    // than dropping it, and every caller in this codebase supplies a key.
    if (key === undefined) {
      await this.delegate.send(notification);

      return;
    }

    if (!(await this.ledger.claim(key, 'email'))) {
      this.logger.debug({ msg: 'notification already sent; skipping duplicate', key });

      return;
    }

    try {
      await this.delegate.send(notification);
    } catch (error) {
      await this.releaseQuietly(key);
      throw error;
    }
  }

  private async releaseQuietly(key: string): Promise<void> {
    try {
      await this.ledger.release(key);
    } catch (error) {
      // Losing the release costs one undelivered message. Letting it mask the
      // original send failure would cost the reason.
      this.logger.warn({
        msg: 'could not release a notification claim; the retry will be skipped',
        key,
        err: error,
      });
    }
  }
}
