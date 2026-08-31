import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { createApiApp, createSchedulerApp, createWorkerApp } from './bootstrap/app-factory';
import { loadEnvOrExit } from './bootstrap/config';

import 'reflect-metadata';

/**
 * All three roles in one process.
 *
 * This is the shape to run while developing, and a reasonable way to deploy a
 * small installation. It is NOT the same thing as merging the roles: each one
 * still builds its own Nest application, with its own module graph, its own
 * configuration and its own database credentials. What they share is a process,
 * which means they also share one event loop — a worker busy hashing an upload
 * is a worker taking time away from HTTP requests. That is the trade being made
 * here, and it is the reason production runs `main.api.js`, `main.worker.js`
 * and `main.scheduler.js` separately.
 *
 * Ports: the API takes PORT. The worker takes HEALTH_PORT and the scheduler the
 * one after it, because two servers cannot share a port and both need to be
 * probeable — the scheduler in particular is the only role that publishes the
 * outbox gauges the alert rules read.
 */
async function bootstrap(): Promise<void> {
  const apiEnv = loadEnvOrExit('api');
  const workerEnv = loadEnvOrExit('worker');
  const schedulerEnv = loadEnvOrExit('scheduler');

  const schedulerPort = schedulerEnv.HEALTH_PORT + 1;

  // Sequential, not concurrent: the roles race for the same migrations-applied
  // database and the same Redis, and starting them in a fixed order makes a
  // failed boot readable instead of interleaved.
  const api = await createApiApp(apiEnv);
  await api.listen({ port: apiEnv.PORT, host: '0.0.0.0' });

  const worker = await createWorkerApp(workerEnv);
  await worker.listen({ port: workerEnv.HEALTH_PORT, host: '0.0.0.0' });

  const scheduler = await createSchedulerApp(schedulerEnv);
  await scheduler.listen({ port: schedulerPort, host: '0.0.0.0' });

  const apps: readonly NestFastifyApplication[] = [api, worker, scheduler];

  installShutdown(apps);

  api.get(Logger).log({
    msg: 'all three roles are running in this process',
    api: apiEnv.PORT,
    worker: workerEnv.HEALTH_PORT,
    scheduler: schedulerPort,
  });
}

/**
 * One signal has to close three applications. Nest's own shutdown hooks stop
 * each app, but nothing coordinates them, so a failure to close one must not
 * leave the others running and the process alive.
 */
function installShutdown(apps: readonly NestFastifyApplication[]): void {
  let closing = false;

  const close = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;

    void (async () => {
      const results = await Promise.allSettled(apps.map((app) => app.close()));
      const failed = results.filter((result) => result.status === 'rejected');

      for (const failure of failed) {
        console.error(`all-in-one: an application failed to close on ${signal}`, failure.reason);
      }

      process.exit(failed.length > 0 ? 1 : 0);
    })();
  };

  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
