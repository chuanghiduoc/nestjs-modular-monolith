import { defineConfig } from 'prisma/config';

import 'dotenv/config';

const directUrl = process.env.DATABASE_DIRECT_URL;
const url = directUrl === undefined || directUrl === '' ? process.env.DATABASE_URL : directUrl;

export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url,
    ...(process.env.SHADOW_DATABASE_URL === undefined
      ? {}
      : { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }),
  },
});
