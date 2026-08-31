import type { FastifyInstance } from 'fastify';

import { ensureRequestIds } from '#platform/observability';
import { ERROR_CODES } from '#shared/errors';

import { buildProblemDetails, PROBLEM_CONTENT_TYPE } from '../http/problem-details';

export interface ProblemDetailsHookOptions {
  readonly passthroughPrefix?: string;
}

export function applyFastifyProblemDetailsHook(
  instance: FastifyInstance,
  options: ProblemDetailsHookOptions = {},
): void {
  instance.addHook('onSend', (request, reply, payload, done) => {
    const status = reply.statusCode;

    if (status < 400) {
      done(null, payload);

      return;
    }

    const passthrough =
      options.passthroughPrefix !== undefined &&
      request.url.startsWith(options.passthroughPrefix) &&
      status < 500;

    if (isProblemDetailsPayload(payload)) {
      void reply.header('content-type', PROBLEM_CONTENT_TYPE);
      done(null, payload);

      return;
    }

    if (passthrough) {
      done(null, payload);

      return;
    }

    const contentType = reply.getHeader('content-type');

    if (typeof contentType === 'string' && contentType.includes(PROBLEM_CONTENT_TYPE)) {
      done(null, payload);

      return;
    }

    const { requestId } = ensureRequestIds(request.raw);

    const problem = buildProblemDetails({
      status,
      code: status >= 500 ? ERROR_CODES.INTERNAL_ERROR : codeForClientStatus(status),
      detail:
        status >= 500
          ? 'The request could not be completed.'
          : 'The request was rejected before it reached the application.',

      instance: stripQuery(request.url),
      requestId,
    });

    void reply.header('content-type', PROBLEM_CONTENT_TYPE);
    done(null, JSON.stringify(problem));
  });
}

function codeForClientStatus(status: number): string {
  switch (status) {
    case 401:
      return ERROR_CODES.UNAUTHENTICATED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 413:
      return ERROR_CODES.PAYLOAD_TOO_LARGE;
    case 415:
      return ERROR_CODES.UNSUPPORTED_MEDIA_TYPE;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return ERROR_CODES.MALFORMED_REQUEST;
  }
}

function stripQuery(url: string): string {
  const queryStart = url.indexOf('?');

  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function isProblemDetailsPayload(payload: unknown): boolean {
  if (typeof payload !== 'string' || !payload.startsWith('{')) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(payload);

    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }

    const candidate = parsed as Record<string, unknown>;

    return (
      typeof candidate.type === 'string' &&
      typeof candidate.status === 'number' &&
      typeof candidate.code === 'string' &&
      typeof candidate.requestId === 'string'
    );
  } catch {
    return false;
  }
}
