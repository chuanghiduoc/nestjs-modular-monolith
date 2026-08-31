import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type SendMailOptions } from 'nodemailer';

import { MAILER_OPTIONS, type MailerOptions } from './mailer.options';
import type { MailerPort, SendMailCommand } from './mailer.port';

const SMTPS_PORT = 465;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
const DEFAULT_GREETING_TIMEOUT_MS = 10000;
const DEFAULT_SOCKET_TIMEOUT_MS = 30000;
const IDEMPOTENCY_KEY_HEADER = 'X-Idempotency-Key';

interface SmtpCredentials {
  readonly user: string;
  readonly pass: string;
}

function buildCredentials(options: MailerOptions): SmtpCredentials | undefined {
  const { user, password } = options;
  if (user === undefined || user === '' || password === undefined || password === '') {
    return undefined;
  }

  return { user, pass: password };
}

@Injectable()
export class SmtpMailerAdapter implements MailerPort, OnModuleDestroy {
  private readonly transport: ReturnType<typeof createTransport>;
  constructor(
    @Inject(MAILER_OPTIONS)
    private readonly options: MailerOptions,
  ) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === SMTPS_PORT,
      requireTLS: options.requireTls ?? false,
      auth: buildCredentials(options),
      connectionTimeout: options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      greetingTimeout: options.greetingTimeoutMs ?? DEFAULT_GREETING_TIMEOUT_MS,
      socketTimeout: options.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS,
    });
  }

  async send(command: SendMailCommand): Promise<void> {
    const info = await this.transport.sendMail(this.toMailOptions(command));
    if (info.rejected.length > 0) {
      throw new Error(`SMTP rejected ${String(info.rejected.length)} recipient(s).`);
    }
  }

  onModuleDestroy(): void {
    this.transport.close();
  }

  private toMailOptions(command: SendMailCommand): SendMailOptions {
    return {
      from: this.options.from,
      to: command.to,
      subject: command.subject,
      text: command.text,
      html: command.html,
      headers:
        command.idempotencyKey === undefined
          ? undefined
          : { [IDEMPOTENCY_KEY_HEADER]: command.idempotencyKey },
    };
  }
}
