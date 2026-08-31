import type { Server } from 'node:http';

import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { RedisContainer } from '@testcontainers/redis';
import { Logger } from 'nestjs-pino';
import request from 'supertest';

import { AuthService } from '#platform/auth';
import { RedisService } from '#platform/redis';
import { newId } from '#shared/util';

import { ApiModule } from '../../src/bootstrap/api.module';
import { type EnvApi, loadEnv } from '../../src/bootstrap/config';
import {
  applyFastifyProblemDetailsHook,
  registerAuthRoutes,
  registerFastifyPlugins,
} from '../../src/bootstrap/fastify';
import { startTestDatabase, type TestDatabase } from './database';

const REDIS_IMAGE = 'redis:8-alpine';

const RATE_LIMIT_MAX = '10000';

const TEST_PASSWORD = 'e2e-password-2026';

export interface TestApi {
  readonly app: NestFastifyApplication;
  readonly server: Server;
  readonly env: EnvApi;
  readonly database: TestDatabase;
  stop(): Promise<void>;
}

export interface TestSession {
  readonly cookie: string;
  readonly userId: string;
  readonly email: string;
}

export interface TestApiOptions {
  readonly authAccountRateLimitMax?: number;
}

export async function startTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const database = await startTestDatabase();
  const redisContainer = await new RedisContainer(REDIS_IMAGE).start();

  const env = loadEnv('api', {
    ...apiEnvSource(database.connectionString, redisContainer.getConnectionUrl()),
    ...(options.authAccountRateLimitMax === undefined
      ? {}
      : { AUTH_ACCOUNT_RATE_LIMIT_MAX: String(options.authAccountRateLimitMax) }),
  });

  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule.forRoot(env)],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: env.HTTP_BODY_LIMIT_BYTES, trustProxy: env.TRUST_PROXY }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

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

  await registerFastifyPlugins(instance, {
    corsOrigins: env.CORS_ORIGINS,
    redis: app.get(RedisService).client,
    trustInboundRequestId: false,
    globalRateLimit: { max: env.API_RATE_LIMIT_MAX, timeWindowMs: env.API_RATE_LIMIT_WINDOW_MS },
  });

  applyFastifyProblemDetailsHook(instance, { passthroughPrefix: `/${env.API_PREFIX}/auth` });

  await registerAuthRoutes(instance, {
    authService: app.get(AuthService),
    basePath: `/${env.API_PREFIX}/auth`,
    timeoutMs: 30_000,
    baseUrl: env.BETTER_AUTH_URL,
    redis: app.get(RedisService).client,
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

  await app.init();
  await instance.ready();

  return {
    app,
    server: app.getHttpServer(),
    env,
    database,
    async stop(): Promise<void> {
      await app.close();
      await redisContainer.stop();
      await database.stop();
    },
  };
}

export async function signInAsNewUser(
  api: TestApi,
  options: { readonly role?: string } = {},
): Promise<TestSession> {
  const email = `${newId()}@example.com`;
  const authPath = `/${api.env.API_PREFIX}/auth`;

  const signUp = await request(api.server)
    .post(`${authPath}/sign-up/email`)
    .send({ email, password: TEST_PASSWORD, name: 'E2E User' });

  if (signUp.status !== 200) {
    throw new Error(`sign-up failed with ${String(signUp.status)}: ${JSON.stringify(signUp.body)}`);
  }

  const rows = await api.database.cleaner.query<{ id: string }>(
    `UPDATE auth."user"
        SET email_verified = true, role = $2
      WHERE email = $1
      RETURNING id`,
    [email, options.role ?? 'member'],
  );

  const userId = rows[0]?.id;

  if (userId === undefined) {
    throw new Error(`sign-up did not create an auth.user row for ${email}`);
  }

  const signIn = await request(api.server)
    .post(`${authPath}/sign-in/email`)
    .send({ email, password: TEST_PASSWORD });

  if (signIn.status !== 200) {
    throw new Error(`sign-in failed with ${String(signIn.status)}: ${JSON.stringify(signIn.body)}`);
  }

  return { cookie: toCookieHeader(signIn.headers['set-cookie']), userId, email };
}

function toCookieHeader(setCookie: string | string[] | undefined): string {
  const cookies = setCookie === undefined ? [] : [setCookie].flat();

  if (cookies.length === 0) {
    throw new Error('Sign-in returned no Set-Cookie header');
  }

  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function apiEnvSource(databaseUrl: string, redisUrl: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',

    DATABASE_URL: databaseUrl,
    DATABASE_DIRECT_URL: '',
    DATABASE_POOL_MAX: '5',
    QUEUE_CONCURRENCY: '2',
    HEALTH_PORT: '3001',

    PORT: '3000',
    API_PREFIX: 'api',
    REDIS_URL: redisUrl,
    CORS_ORIGINS: 'http://localhost:5173',

    BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
    BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    FRONTEND_BASE_URL: 'http://localhost:5173',

    HTTP_BODY_LIMIT_BYTES: '1048576',
    HTTP_REQUEST_TIMEOUT_MS: '30000',
    TRUST_INBOUND_REQUEST_ID: 'false',
    TRUST_PROXY: 'false',

    AUTH_RATE_LIMIT_MAX: RATE_LIMIT_MAX,
    AUTH_ACCOUNT_RATE_LIMIT_MAX: RATE_LIMIT_MAX,
    AUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS: '60000',
    AUTH_RATE_LIMIT_WINDOW_MS: '60000',
    AUTH_SESSION_RATE_LIMIT_MAX: RATE_LIMIT_MAX,
    AUTH_SESSION_RATE_LIMIT_WINDOW_MS: '60000',
    API_RATE_LIMIT_MAX: RATE_LIMIT_MAX,
    API_RATE_LIMIT_WINDOW_MS: '60000',

    METRICS_ALLOW_CIDRS: '127.0.0.1/32,::1/128',
    METRICS_CACHE_TTL_SECONDS: '0',

    UPLOAD_MAX_FILE_BYTES: '1048576',

    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'e2e-uploads',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'e2e',
    S3_SECRET_ACCESS_KEY: 'e2e-secret',
    S3_FORCE_PATH_STYLE: 'true',
  };
}
