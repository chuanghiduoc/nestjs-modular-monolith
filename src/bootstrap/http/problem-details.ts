import { STATUS_CODES } from 'node:http';

import { HttpStatus } from '@nestjs/common';

import { type DomainErrorKind, ERROR_CODES, type FieldError } from '#shared/errors';

export { PROBLEM_CONTENT_TYPE } from '#shared/http';

const SERVICE_UNAVAILABLE = 503;

export const DEPENDENCY_STATES = ['up', 'down'] as const;

export type DependencyState = (typeof DEPENDENCY_STATES)[number];

export interface DependencyCheck {
  readonly name: string;
  readonly status: DependencyState;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly messageKey: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly errors?: readonly FieldError[];
  readonly checks?: readonly DependencyCheck[];
}
const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  malformed: HttpStatus.BAD_REQUEST,
  validation: HttpStatus.UNPROCESSABLE_ENTITY,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  forbidden: HttpStatus.FORBIDDEN,
};
const TITLE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Malformed request',
  [HttpStatus.UNAUTHORIZED]: 'Authentication required',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload too large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported media type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Validation failed',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests',
  [HttpStatus.REQUEST_TIMEOUT]: 'Request timeout',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service unavailable',
};

export function statusForKind(kind: DomainErrorKind): number {
  return STATUS_BY_KIND[kind];
}
export function titleForStatus(status: number): string {
  return TITLE_BY_STATUS[status] ?? STATUS_CODES[status] ?? 'Error';
}
export function typeForCode(code: string): string {
  return `/errors/${code.replaceAll('_', '-')}`;
}
export interface BuildProblemInput {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly errors?: readonly FieldError[];
  readonly checks?: readonly DependencyCheck[];
  readonly timestamp?: Date;
}
export function buildProblemDetails(input: BuildProblemInput): ProblemDetails {
  return {
    type: typeForCode(input.code),
    title: titleForStatus(input.status),
    status: input.status,
    code: input.code,
    messageKey: `errors.${input.code}.detail`,
    detail: input.detail,
    instance: input.instance,
    requestId: input.requestId,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    ...(input.errors === undefined || input.errors.length === 0 ? {} : { errors: input.errors }),
    ...(input.checks === undefined || input.checks.length === 0 ? {} : { checks: input.checks }),
  };
}
export function genericServerError(
  instance: string,
  requestId: string,
  status: number = HttpStatus.INTERNAL_SERVER_ERROR,
  checks?: readonly DependencyCheck[],
  detail = 'The request could not be completed.',
): ProblemDetails {
  return buildProblemDetails({
    status,
    code:
      status === SERVICE_UNAVAILABLE ? ERROR_CODES.SERVICE_UNAVAILABLE : ERROR_CODES.INTERNAL_ERROR,
    detail:
      status === SERVICE_UNAVAILABLE
        ? 'The service is temporarily unable to handle the request.'
        : detail,
    instance,
    requestId,
    checks,
  });
}
