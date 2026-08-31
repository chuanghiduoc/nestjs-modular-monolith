import { type DynamicModule, Module } from '@nestjs/common';

import {
  NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from './application/notification.settings';
import { PruneNotificationLedgerUseCase } from './application/prune-notification-ledger.use-case';
import { SendAuthEmailUseCase } from './application/send-auth-email.use-case';
import { SendInvitationEmailUseCase } from './application/send-invitation-email.use-case';
import { SendWelcomeEmailUseCase } from './application/send-welcome-email.use-case';
import { NOTIFICATION_LEDGER } from './domain/notification-ledger.port';
import { NOTIFICATION_SENDER } from './domain/notification-sender.port';
import { IdempotentNotificationSender } from './infrastructure/idempotent-notification-sender.adapter';
import { PruneNotificationLedgerListener } from './infrastructure/listeners/prune-notification-ledger.listener';
import { SendAuthEmailListener } from './infrastructure/listeners/send-auth-email.listener';
import { SendInvitationEmailListener } from './infrastructure/listeners/send-invitation-email.listener';
import { SendWelcomeEmailListener } from './infrastructure/listeners/send-welcome-email.listener';
import { MailerNotificationSender } from './infrastructure/mailer-notification-sender.adapter';
import { PrismaNotificationLedger } from './infrastructure/prisma-notification-ledger.adapter';

export type NotificationsModuleInput = NotificationSettings;

@Module({})
export class NotificationsModule {
  static forRoot(input: NotificationsModuleInput): DynamicModule {
    return {
      module: NotificationsModule,
      providers: [
        { provide: NOTIFICATION_SETTINGS, useValue: input },
        SendWelcomeEmailUseCase,
        SendAuthEmailUseCase,
        SendInvitationEmailUseCase,
        PruneNotificationLedgerUseCase,
        SendWelcomeEmailListener,
        SendAuthEmailListener,
        SendInvitationEmailListener,
        PruneNotificationLedgerListener,
        MailerNotificationSender,
        { provide: NOTIFICATION_LEDGER, useClass: PrismaNotificationLedger },
        { provide: NOTIFICATION_SENDER, useClass: IdempotentNotificationSender },
      ],
      exports: [SendWelcomeEmailUseCase, SendAuthEmailUseCase, SendInvitationEmailUseCase],
    };
  }
}
