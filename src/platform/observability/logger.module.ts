import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { buildLoggerParams } from './logger';
import type { LoggerOptions, ObservabilityAsyncOptions } from './options';

@Module({})
export class ObservabilityLoggerModule {
  static forRootAsync<TDeps extends readonly unknown[]>(
    options: ObservabilityAsyncOptions<LoggerOptions, TDeps>,
  ): DynamicModule {
    return {
      module: ObservabilityLoggerModule,
      imports: [
        LoggerModule.forRootAsync({
          imports: options.imports,
          inject: options.inject,
          useFactory: async (...deps: TDeps) =>
            buildLoggerParams(await options.useFactory(...deps)),
        }),
      ],

      exports: [LoggerModule],
    };
  }
}
