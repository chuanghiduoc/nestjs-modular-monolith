import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';

import type { AuthService } from '#platform/auth';
import { withTimeout } from '#shared/util';

import { registerAuthAccountRateLimit } from './auth-account-rate-limit';

export const CREDENTIAL_PATHS = [
  '/sign-in/email',
  '/sign-up/email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/verify-password',
  '/change-email',
  '/send-verification-email',
  '/delete-user',
] as const;

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);

export interface AuthRouteOptions {
  readonly authService: AuthService;
  readonly basePath: string;

  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly redis: Redis;
  readonly strict: { readonly max: number; readonly timeWindowMs: number };
  readonly account: { readonly max: number; readonly timeWindowMs: number };
  readonly loose: { readonly max: number; readonly timeWindowMs: number };
}

export async function registerAuthRoutes(
  instance: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  await instance.register(
    (scope: FastifyInstance, _options: unknown, done: (error?: Error) => void) => {
      scope.addContentTypeParser(
        ['application/json', 'application/x-www-form-urlencoded', '*'],
        { parseAs: 'buffer' },
        (_request, body: Buffer, parsed: (error: Error | null, value?: Buffer) => void) => {
          parsed(null, body);
        },
      );

      registerAuthAccountRateLimit(scope, {
        redis: options.redis,
        max: options.account.max,
        timeWindowMs: options.account.timeWindowMs,
        credentialPaths: CREDENTIAL_PATHS.map((path) => `${options.basePath}${path}`),
      });

      const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const response = await withTimeout(
          options.authService.handleWebRequest(toWebRequest(request, options.baseUrl)),
          options.timeoutMs,
          'auth',
        );

        void reply.status(response.status);

        const setCookies = response.headers.getSetCookie();

        if (setCookies.length > 0) {
          void reply.header('set-cookie', setCookies);
        }

        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'set-cookie') {
            void reply.header(key, value);
          }
        });

        const body = await response.arrayBuffer();
        void reply.send(body.byteLength === 0 ? null : Buffer.from(body));
      };

      for (const path of CREDENTIAL_PATHS) {
        scope.all(
          path,
          {
            config: {
              rateLimit: { max: options.strict.max, timeWindow: options.strict.timeWindowMs },
            },
          },
          handler,
        );
      }

      scope.all(
        '/*',
        {
          config: {
            rateLimit: { max: options.loose.max, timeWindow: options.loose.timeWindowMs },
          },
        },
        handler,
      );

      done();
    },
    { prefix: options.basePath },
  );
}

function toWebRequest(request: FastifyRequest, baseUrl: string): Request {
  const url = new URL(request.url, baseUrl);
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
    } else if (value !== undefined) {
      headers.append(name, value);
    }
  }

  const body = toBody(request);

  return new Request(url, {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function toBody(request: FastifyRequest): Buffer | string | undefined {
  if (METHODS_WITHOUT_BODY.has(request.method)) {
    return undefined;
  }

  const raw: unknown = request.body;

  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (Buffer.isBuffer(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    return raw;
  }

  return JSON.stringify(raw);
}
