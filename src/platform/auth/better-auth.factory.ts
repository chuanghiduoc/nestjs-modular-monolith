import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import { DomainErrors, ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import type { PrismaClient } from '../prisma/generated/client';
import type { AuthModuleOptions } from './auth.options';
import { type AuthMailPayload, buildFrontendTokenUrl, digestAuthToken } from './auth-mail';

export type AuthMailSender = (payload: AuthMailPayload) => Promise<void>;

/**
 * Session lookups are NOT cached in the cookie, and that is a decision, not an
 * oversight.
 *
 * Reading the session row on every request is this system's first scaling
 * bottleneck, and Better Auth's signed cookie cache would remove most of those
 * reads. It would also mean a revoked session keeps working until the cache
 * expires — and `revokeSessionsOnPasswordReset` below exists precisely so that
 * resetting a password locks out a session someone else has stolen. An e2e test
 * asserts that the old cookie is refused immediately.
 *
 * Trading that for throughput is a product decision. If you take it, shorten
 * the window as far as it will go and expect the reset-revokes-sessions test to
 * need rewriting to match the weaker promise.
 */

export function createBetterAuth(
  prisma: PrismaClient,
  options: AuthModuleOptions,
  sendMail: AuthMailSender,
) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: options.secret,
    baseURL: options.baseUrl,

    trustedOrigins: [...options.trustedOrigins],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: options.requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }: { user: { email: string }; token: string }) => {
        await sendMail({
          kind: 'reset-password',
          to: user.email,
          url: buildFrontendTokenUrl(options.frontendBaseUrl, 'reset-password', token),
          tokenDigest: digestAuthToken(token),
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({
        user,
        token,
      }: {
        user: { email: string };
        token: string;
      }) => {
        await sendMail({
          kind: 'verify-email',
          to: user.email,
          url: buildFrontendTokenUrl(options.frontendBaseUrl, 'verify-email', token),
          tokenDigest: digestAuthToken(token),
        });
      },
    },

    user: {
      changeEmail: { enabled: true },
      deleteUser: {
        enabled: true,
        // The database trigger is the real guarantee — it also covers deletions
        // that never pass through this code. This check runs first so the reason
        // reaches the logs as a named domain error rather than as a raw
        // constraint violation from three layers down.
        beforeDelete: async (user: { id: string }) => {
          const blocking = await soleOwnedOrganizations(prisma, user.id);

          if (blocking.length > 0) {
            throw DomainErrors.conflict(
              ERROR_CODES.LAST_OWNER,
              `Transfer ownership of ${String(blocking.length)} organization(s) you solely own, or archive and purge them, before deleting your account.`,
              true,
            );
          }
        },
        sendDeleteAccountVerification: async ({
          user,
          token,
        }: {
          user: { email: string };
          token: string;
        }) => {
          await sendMail({
            kind: 'delete-account',
            to: user.email,
            url: buildFrontendTokenUrl(options.frontendBaseUrl, 'delete-account', token),
            tokenDigest: digestAuthToken(token),
          });
        },
      },
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'member', input: false },
      },
    },

    advanced: {
      database: {
        generateId: () => newId(),
      },
      useSecureCookies: options.useSecureCookies,

      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.useSecureCookies,
      },
    },

    rateLimit: { enabled: false },
  });
}

/**
 * Organizations where this user is the only owner. Deleting the account would
 * cascade the membership away and leave the organization unadministrable: no
 * one could archive, restore or purge it, and there is no path to appoint a
 * replacement owner from the outside.
 */
async function soleOwnedOrganizations(
  prisma: PrismaClient,
  userId: string,
): Promise<readonly string[]> {
  const rows = await prisma.$queryRaw<readonly { organization_id: string }[]>`
    SELECT mine.organization_id
      FROM tenancy.organization_member AS mine
     WHERE mine.user_id = ${userId}::uuid
       AND mine.role = 'owner'
       AND NOT EXISTS (
             SELECT 1
               FROM tenancy.organization_member AS other
              WHERE other.organization_id = mine.organization_id
                AND other.role = 'owner'
                AND other.user_id <> mine.user_id
           )`;

  return rows.map((row) => row.organization_id);
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
