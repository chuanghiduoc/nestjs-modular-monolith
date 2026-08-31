import { type DynamicModule, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AuthService } from '#platform/auth';
import { RedisService } from '#platform/redis';
import { LocalStorageAdapter } from '#platform/storage';

import { ApiModule } from './api.module';
import type { EnvApi, EnvScheduler, EnvWorker } from './config';
import {
  applyFastifyProblemDetailsHook,
  registerAuthRoutes,
  registerFastifyPlugins,
  registerLocalUploadRoutes,
} from './fastify';
import { setupSwagger } from './http';
import { SchedulerModule } from './scheduler.module';
import { WorkerModule } from './worker.module';

/**
 * One place that knows how to assemble each role, so a process can host one of
 * them or all three without the wiring drifting between entrypoints.
 *
 * Every factory returns an application that is configured but not listening —
 * the caller decides the port, because that is the only thing that differs
 * between running a role alone and running it beside the others.
 */
export async function createApiApp(env: EnvApi): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: env.HTTP_BODY_LIMIT_BYTES,
    ignoreTrailingSlash: true,
    trustProxy: env.TRUST_PROXY,
  });
  const app = await NestFactory.create<NestFastifyApplication>(ApiModule.forRoot(env), adapter, {
    bufferLogs: true,
    // Billing webhooks are signed over the bytes that arrived. A body parsed and
    // re-serialised is a different document and fails its own signature.
    rawBody: true,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.setGlobalPrefix(env.API_PREFIX, {
    exclude: [
      'health/live',
      'health/ready',
      'health/dependencies',
      'metrics',
      'errors',
      'errors/:slug',
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const instance = app.getHttpAdapter().getInstance();
  const redis = app.get(RedisService);

  await registerFastifyPlugins(instance, {
    corsOrigins: env.CORS_ORIGINS,
    redis: redis.client,
    trustInboundRequestId: env.TRUST_INBOUND_REQUEST_ID,
    globalRateLimit: {
      max: env.API_RATE_LIMIT_MAX,
      timeWindowMs: env.API_RATE_LIMIT_WINDOW_MS,
    },
  });
  applyFastifyProblemDetailsHook(instance, { passthroughPrefix: `/${env.API_PREFIX}/auth` });
  await registerAuthRoutes(instance, {
    authService: app.get(AuthService),
    basePath: `/${env.API_PREFIX}/auth`,
    baseUrl: env.BETTER_AUTH_URL,
    timeoutMs: env.HTTP_REQUEST_TIMEOUT_MS,
    redis: redis.client,
    strict: { max: env.AUTH_RATE_LIMIT_MAX, timeWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS },
    account: {
      max: env.AUTH_ACCOUNT_RATE_LIMIT_MAX,
      timeWindowMs: env.AUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS,
    },
    loose: {
      max: env.AUTH_SESSION_RATE_LIMIT_MAX,
      timeWindowMs: env.AUTH_SESSION_RATE_LIMIT_WINDOW_MS,
    },
  });

  if (env.FILE_DRIVER === 'local') {
    await registerLocalUploadRoutes(instance, {
      storage: app.get(LocalStorageAdapter),
      bucket: env.S3_BUCKET,
      maxFileBytes: env.UPLOAD_MAX_FILE_BYTES,
    });
  }

  if (env.NODE_ENV !== 'production') {
    setupSwagger(app, { apiPrefix: env.API_PREFIX, version: '1' });
  }

  app.enableShutdownHooks();

  return app;
}

export async function createWorkerApp(env: EnvWorker): Promise<NestFastifyApplication> {
  return createProbeOnlyApp(WorkerModule.forRoot(env));
}

export async function createSchedulerApp(env: EnvScheduler): Promise<NestFastifyApplication> {
  return createProbeOnlyApp(SchedulerModule.forRoot(env));
}

/**
 * Worker and scheduler are not web servers; they listen only so an orchestrator
 * can probe them and Prometheus can read the gauges they alone produce.
 */
async function createProbeOnlyApp(module: DynamicModule): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(module, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.enableShutdownHooks();

  return app;
}
