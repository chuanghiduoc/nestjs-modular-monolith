import { Inject, Injectable } from '@nestjs/common';

import { MAILER, type MailerPort } from '#platform/mailer';

import type {
  NotificationSenderPort,
  OutgoingNotification,
} from '../domain/notification-sender.port';

@Injectable()
export class MailerNotificationSender implements NotificationSenderPort {
  constructor(@Inject(MAILER) private readonly mailer: MailerPort) {}

  async send(notification: OutgoingNotification): Promise<void> {
    await this.mailer.send({
      to: notification.to,
      subject: notification.subject,
      text: notification.text,
      ...(notification.html === undefined ? {} : { html: notification.html }),
      ...(notification.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: notification.idempotencyKey }),
    });
  }
}
