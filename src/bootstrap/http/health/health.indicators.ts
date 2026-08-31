import { Injectable, Optional } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { PrismaService } from '#platform/prisma';
import { BullMqService } from '#platform/queue';
import { RedisService } from '#platform/redis';
import { withTimeout } from '#shared/util';

const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthIndicators {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly queue?: BullMqService,
  ) {}

  async postgres(): Promise<HealthIndicatorResult> {
    const indicator = this.health.check('postgres');

    try {
      await withTimeout(this.prisma.db.$queryRawUnsafe('SELECT 1'), PROBE_TIMEOUT_MS, 'postgres');

      return indicator.up();
    } catch (error) {
      return indicator.down({ reason: describe(error) });
    }
  }

  async redisReachable(): Promise<HealthIndicatorResult> {
    const indicator = this.health.check('redis');

    if (this.redis === undefined) {
      return indicator.down({ reason: 'redis is not configured for this role' });
    }

    try {
      const pong = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS, 'redis');

      return pong ? indicator.up() : indicator.down({ reason: 'unexpected ping response' });
    } catch (error) {
      return indicator.down({ reason: describe(error) });
    }
  }

  async queueStarted(): Promise<HealthIndicatorResult> {
    const indicator = this.health.check('queue');

    if (this.queue === undefined) {
      return indicator.down({ reason: 'queue is not configured for this role' });
    }

    try {
      const reachable = await withTimeout(this.queue.ping(), PROBE_TIMEOUT_MS, 'queue');

      return reachable ? indicator.up() : indicator.down({ reason: 'BullMQ Redis is unavailable' });
    } catch (error) {
      return indicator.down({ reason: describe(error) });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
