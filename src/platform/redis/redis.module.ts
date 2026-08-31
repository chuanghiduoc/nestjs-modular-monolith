import { type DynamicModule, Global, Module } from '@nestjs/common';

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES_PER_REQUEST,
  REDIS_OPTIONS,
  type RedisModuleOptions,
} from './redis.options';
import { RedisService } from './redis.service';

export interface RedisModuleInput {
  readonly url: string;
  readonly maxRetriesPerRequest?: number;
  readonly connectTimeoutMs?: number;
}

@Global()
@Module({})
export class RedisModule {
  static forRoot(input: RedisModuleInput): DynamicModule {
    const options: RedisModuleOptions = {
      url: input.url,
      maxRetriesPerRequest: input.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES_PER_REQUEST,
      connectTimeoutMs: input.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    };

    return {
      module: RedisModule,
      providers: [{ provide: REDIS_OPTIONS, useValue: options }, RedisService],
      exports: [RedisService],
    };
  }
}
