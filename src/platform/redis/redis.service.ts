import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_OPTIONS, type RedisModuleOptions } from './redis.options';

const CLOSED_STATUSES = new Set(['end', 'close']);

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  readonly client: Redis;

  constructor(@Inject(REDIS_OPTIONS) options: RedisModuleOptions) {
    this.client = new Redis(options.url, {
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      enableOfflineQueue: false,
      connectTimeout: options.connectTimeoutMs,
      lazyConnect: false,
    });

    this.client.on('error', (error: Error) => {
      this.logger.warn({ msg: 'redis error', err: { name: error.name, message: error.message } });
    });
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    if (CLOSED_STATUSES.has(this.client.status)) {
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn({
        msg: 'redis refused QUIT during shutdown, dropping the socket',
        err: error,
      });
      this.client.disconnect();
    }
  }
}
