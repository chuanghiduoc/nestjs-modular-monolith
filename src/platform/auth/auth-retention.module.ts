import { type DynamicModule, Module } from '@nestjs/common';

import {
  AUTH_RETENTION_OPTIONS,
  type AuthRetentionOptions,
  DEFAULT_AUTH_PRUNE_BATCH_SIZE,
  DEFAULT_EXPIRED_SESSION_GRACE_HOURS,
} from './auth-retention.options';
import { AuthRetentionService } from './auth-retention.service';
import { PruneExpiredAuthListener } from './prune-expired-auth.listener';

export interface AuthRetentionModuleInput {
  readonly expiredSessionGraceHours?: number;
  readonly batchSize?: number;
}

@Module({})
export class AuthRetentionModule {
  static forRoot(input: AuthRetentionModuleInput = {}): DynamicModule {
    const options: AuthRetentionOptions = {
      expiredSessionGraceHours:
        input.expiredSessionGraceHours ?? DEFAULT_EXPIRED_SESSION_GRACE_HOURS,
      batchSize: input.batchSize ?? DEFAULT_AUTH_PRUNE_BATCH_SIZE,
    };

    return {
      module: AuthRetentionModule,
      providers: [
        { provide: AUTH_RETENTION_OPTIONS, useValue: options },
        AuthRetentionService,
        PruneExpiredAuthListener,
      ],
      exports: [AuthRetentionService],
    };
  }
}
