import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';

import { type EnvWorker, loadEnv } from '../../src/bootstrap/config';
import { WorkerModule } from '../../src/bootstrap/worker.module';

export interface TestWorkerOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly mailHost: string;
  readonly mailPort: number;
  readonly frontendBaseUrl: string;
}

export interface TestWorker {
  readonly app: NestFastifyApplication;
  readonly env: EnvWorker;
  stop(): Promise<void>;
}

export async function startTestWorker(options: TestWorkerOptions): Promise<TestWorker> {
  const env = loadEnv('worker', workerEnvSource(options));

  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot(env)],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  await app.init();

  return {
    app,
    env,
    async stop(): Promise<void> {
      await app.close();
    },
  };
}

function workerEnvSource(options: TestWorkerOptions): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',

    DATABASE_URL: options.databaseUrl,
    REDIS_URL: options.redisUrl,
    DATABASE_DIRECT_URL: '',
    DATABASE_POOL_MAX: '5',
    QUEUE_CONCURRENCY: '2',
    HEALTH_PORT: '3101',

    FRONTEND_BASE_URL: options.frontendBaseUrl,

    MAIL_HOST: options.mailHost,
    MAIL_PORT: String(options.mailPort),
    MAIL_FROM: 'no-reply@example.com',

    UPLOAD_MAX_FILE_BYTES: '1048576',

    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'e2e-uploads',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'e2e',
    S3_SECRET_ACCESS_KEY: 'e2e-secret',
    S3_FORCE_PATH_STYLE: 'true',
  };
}
