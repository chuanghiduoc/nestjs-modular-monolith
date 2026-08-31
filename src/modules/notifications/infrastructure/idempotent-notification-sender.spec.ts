import { beforeEach, describe, expect, it } from 'vitest';

import type { NotificationLedgerPort } from '../domain/notification-ledger.port';
import type { OutgoingNotification } from '../domain/notification-sender.port';
import { IdempotentNotificationSender } from './idempotent-notification-sender.adapter';
import type { MailerNotificationSender } from './mailer-notification-sender.adapter';

class FakeLedger implements NotificationLedgerPort {
  readonly claimed = new Set<string>();
  released: string[] = [];
  failRelease = false;

  claim(idempotencyKey: string): Promise<boolean> {
    if (this.claimed.has(idempotencyKey)) return Promise.resolve(false);
    this.claimed.add(idempotencyKey);

    return Promise.resolve(true);
  }

  release(idempotencyKey: string): Promise<void> {
    if (this.failRelease) return Promise.reject(new Error('ledger unavailable'));

    this.released.push(idempotencyKey);
    this.claimed.delete(idempotencyKey);

    return Promise.resolve();
  }

  deleteSentBefore(): Promise<number> {
    return Promise.resolve(0);
  }
}

class RecordingMailer {
  readonly sent: OutgoingNotification[] = [];
  failNext = false;

  send(notification: OutgoingNotification): Promise<void> {
    if (this.failNext) {
      this.failNext = false;

      return Promise.reject(new Error('smtp refused the message'));
    }

    this.sent.push(notification);

    return Promise.resolve();
  }
}

function notification(key?: string): OutgoingNotification {
  return {
    to: 'someone@example.com',
    subject: 'Welcome',
    text: 'hello',
    ...(key === undefined ? {} : { idempotencyKey: key }),
  };
}

describe('IdempotentNotificationSender', () => {
  let ledger: FakeLedger;
  let mailer: RecordingMailer;
  let sender: IdempotentNotificationSender;

  beforeEach(() => {
    ledger = new FakeLedger();
    mailer = new RecordingMailer();
    sender = new IdempotentNotificationSender(
      mailer as unknown as MailerNotificationSender,
      ledger,
    );
  });

  it('sends the first time and skips every repeat of the same key', async () => {
    await sender.send(notification('key-1'));
    await sender.send(notification('key-1'));
    await sender.send(notification('key-1'));

    expect(mailer.sent).toHaveLength(1);
  });

  it('treats different keys as different messages', async () => {
    await sender.send(notification('key-1'));
    await sender.send(notification('key-2'));

    expect(mailer.sent).toHaveLength(2);
  });

  it('releases the claim when the send fails, so the retry can deliver', async () => {
    mailer.failNext = true;

    await expect(sender.send(notification('key-1'))).rejects.toThrow('smtp refused the message');
    expect(ledger.released).toEqual(['key-1']);

    await sender.send(notification('key-1'));
    expect(mailer.sent).toHaveLength(1);
  });

  it('surfaces the send failure even when the claim cannot be released', async () => {
    mailer.failNext = true;
    ledger.failRelease = true;

    await expect(sender.send(notification('key-1'))).rejects.toThrow('smtp refused the message');
  });

  it('sends an unkeyed notification rather than dropping it', async () => {
    await sender.send(notification());
    await sender.send(notification());

    expect(mailer.sent).toHaveLength(2);
  });
});
