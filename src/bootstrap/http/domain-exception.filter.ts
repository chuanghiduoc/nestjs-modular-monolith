import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { I18nService, type Locale } from '#platform/i18n';
import { ensureRequestIds } from '#platform/observability';
import { ERROR_CODES, type FieldError, isDomainException } from '#shared/errors';

import { readDependencyChecks } from './health-check-details';
import { mapPrismaError } from './prisma-error.mapper';
import {
  buildProblemDetails,
  genericServerError,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  statusForKind,
} from './problem-details';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const { requestId } = ensureRequestIds(request.raw);
    const instance = instancePath(request.url);
    const locale = this.i18n.resolve(request.headers['accept-language']);
    const problem = this.toProblem(exception, instance, requestId, locale);

    if (problem.status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error({
        msg: 'unhandled error',
        requestId,
        instance,
        err: exception,
      });
    }

    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE);

    const retryAfter = retryAfterSecondsFor(problem.status);

    if (retryAfter !== null && reply.getHeader('retry-after') === undefined) {
      void reply.header('retry-after', String(retryAfter));
    }

    void reply.send(problem);
  }

  private toProblem(
    exception: unknown,
    instance: string,
    requestId: string,
    locale: Locale,
  ): ProblemDetails {
    // Something upstream already produced a problem document — the Fastify rate
    // limiter builds one in its errorResponseBuilder and throws it. Nest routes
    // funnel that through this filter, and wrapping it again turned a 429 into a
    // 500: the caller lost its Retry-After, and every throttled request counted
    // against the 5xx alert.
    const prebuilt = asProblemDetails(exception);

    if (prebuilt !== null) {
      return prebuilt;
    }

    if (isDomainException(exception)) {
      return buildProblemDetails({
        status: statusForKind(exception.kind),
        code: exception.code,
        detail: this.translateDetail(exception.code, exception.detail, locale),
        instance,
        requestId,
        errors: this.translateFieldErrors(exception.errors, locale),
      });
    }

    if (exception instanceof HttpException) {
      return fromHttpException(exception, instance, requestId, locale, this.i18n);
    }

    const prisma = mapPrismaError(exception);

    if (prisma !== null) {
      if (prisma.status < SERVER_ERROR_THRESHOLD) {
        this.logger.warn({
          msg: 'prisma error mapped to a client response',
          requestId,
          instance,
          status: prisma.status,
          code: prisma.code,
        });
      }

      return buildProblemDetails({
        status: prisma.status,
        code: prisma.code,
        detail: prisma.detail,
        instance,
        requestId,
      });
    }

    return genericServerError(
      instance,
      requestId,
      undefined,
      undefined,
      this.i18n.translate('errors.internal_error.detail', locale),
    );
  }

  private translateDetail(code: string, fallback: string | undefined, locale: Locale): string {
    const key = `errors.${code}.detail`;
    const translated = this.i18n.translate(key, locale);

    return translated === key ? (fallback ?? 'The request could not be completed.') : translated;
  }

  private translateFieldErrors(
    errors: readonly FieldError[],
    locale: Locale,
  ): readonly FieldError[] {
    return errors.map((error) => this.i18n.translateFieldError(error, locale));
  }
}

function fromHttpException(
  exception: HttpException,
  instance: string,
  requestId: string,
  locale: Locale,
  i18n: I18nService,
): ProblemDetails {
  const status = exception.getStatus();

  if (status >= SERVER_ERROR_THRESHOLD) {
    return genericServerError(
      instance,
      requestId,
      status,
      status === SERVICE_UNAVAILABLE_STATUS
        ? readDependencyChecks(exception.getResponse())
        : undefined,
      i18n.translate('errors.internal_error.detail', locale),
    );
  }

  const response: unknown = exception.getResponse();
  const code = readCode(response, status);
  const key = `errors.${code}.detail`;
  const translated = i18n.translate(key, locale);

  return buildProblemDetails({
    status,
    code,
    detail: translated === key ? readDetail(response, exception.message) : translated,
    instance,
    requestId,
    errors: readFieldErrors(response)?.map((error) => i18n.translateFieldError(error, locale)),
  });
}

/**
 * Recognises a problem document that was built elsewhere, so it can be passed
 * through with the status it already chose rather than re-classified.
 */
function asProblemDetails(exception: unknown): ProblemDetails | null {
  const record = asRecord(exception);

  if (record === null) {
    return null;
  }

  const { type, status, code, detail } = record;

  if (
    typeof type !== 'string' ||
    typeof status !== 'number' ||
    typeof code !== 'string' ||
    typeof detail !== 'string'
  ) {
    return null;
  }

  return record as unknown as ProblemDetails;
}

function instancePath(url: string): string {
  const queryStart = url.indexOf('?');

  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

const SERVER_ERROR_THRESHOLD = 500;
const SERVICE_UNAVAILABLE_STATUS = 503;

const RETRY_AFTER_SECONDS: Readonly<Record<number, number>> = {
  [HttpStatus.TOO_MANY_REQUESTS]: 60,
  [HttpStatus.SERVICE_UNAVAILABLE]: 5,
};

export function retryAfterSecondsFor(status: number): number | null {
  return RETRY_AFTER_SECONDS[status] ?? null;
}

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.REQUEST_TIMEOUT]: ERROR_CODES.REQUEST_TIMEOUT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_FAILED,
};

function readCode(response: unknown, status: number): string {
  const record = asRecord(response);
  const code = record?.code;

  if (typeof code === 'string') {
    return code;
  }

  return CODE_BY_STATUS[status] ?? ERROR_CODES.MALFORMED_REQUEST;
}

function readDetail(response: unknown, fallback: string): string {
  const record = asRecord(response);
  const detail = record?.detail;

  if (typeof detail === 'string') {
    return detail;
  }

  const message = record?.message;

  return typeof message === 'string' ? message : fallback;
}

function readFieldErrors(response: unknown): readonly FieldError[] | undefined {
  const record = asRecord(response);
  const errors = record?.errors;

  if (!Array.isArray(errors)) {
    return undefined;
  }

  return errors.filter((entry): entry is FieldError => {
    const candidate = asRecord(entry);

    return (
      typeof candidate?.path === 'string' &&
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string'
    );
  });
}
