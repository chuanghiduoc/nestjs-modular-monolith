import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { I18nModule } from '#platform/i18n';
import { MessagingModule } from '#platform/messaging';
import { ObservabilityLoggerModule, ObservabilityMetricsModule } from '#platform/observability';
import { PrismaModule } from '#platform/prisma';
import { QueueModule } from '#platform/queue';

import type { EnvScheduler } from './config';
import { DomainExceptionFilter, HealthModule, SCHEDULER_READINESS } from './http';

const DRAIN_TRANSACTION_TIMEOUT_MS = 30_000;

@Module({})
export class SchedulerModule {
  static forRoot(env: EnvScheduler): DynamicModule {
    return {
      module: SchedulerModule,
      imports: [
        I18nModule,
        ObservabilityLoggerModule.forRootAsync({
          useFactory: () => ({
            level: env.LOG_LEVEL,
            role: 'scheduler',
            trustInboundRequestId: false,
            quietPaths: ['/health', '/metrics'],
          }),
        }),
        // The outbox gauges are produced here and nowhere else. Without a
        // metrics endpoint on this role, OutboxNotDraining and OutboxQuarantined
        // are alerts on a series that never exists.
        ObservabilityMetricsModule.forRootAsync({
          useFactory: () => ({
            allowCidrs: env.METRICS_ALLOW_CIDRS,
            cacheTtlSeconds: env.METRICS_CACHE_TTL_SECONDS,
          }),
        }),

        PrismaModule.forRoot({
          connectionString: env.DATABASE_URL,
          poolMax: env.DATABASE_POOL_MAX,
          applicationName: 'scheduler',
          transactionTimeoutMs: DRAIN_TRANSACTION_TIMEOUT_MS,
        }),
        QueueModule.forRoot({
          redisUrl: env.REDIS_URL,
          applicationName: 'scheduler',

          concurrency: 1,
          startWorkers: true,
          registerSchedules: true,
        }),
        MessagingModule.forRoot({
          drainBatchSize: env.OUTBOX_DRAIN_BATCH_SIZE,
          drainIntervalSeconds: env.OUTBOX_DRAIN_INTERVAL_SECONDS,
          retentionDays: env.OUTBOX_RETENTION_DAYS,
        }),

        HealthModule.forRole(SCHEDULER_READINESS),
      ],
      providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
    };
  }
}
