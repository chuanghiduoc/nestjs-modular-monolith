export interface MailerOptions {
  readonly host: string;
  readonly port: number;

  readonly from: string;

  readonly user?: string;
  readonly password?: string;

  readonly requireTls?: boolean;

  readonly connectionTimeoutMs?: number;

  readonly greetingTimeoutMs?: number;

  readonly socketTimeoutMs?: number;
}

export const MAILER_OPTIONS = Symbol('MAILER_OPTIONS');
