import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { describeErrorCode, ERROR_CODES, type ErrorCode } from '../errors';
import { PROBLEM_CONTENT_TYPE } from './problem-details.contract';
import { ProblemDetailsDto } from './problem-details.dto';

export interface ApiCommonErrorsOptions {
  readonly validation?: boolean;
  readonly notFound?: boolean;
  readonly conflict?: boolean;
  readonly forbidden?: boolean;
  readonly payloadTooLarge?: boolean;
  readonly unsupportedMediaType?: boolean;
}

interface DocumentedError {
  readonly status: number;
  readonly code: ErrorCode;
}

const ALWAYS: readonly DocumentedError[] = [
  { status: 401, code: ERROR_CODES.UNAUTHENTICATED },
  { status: 429, code: ERROR_CODES.RATE_LIMITED },
  { status: 500, code: ERROR_CODES.INTERNAL_ERROR },
];

const OPTIONAL: Readonly<Record<keyof ApiCommonErrorsOptions, DocumentedError>> = {
  validation: { status: 422, code: ERROR_CODES.VALIDATION_FAILED },
  notFound: { status: 404, code: ERROR_CODES.NOT_FOUND },
  conflict: { status: 409, code: ERROR_CODES.CONFLICT },
  forbidden: { status: 403, code: ERROR_CODES.FORBIDDEN },
  payloadTooLarge: { status: 413, code: ERROR_CODES.PAYLOAD_TOO_LARGE },
  unsupportedMediaType: { status: 415, code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE },
};

export function ApiCommonErrors(
  options: ApiCommonErrorsOptions = {},
): MethodDecorator & ClassDecorator {
  const documented = [
    ...ALWAYS,
    ...Object.entries(OPTIONAL)
      .filter(([key]) => options[key as keyof ApiCommonErrorsOptions] === true)
      .map(([, value]) => value),
  ];

  return applyDecorators(
    ...documented.map((entry) => {
      const catalog = describeErrorCode(entry.code);

      return ApiResponse({
        status: entry.status,
        description: `${catalog.summary} ${catalog.clientAction}`,
        type: ProblemDetailsDto,
        content: {
          [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
        },
      });
    }),
  );
}
