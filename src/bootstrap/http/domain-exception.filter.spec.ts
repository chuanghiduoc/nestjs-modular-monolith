import type { ArgumentsHost } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nService } from '#platform/i18n';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { DomainExceptionFilter } from './domain-exception.filter';
import { buildProblemDetails } from './problem-details';

interface CapturedReply {
  status?: number;
  headers: Record<string, string>;
  body?: unknown;
}

function hostFor(captured: CapturedReply): ArgumentsHost {
  const reply = {
    status(code: number) {
      captured.status = code;

      return reply;
    },
    header(name: string, value: string) {
      captured.headers[name] = value;

      return reply;
    },
    getHeader(name: string): string | undefined {
      return captured.headers[name];
    },
    send(payload: unknown) {
      captured.body = payload;

      return reply;
    },
  };

  const request = { url: '/api/v1/health/live?x=1', raw: { headers: {} }, headers: {} };

  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;
}

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;
  let captured: CapturedReply;

  beforeEach(() => {
    filter = new DomainExceptionFilter(new I18nService());
    captured = { headers: {} };
  });

  it('passes through a problem document that was already built upstream', () => {
    // The Fastify rate limiter builds its own RFC 9457 body and throws it. Nest
    // routes funnel that here, and re-classifying it turned every throttled
    // request into a 500 — the caller lost Retry-After, and the 5xx alert fired
    // on traffic that was being correctly rejected.
    const thrownByRateLimiter = buildProblemDetails({
      status: 429,
      code: ERROR_CODES.RATE_LIMITED,
      detail: 'Rate limit exceeded. Retry in 42 seconds.',
      instance: '/health/live',
      requestId: '01a00000-0000-7000-8000-000000000001',
    });

    filter.catch(thrownByRateLimiter, hostFor(captured));

    expect(captured.status).toBe(429);
    expect(captured.body).toMatchObject({
      status: 429,
      code: ERROR_CODES.RATE_LIMITED,
      type: '/errors/rate-limited',
    });
    expect(captured.headers['retry-after']).toBe('60');
  });

  it('still classifies a domain exception itself', () => {
    filter.catch(
      DomainErrors.notFound(ERROR_CODES.UPLOAD_NOT_FOUND, 'Upload not found.'),
      hostFor(captured),
    );

    expect(captured.status).toBe(404);
    expect(captured.body).toMatchObject({ code: ERROR_CODES.UPLOAD_NOT_FOUND, status: 404 });
  });

  it('still classifies a framework exception itself', () => {
    filter.catch(new ForbiddenException(), hostFor(captured));

    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({ status: 403, code: ERROR_CODES.FORBIDDEN });
  });

  it('does not mistake an arbitrary object for a problem document', () => {
    // A plain Error, or anything without the full shape, must still become a
    // 500 rather than being echoed back to the caller.
    filter.catch({ type: 'not-a-problem', status: 'nope' }, hostFor(captured));

    expect(captured.status).toBe(500);
    expect(captured.body).toMatchObject({ status: 500, code: ERROR_CODES.INTERNAL_ERROR });
  });
});
