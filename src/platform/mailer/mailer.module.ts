import { type DynamicModule, Global, Module } from '@nestjs/common';

import { MAILER_OPTIONS, type MailerOptions } from './mailer.options';
import { MAILER } from './mailer.port';
import { SmtpMailerAdapter } from './smtp-mailer.adapter';

@Global()
@Module({})
export class MailerModule {
  static forRoot(options: MailerOptions): DynamicModule {
    return {
      module: MailerModule,
      providers: [
        { provide: MAILER_OPTIONS, useValue: options },
        { provide: MAILER, useClass: SmtpMailerAdapter },
      ],
      exports: [MAILER],
    };
  }
}
