import { ERROR_CODES, type ErrorCode } from './error-codes';

export type DomainErrorKind = 'malformed' | 'validation' | 'not_found' | 'conflict' | 'forbidden';

export interface FieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly rule?: string;
}

export interface DomainExceptionOptions {
  readonly kind: DomainErrorKind;
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly errors?: readonly FieldError[];

  readonly permanent?: boolean;
  readonly cause?: unknown;
}

export class DomainException extends Error {
  readonly kind: DomainErrorKind;
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly errors: readonly FieldError[];
  readonly permanent: boolean;

  constructor(options: DomainExceptionOptions) {
    super(options.detail ?? options.code, { cause: options.cause });
    this.name = 'DomainException';
    this.kind = options.kind;
    this.code = options.code;
    this.detail = options.detail;
    this.errors = options.errors ?? [];
    this.permanent = options.permanent ?? true;
  }
}

export function isDomainException(error: unknown): error is DomainException {
  return error instanceof DomainException;
}

export const DomainErrors = {
  malformed(code: ErrorCode, detail: string, cause?: unknown): DomainException {
    return new DomainException({ kind: 'malformed', code, detail, cause });
  },

  validation(code: ErrorCode, detail: string, errors: readonly FieldError[] = []): DomainException {
    return new DomainException({ kind: 'validation', code, detail, errors });
  },

  notFound(code: ErrorCode, detail: string): DomainException {
    return new DomainException({ kind: 'not_found', code, detail });
  },

  conflict(code: ErrorCode, detail: string, permanent = false): DomainException {
    return new DomainException({ kind: 'conflict', code, detail, permanent });
  },

  forbidden(code: ErrorCode = ERROR_CODES.FORBIDDEN, detail = 'Not permitted.'): DomainException {
    return new DomainException({ kind: 'forbidden', code, detail });
  },
} as const;
