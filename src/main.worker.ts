import { createWorkerApp } from './bootstrap/app-factory';
import { loadEnvOrExit } from './bootstrap/config';

import 'reflect-metadata';

async function bootstrap(): Promise<void> {
  const env = loadEnvOrExit('worker');
  const app = await createWorkerApp(env);

  await app.listen({ port: env.HEALTH_PORT, host: '0.0.0.0' });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
