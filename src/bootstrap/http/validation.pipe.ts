import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { DomainErrors, ERROR_CODES, type FieldError } from '#shared/errors';

import { validationCodeFor } from './validation-codes';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,

    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'One or more fields did not pass validation.',
        toFieldErrors(errors),
      ),
  });
}

export function toFieldErrors(errors: readonly ValidationError[], parentPath = ''): FieldError[] {
  const flattened: FieldError[] = [];

  for (const error of errors) {
    const path = joinPath(parentPath, error.property);

    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      flattened.push({
        path,
        code: validationCodeFor(constraint),
        rule: constraint,
        message,
      });
    }

    if (error.children !== undefined && error.children.length > 0) {
      flattened.push(...toFieldErrors(error.children, path));
    }
  }

  return flattened;
}

function joinPath(parentPath: string, property: string): string {
  if (parentPath === '') {
    return property;
  }

  return /^\d+$/.test(property) ? `${parentPath}[${property}]` : `${parentPath}.${property}`;
}
