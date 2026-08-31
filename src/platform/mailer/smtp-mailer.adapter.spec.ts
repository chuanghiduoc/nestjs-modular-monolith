import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailerOptions } from './mailer.options';
import { SmtpMailerAdapter } from './smtp-mailer.adapter';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));

vi.mock('nodemailer', () => ({ createTransport: mocks.createTransport }));

const OPTIONS: MailerOptions = {
  host: 'smtp.test',
  port: 587,
  from: 'no-reply@test',
  user: 'mailer',
  password: 'secret',
};

const COMMAND = {
  to: 'user@test',
  subject: 'Reset your password',
  text: 'Open the link.',
};

describe('SmtpMailerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
    mocks.sendMail.mockResolvedValue({
      messageId: '<1@test>',
      accepted: ['user@test'],
      rejected: [],
    });
  });

  describe('transport options', () => {
    it('bounds connect, greeting and socket time explicitly', () => {
      new SmtpMailerAdapter(OPTIONS);

      expect(mocks.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 30_000,
        }),
      );
    });

    it('lets the caller override each timeout', () => {
      new SmtpMailerAdapter({
        ...OPTIONS,
        connectionTimeoutMs: 1_000,
        greetingTimeoutMs: 2_000,
        socketTimeoutMs: 3_000,
      });

      expect(mocks.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: 1_000,
          greetingTimeout: 2_000,
          socketTimeout: 3_000,
        }),
      );
    });

    it('uses implicit TLS on 465 and STARTTLS elsewhere', () => {
      new SmtpMailerAdapter({ ...OPTIONS, port: 465 });
      expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));

      new SmtpMailerAdapter(OPTIONS);
      expect(mocks.createTransport).toHaveBeenLastCalledWith(
        expect.objectContaining({ secure: false, port: 587 }),
      );
    });

    it('passes credentials when both are configured', () => {
      new SmtpMailerAdapter(OPTIONS);

      expect(mocks.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { user: 'mailer', pass: 'secret' } }),
      );
    });

    it('sends no auth to an unauthenticated relay rather than a blank one', () => {
      new SmtpMailerAdapter({ ...OPTIONS, user: '', password: undefined });

      expect(mocks.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });

    it('can require TLS', () => {
      new SmtpMailerAdapter({ ...OPTIONS, requireTls: true });

      expect(mocks.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ requireTLS: true }),
      );
    });
  });

  describe('send', () => {
    it('maps the command onto nodemailer options, with the configured sender', async () => {
      const adapter = new SmtpMailerAdapter(OPTIONS);

      await adapter.send({ ...COMMAND, html: '<p>Open the link.</p>' });

      expect(mocks.sendMail).toHaveBeenCalledWith({
        from: 'no-reply@test',
        to: 'user@test',
        subject: 'Reset your password',
        text: 'Open the link.',
        html: '<p>Open the link.</p>',
        headers: undefined,
      });
    });

    it('carries the idempotency key as a header', async () => {
      const adapter = new SmtpMailerAdapter(OPTIONS);

      await adapter.send({ ...COMMAND, idempotencyKey: 'job-42' });

      expect(mocks.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { 'X-Idempotency-Key': 'job-42' } }),
      );
    });

    it('fails the job when the envelope was rejected, rather than resolving quietly', async () => {
      mocks.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['user@test'] });
      const adapter = new SmtpMailerAdapter(OPTIONS);

      await expect(adapter.send(COMMAND)).rejects.toThrow('SMTP rejected 1 recipient(s).');
    });

    it('throws instead of retrying, so BullMQ owns the backoff', async () => {
      mocks.sendMail.mockRejectedValueOnce(new Error('454 4.7.0 try again later'));
      const adapter = new SmtpMailerAdapter(OPTIONS);

      await expect(adapter.send(COMMAND)).rejects.toThrow('454 4.7.0 try again later');
      expect(mocks.sendMail).toHaveBeenCalledOnce();
    });
  });

  it('closes the transport on shutdown', () => {
    const adapter = new SmtpMailerAdapter(OPTIONS);

    adapter.onModuleDestroy();

    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
