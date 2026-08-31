import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { RecordingNotificationSender } from '../../../../test/support/in-memory';
import type { NotificationSettings } from './notification.settings';
import { SendWelcomeEmailUseCase } from './send-welcome-email.use-case';

const EMAIL = 'alice@example.com';
const FRONTEND = 'https://app.example.com';
const SETTINGS: NotificationSettings = { frontendBaseUrl: FRONTEND };

function createHarness(settings: NotificationSettings = SETTINGS) {
  const sender = new RecordingNotificationSender();

  return { sender, useCase: new SendWelcomeEmailUseCase(sender, settings) };
}

describe('SendWelcomeEmailUseCase', () => {
  it('addresses the message to the registered address', async () => {
    const harness = createHarness();

    await harness.useCase.execute({ userId: newId(), email: EMAIL, idempotencyKey: newId() });

    expect(harness.sender.sent).toHaveLength(1);
    expect(harness.sender.sent[0]!.to).toBe(EMAIL);
    expect(harness.sender.sent[0]!.subject).toBe('Welcome');
  });

  it('builds the link from the configured frontend base URL', async () => {
    const other = 'https://staging.example.net';
    const production = createHarness();
    const staging = createHarness({ frontendBaseUrl: other });

    await production.useCase.execute({ userId: newId(), email: EMAIL, idempotencyKey: newId() });
    await staging.useCase.execute({ userId: newId(), email: EMAIL, idempotencyKey: newId() });

    expect(production.sender.sent[0]!.text).toContain(FRONTEND);
    expect(production.sender.sent[0]!.text).not.toContain(other);
    expect(staging.sender.sent[0]!.text).toContain(other);
    expect(staging.sender.sent[0]!.text).not.toContain(FRONTEND);
  });

  it('carries the event id down to the transport as the idempotency key', async () => {
    const harness = createHarness();
    const idempotencyKey = newId();

    await harness.useCase.execute({ userId: newId(), email: EMAIL, idempotencyKey });

    expect(harness.sender.sent[0]!.idempotencyKey).toBe(idempotencyKey);
  });

  it('lets a transport failure through so BullMQ owns the retry', async () => {
    const harness = createHarness();
    harness.sender.failNextWith(new Error('454 4.7.0 try again later'));

    await expect(
      harness.useCase.execute({ userId: newId(), email: EMAIL, idempotencyKey: newId() }),
    ).rejects.toThrow('454 4.7.0 try again later');
  });
});
