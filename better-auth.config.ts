import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const schemaOnlyClient = {} as never;

export const auth = betterAuth({
  database: prismaAdapter(schemaOnlyClient, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
  },
  user: {
    deleteUser: { enabled: true },
    changeEmail: { enabled: true },
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'member',
        input: false,
      },
    },
  },
});
