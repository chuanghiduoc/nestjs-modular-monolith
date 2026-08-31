import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AuditLogModule } from '#modules/audit-log';
import { BillingModule } from '#modules/billing';
import { NotificationsModule } from '#modules/notifications';
import { UploadModule } from '#modules/upload';
import { UsersModule } from '#modules/users';
import { AuthRetentionModule } from '#platform/auth';
import { I18nModule } from '#platform/i18n';
import { MailerModule } from '#platform/mailer';
import { ObservabilityLoggerModule, ObservabilityMetricsModule } from '#platform/observability';
import { PrismaModule } from '#platform/prisma';
import { QueueModule } from '#platform/queue';
import { StorageModule } from '#platform/storage';

import type { EnvWorker } from './config';
import { DomainExceptionFilter, HealthModule, WORKER_READINESS } from './http';

@Module({})
export class WorkerModule {
  static forRoot(env: EnvWorker): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        I18nModule,
        ObservabilityLoggerModule.forRootAsync({
          useFactory: () => ({
            level: env.LOG_LEVEL,
            role: 'worker',

            trustInboundRequestId: false,
            quietPaths: ['/health', '/metrics'],
          }),
        }),
        // Queue depth and dead-letter depth are what the on-call alerts read,
        // and this is the role that actually consumes those queues.
        ObservabilityMetricsModule.forRootAsync({
          useFactory: () => ({
            allowCidrs: env.METRICS_ALLOW_CIDRS,
            cacheTtlSeconds: env.METRICS_CACHE_TTL_SECONDS,
          }),
        }),

        PrismaModule.forRoot({
          connectionString: env.DATABASE_URL,
          poolMax: env.DATABASE_POOL_MAX,
          applicationName: 'worker',
        }),
        QueueModule.forRoot({
          redisUrl: env.REDIS_URL,
          applicationName: 'worker',
          concurrency: env.QUEUE_CONCURRENCY,

          startWorkers: true,
        }),
        StorageModule.forRoot({
          driver: env.FILE_DRIVER,
          bucket: env.S3_BUCKET,
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        }),
        MailerModule.forRoot({
          host: env.MAIL_HOST,
          port: env.MAIL_PORT,
          from: env.MAIL_FROM,
          ...(env.MAIL_USER === undefined ? {} : { user: env.MAIL_USER }),
          ...(env.MAIL_PASSWORD === undefined ? {} : { password: env.MAIL_PASSWORD }),
          requireTls: env.NODE_ENV === 'production',
        }),

        HealthModule.forRole(WORKER_READINESS),

        UsersModule.forRoot({ exposeHttp: false }),
        AuditLogModule.forRoot({ retentionDays: env.AUDIT_RETENTION_DAYS, exposeHttp: false }),
        BillingModule.forRoot({ exposeHttp: false }),
        AuthRetentionModule.forRoot(),
        UploadModule.forRoot({ maxFileBytes: env.UPLOAD_MAX_FILE_BYTES, exposeHttp: false }),
        NotificationsModule.forRoot({
          frontendBaseUrl: env.FRONTEND_BASE_URL ?? 'http://localhost:5173',
        }),
      ],
      providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
    };
  }
}
