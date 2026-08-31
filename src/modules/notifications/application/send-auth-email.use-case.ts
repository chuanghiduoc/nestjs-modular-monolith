import { Inject, Injectable } from '@nestjs/common';

import {
  NOTIFICATION_SENDER,
  type NotificationSenderPort,
} from '../domain/notification-sender.port';
import {
  deleteAccountMessage,
  type RenderedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from '../domain/templates';

export type AuthEmailKind = 'verify-email' | 'reset-password' | 'delete-account';

export interface SendAuthEmailInput {
  readonly kind: AuthEmailKind;
  readonly to: string;

  readonly url: string;
  readonly idempotencyKey: string;
}

@Injectable()
export class SendAuthEmailUseCase {
  constructor(@Inject(NOTIFICATION_SENDER) private readonly sender: NotificationSenderPort) {}

  async execute(input: SendAuthEmailInput): Promise<void> {
    const message = render(input.kind, input.url);

    await this.sender.send({
      to: input.to,
      subject: message.subject,
      text: message.text,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

function render(kind: AuthEmailKind, url: string): RenderedMessage {
  switch (kind) {
    case 'verify-email':
      return verifyEmailMessage({ url });
    case 'reset-password':
      return resetPasswordMessage({ url });
    case 'delete-account':
      return deleteAccountMessage({ url });
  }
}
