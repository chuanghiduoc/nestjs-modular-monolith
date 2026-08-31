import { createSchedulerApp } from './bootstrap/app-factory';
import { loadEnvOrExit } from './bootstrap/config';

import 'reflect-metadata';

async function bootstrap(): Promise<void> {
  const env = loadEnvOrExit('scheduler');
  const app = await createSchedulerApp(env);

  await app.listen({ port: env.HEALTH_PORT, host: '0.0.0.0' });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
