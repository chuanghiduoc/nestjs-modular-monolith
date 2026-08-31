import { Inject, Injectable } from '@nestjs/common';

import {
  NOTIFICATION_SENDER,
  type NotificationSenderPort,
} from '../domain/notification-sender.port';
import { welcomeMessage } from '../domain/templates';
import { NOTIFICATION_SETTINGS, type NotificationSettings } from './notification.settings';

export interface SendWelcomeEmailInput {
  readonly userId: string;
  readonly email: string;

  readonly idempotencyKey: string;
}

@Injectable()
export class SendWelcomeEmailUseCase {
  constructor(
    @Inject(NOTIFICATION_SENDER) private readonly sender: NotificationSenderPort,
    @Inject(NOTIFICATION_SETTINGS) private readonly settings: NotificationSettings,
  ) {}

  async execute(input: SendWelcomeEmailInput): Promise<void> {
    const message = welcomeMessage({
      email: input.email,
      frontendBaseUrl: this.settings.frontendBaseUrl,
    });

    await this.sender.send({
      to: input.email,
      subject: message.subject,
      text: message.text,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
