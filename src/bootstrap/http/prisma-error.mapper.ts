import { HttpStatus } from '@nestjs/common';

import { ERROR_CODES, type ErrorCode } from '#shared/errors';

interface MappedPrismaError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail: string;
}

const BY_PRISMA_CODE: Record<string, MappedPrismaError> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    code: ERROR_CODES.CONFLICT,
    detail: 'That value is already in use.',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    code: ERROR_CODES.CONFLICT,
    detail: 'A related record prevents this change.',
  },

  P2025: {
    status: HttpStatus.NOT_FOUND,
    code: ERROR_CODES.NOT_FOUND,
    detail: 'Not found.',
  },

  P2023: {
    status: HttpStatus.BAD_REQUEST,
    code: ERROR_CODES.MALFORMED_REQUEST,
    detail: 'The request contained a value the server could not interpret.',
  },

  P2024: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    detail: 'The service is busy. Retry shortly.',
  },
  P2028: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    detail: 'The service is busy. Retry shortly.',
  },
};

export function mapPrismaError(error: unknown): MappedPrismaError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { name?: unknown; code?: unknown };

  if (typeof candidate.name !== 'string' || !candidate.name.startsWith('PrismaClient')) {
    return null;
  }

  if (typeof candidate.code === 'string') {
    const mapped = BY_PRISMA_CODE[candidate.code];
    if (mapped !== undefined) {
      return mapped;
    }
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_ERROR,
    detail: 'The request could not be completed.',
  };
}
