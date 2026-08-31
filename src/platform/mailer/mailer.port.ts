export interface SendMailCommand {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;

  readonly idempotencyKey?: string;
}

export interface MailerPort {
  send(command: SendMailCommand): Promise<void>;
}

export const MAILER = Symbol('MAILER');
