import type { IncomingMessage } from 'node:http';

import type { Params } from 'nestjs-pino';
import { stdSerializers, stdTimeFunctions } from 'pino';
import type { Options } from 'pino-http';

import type { LoggerOptions } from './options';
import { ensureRequestIds } from './request-id';
import { sanitiseUrl } from './sanitise-url';

const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'token',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'better-auth.session_token',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
] as const;

const REDACT_DEPTH = 4;

const DEFAULT_QUIET_PATHS = ['/metrics'] as const;

export const REDACT_PATHS: readonly string[] = buildRedactPaths();

export function buildLoggerParams(options: LoggerOptions): Params {
  return { pinoHttp: buildPinoHttpOptions(options) };
}

export function buildPinoHttpOptions(options: LoggerOptions): Options {
  const quietPaths = options.quietPaths ?? DEFAULT_QUIET_PATHS;
  const requestIdOptions = { trustInboundRequestId: options.trustInboundRequestId };

  return {
    level: options.level,
    base: { service: options.role },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },

    formatters: { level: (label) => ({ level: label }) },
    timestamp: stdTimeFunctions.isoTime,

    genReqId: (request) => ensureRequestIds(request, requestIdOptions).requestId,

    customProps: (request) => ensureRequestIds(request, requestIdOptions),

    customLogLevel: (_request, response, error) => {
      if (error !== undefined || response.statusCode >= 500) {
        return 'error';
      }

      return response.statusCode >= 400 ? 'warn' : 'info';
    },

    autoLogging: { ignore: (request) => isQuietPath(request.url, quietPaths) },

    serializers: {
      req: (request: IncomingMessage) => {
        const serialised = stdSerializers.req(request);

        return {
          ...serialised,
          url: typeof serialised.url === 'string' ? sanitiseUrl(serialised.url) : serialised.url,
        };
      },
    },
  };
}

export function isQuietPath(url: string | undefined, quietPaths: readonly string[]): boolean {
  if (url === undefined) {
    return false;
  }

  return quietPaths.some((quiet) => url === quiet || url.startsWith(`${quiet}?`));
}

function buildRedactPaths(): string[] {
  const paths: string[] = [];

  for (const key of SENSITIVE_KEYS) {
    for (let depth = 0; depth < REDACT_DEPTH; depth += 1) {
      const wildcards = Array.from({ length: depth }, () => '*').join('.');
      paths.push(`${wildcards}["${key}"]`);
    }
  }

  return paths;
}
