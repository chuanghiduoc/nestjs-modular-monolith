import { PrismaPg } from '@prisma/adapter-pg';

import { createBetterAuth } from '../src/platform/auth/better-auth.factory';
import { PrismaClient } from '../src/platform/prisma/generated/client';

import 'dotenv/config';

const DEFAULT_EMAIL = 'admin@example.com';
const DEFAULT_PASSWORD = 'Str0ng-Passw0rd!';
const DEFAULT_NAME = 'Local Admin';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is required to seed.');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? DEFAULT_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_PASSWORD;

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 2 }),
  });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing === null) {
      const auth = createBetterAuth(
        prisma,
        {
          secret: process.env.BETTER_AUTH_SECRET ?? 'seed-only-secret-at-least-32-characters',
          baseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
          frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173',
          trustedOrigins: [],
          useSecureCookies: false,
          requireEmailVerification: false,
        },
        async () => {
          await Promise.resolve();
        },
      );

      await auth.api.signUpEmail({ body: { email, password, name: DEFAULT_NAME } });
      console.log(`seed: created ${email}`);
    } else {
      console.log(`seed: ${email} already exists`);
    }

    const promoted = await prisma.user.update({
      where: { email },
      data: { role: 'admin', emailVerified: true },
    });

    console.log(`seed: ${promoted.email} is admin, email verified`);
    console.log(`seed: password is ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
