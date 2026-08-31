import { Inject, Injectable } from '@nestjs/common';

import {
  NOTIFICATION_SENDER,
  type NotificationSenderPort,
} from '../domain/notification-sender.port';
import { invitationMessage } from '../domain/templates';
import { NOTIFICATION_SETTINGS, type NotificationSettings } from './notification.settings';

export interface SendInvitationEmailInput {
  readonly to: string;
  readonly organizationName: string;
  readonly token: string;
  readonly expiresAt: Date;

  readonly idempotencyKey: string;
}

@Injectable()
export class SendInvitationEmailUseCase {
  constructor(
    @Inject(NOTIFICATION_SENDER) private readonly sender: NotificationSenderPort,
    @Inject(NOTIFICATION_SETTINGS) private readonly settings: NotificationSettings,
  ) {}

  async execute(input: SendInvitationEmailInput): Promise<void> {
    const url = new URL('/invitations/accept', this.settings.frontendBaseUrl);
    url.searchParams.set('token', input.token);

    const message = invitationMessage({
      organizationName: input.organizationName,
      url: url.toString(),
      expiresAt: input.expiresAt,
    });

    await this.sender.send({
      to: input.to,
      subject: message.subject,
      text: message.text,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
