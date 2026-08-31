import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { RecordingNotificationSender } from '../../../../test/support/in-memory';
import { type AuthEmailKind, SendAuthEmailUseCase } from './send-auth-email.use-case';

const TO = 'alice@example.com';
const LINK = 'https://app.example.com/auth/verify?token=abc123';

const EXPECTED_SUBJECT: Record<AuthEmailKind, string> = {
  'verify-email': 'Confirm your email address',
  'reset-password': 'Reset your password',
  'delete-account': 'Confirm account deletion',
};

const KINDS: readonly AuthEmailKind[] = ['verify-email', 'reset-password', 'delete-account'];

function createHarness() {
  const sender = new RecordingNotificationSender();

  return { sender, useCase: new SendAuthEmailUseCase(sender) };
}

describe('SendAuthEmailUseCase', () => {
  it('covers every kind the type declares', () => {
    expect(KINDS).toHaveLength(Object.keys(EXPECTED_SUBJECT).length);
  });

  it('renders each kind with its own subject and the link untouched', async () => {
    const harness = createHarness();

    for (const kind of KINDS) {
      await harness.useCase.execute({ kind, to: TO, url: LINK, idempotencyKey: newId() });
    }

    expect(harness.sender.sent.map((message) => message.subject)).toEqual(
      KINDS.map((kind) => EXPECTED_SUBJECT[kind]),
    );
    for (const message of harness.sender.sent) {
      expect(message.to).toBe(TO);
      expect(message.text).toContain(LINK);
    }
  });

  it('gives each kind a distinct body rather than one generic message', async () => {
    const harness = createHarness();

    for (const kind of KINDS) {
      await harness.useCase.execute({ kind, to: TO, url: LINK, idempotencyKey: newId() });
    }

    const bodies = new Set(harness.sender.sent.map((message) => message.text));
    expect(bodies.size).toBe(KINDS.length);
  });

  it('carries the event id down to the transport as the idempotency key', async () => {
    const harness = createHarness();
    const idempotencyKey = newId();

    await harness.useCase.execute({
      kind: 'reset-password',
      to: TO,
      url: LINK,
      idempotencyKey,
    });

    expect(harness.sender.sent[0]!.idempotencyKey).toBe(idempotencyKey);
  });

  it('lets a transport failure through so BullMQ owns the retry', async () => {
    const harness = createHarness();
    harness.sender.failNextWith(new Error('554 5.7.1 rejected'));

    await expect(
      harness.useCase.execute({
        kind: 'verify-email',
        to: TO,
        url: LINK,
        idempotencyKey: newId(),
      }),
    ).rejects.toThrow('554 5.7.1 rejected');
  });
});
