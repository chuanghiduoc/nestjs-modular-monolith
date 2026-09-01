import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AdminController, AdminOverviewService } from '#composition/admin';
import { AuditLogModule } from '#modules/audit-log';
import { BillingModule } from '#modules/billing';
import { OrganizationsModule, TenantContextGuard } from '#modules/organizations';
import { UploadModule } from '#modules/upload';
import { UsersModule } from '#modules/users';
import { AuthModule, BetterAuthGuard, RolesGuard } from '#platform/auth';
import { I18nModule } from '#platform/i18n';
import { ObservabilityLoggerModule, ObservabilityMetricsModule } from '#platform/observability';
import { PrismaModule } from '#platform/prisma';
import { QueueModule } from '#platform/queue';
import { RedisModule, RedisService } from '#platform/redis';
import { StorageModule } from '#platform/storage';
import { TenantContextInterceptor, TenantRolesGuard } from '#platform/tenant-context';

import type { EnvApi } from './config';
import {
  API_READINESS,
  ApiThrottlerGuard,
  createValidationPipe,
  DomainExceptionFilter,
  ErrorDocsModule,
  HealthModule,
  HttpMetricsInterceptor,
  RequestTimeoutInterceptor,
} from './http';

const QUIET_PATHS = ['/health', '/metrics'];

@Module({})
export class ApiModule {
  static forRoot(env: EnvApi): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ObservabilityLoggerModule.forRootAsync({
          useFactory: () => ({
            level: env.LOG_LEVEL,
            role: 'api',
            trustInboundRequestId: env.TRUST_INBOUND_REQUEST_ID,
            quietPaths: QUIET_PATHS,
          }),
        }),
        ObservabilityMetricsModule.forRootAsync({
          useFactory: () => ({
            allowCidrs: env.METRICS_ALLOW_CIDRS,
            cacheTtlSeconds: env.METRICS_CACHE_TTL_SECONDS,
          }),
        }),

        PrismaModule.forRoot({
          connectionString: env.DATABASE_URL,
          poolMax: env.DATABASE_POOL_MAX,
          applicationName: 'api',
        }),
        RedisModule.forRoot({ url: env.REDIS_URL }),
        QueueModule.forRoot({
          redisUrl: env.REDIS_URL,
          applicationName: 'api',
          concurrency: 1,
          startWorkers: false,
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
        AuthModule.forRoot({
          secret: env.BETTER_AUTH_SECRET,
          baseUrl: env.BETTER_AUTH_URL,
          frontendBaseUrl: env.FRONTEND_BASE_URL,
          trustedOrigins: [env.FRONTEND_BASE_URL, ...env.CORS_ORIGINS],
          useSecureCookies: env.NODE_ENV === 'production',
          requireEmailVerification: true,
        }),
        I18nModule,

        ThrottlerModule.forRootAsync({
          imports: [],
          inject: [RedisService],
          useFactory: (redis: RedisService) => ({
            throttlers: [{ ttl: env.API_RATE_LIMIT_WINDOW_MS, limit: env.API_RATE_LIMIT_MAX }],

            storage: new ThrottlerStorageRedisService(redis.client),
          }),
        }),

        HealthModule.forRole(API_READINESS),

        OrganizationsModule,
        BillingModule.forRoot(
          env.BILLING_WEBHOOK_SECRET === undefined
            ? {}
            : { webhookSecret: env.BILLING_WEBHOOK_SECRET },
        ),
        AuditLogModule.forRoot(),
        ErrorDocsModule,
        UsersModule.forRoot(),
        UploadModule.forRoot({ maxFileBytes: env.UPLOAD_MAX_FILE_BYTES }),
      ],
      controllers: [AdminController],
      providers: [
        AdminOverviewService,
        { provide: APP_GUARD, useExisting: BetterAuthGuard },
        { provide: APP_GUARD, useClass: ApiThrottlerGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
        { provide: APP_GUARD, useExisting: TenantContextGuard },
        { provide: APP_GUARD, useClass: TenantRolesGuard },

        { provide: APP_FILTER, useClass: DomainExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
        {
          provide: APP_INTERCEPTOR,
          useFactory: () => new RequestTimeoutInterceptor(env.HTTP_REQUEST_TIMEOUT_MS),
        },
        { provide: APP_PIPE, useFactory: () => createValidationPipe() },
      ],
    };
  }
}
