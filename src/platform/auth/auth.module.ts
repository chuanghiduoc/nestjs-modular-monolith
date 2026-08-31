import { type DynamicModule, Global, Module } from '@nestjs/common';

import { BetterAuthGuard, RolesGuard } from './auth.guards';
import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options';
import { AuthService } from './auth.service';

export type AuthModuleInput = AuthModuleOptions;

@Global()
@Module({})
export class AuthModule {
  static forRoot(input: AuthModuleInput): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: AUTH_OPTIONS, useValue: input },
        AuthService,
        BetterAuthGuard,
        RolesGuard,
      ],
      exports: [AuthService, BetterAuthGuard, RolesGuard],
    };
  }
}
