import type {
  NotificationSenderPort,
  OutgoingNotification,
} from '../../../src/modules/notifications/domain/notification-sender.port';
import { type JournalOptions, TestJournal } from './journal';

export class RecordingNotificationSender implements NotificationSenderPort {
  readonly journal: TestJournal;
  readonly sent: OutgoingNotification[] = [];

  private failure: Error | null = null;

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  failNextWith(error: Error): void {
    this.failure = error;
  }

  send(notification: OutgoingNotification): Promise<void> {
    this.sent.push(notification);
    this.journal.record('sender', 'send', notification.to);

    if (this.failure !== null) {
      const error = this.failure;
      this.failure = null;

      return Promise.reject(error);
    }

    return Promise.resolve();
  }
}
