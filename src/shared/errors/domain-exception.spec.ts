import { describe, expect, it } from 'vitest';

import { DomainErrors, DomainException, isDomainException } from './domain-exception';
import { ERROR_CODES } from './error-codes';

describe('DomainException', () => {
  it('defaults `permanent` to true — a rejected rule does not become valid by waiting', () => {
    const error = new DomainException({
      kind: 'validation',
      code: ERROR_CODES.VALIDATION_FAILED,
    });

    expect(error.permanent).toBe(true);
  });

  it('defaults `errors` to an empty array, never undefined', () => {
    const error = new DomainException({ kind: 'not_found', code: ERROR_CODES.NOT_FOUND });

    expect(error.errors).toEqual([]);
  });

  it('keeps the underlying cause for the log without putting it in the response', () => {
    const cause = new Error('duplicate key value violates unique constraint');

    const withCause = new DomainException({
      kind: 'conflict',
      code: ERROR_CODES.CONFLICT,
      detail: 'Already exists.',
      cause,
    });
    const withoutCause = DomainErrors.conflict(ERROR_CODES.CONFLICT, 'Already exists.');

    expect(withCause.cause).toBe(cause);
    expect(withCause.detail).toBe('Already exists.');
    expect(withoutCause.cause).toBeUndefined();
  });

  it('is a real Error, so a stack and the standard logger fields exist', () => {
    const error = DomainErrors.notFound(ERROR_CODES.USER_NOT_FOUND, 'No such user.');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainException');
    expect(error.message).toBe('No such user.');
  });

  it('falls back to the code as the message when no detail was given', () => {
    const error = new DomainException({ kind: 'forbidden', code: ERROR_CODES.FORBIDDEN });

    expect(error.message).toBe(ERROR_CODES.FORBIDDEN);
    expect(error.detail).toBeUndefined();
  });
});

describe('isDomainException', () => {
  it('accepts a DomainException and rejects a plain Error', () => {
    expect(isDomainException(DomainErrors.forbidden())).toBe(true);
    expect(isDomainException(new Error('boom'))).toBe(false);
    expect(isDomainException(new TypeError('boom'))).toBe(false);
  });

  it('rejects a look-alike object and every non-error value', () => {
    expect(isDomainException({ kind: 'validation', code: 'validation_failed' })).toBe(false);
    expect(isDomainException(null)).toBe(false);
    expect(isDomainException(undefined)).toBe(false);
    expect(isDomainException('validation_failed')).toBe(false);
  });
});

describe('DomainErrors', () => {
  it('gives each named constructor its own kind, so kind and code cannot drift by copy-paste', () => {
    expect(DomainErrors.malformed(ERROR_CODES.CURSOR_MALFORMED, 'Bad cursor.').kind).toBe(
      'malformed',
    );
    expect(DomainErrors.validation(ERROR_CODES.VALIDATION_FAILED, 'Bad input.').kind).toBe(
      'validation',
    );
    expect(DomainErrors.notFound(ERROR_CODES.USER_NOT_FOUND, 'No such user.').kind).toBe(
      'not_found',
    );
    expect(DomainErrors.conflict(ERROR_CODES.CONFLICT, 'In flight.').kind).toBe('conflict');
    expect(DomainErrors.forbidden().kind).toBe('forbidden');
  });

  it('marks a conflict as retryable, because a later attempt could win it', () => {
    expect(DomainErrors.conflict(ERROR_CODES.CONFLICT, 'Work in flight.').permanent).toBe(false);
    expect(DomainErrors.conflict(ERROR_CODES.CONFLICT, 'Already confirmed.', true).permanent).toBe(
      true,
    );
  });

  it('leaves everything except a conflict permanent', () => {
    expect(DomainErrors.malformed(ERROR_CODES.CURSOR_MALFORMED, 'Bad cursor.').permanent).toBe(
      true,
    );
    expect(DomainErrors.validation(ERROR_CODES.VALIDATION_FAILED, 'Bad input.').permanent).toBe(
      true,
    );
    expect(DomainErrors.notFound(ERROR_CODES.USER_NOT_FOUND, 'No such user.').permanent).toBe(true);
    expect(DomainErrors.forbidden().permanent).toBe(true);
  });

  it('carries the field errors validation() was handed, and defaults them to empty', () => {
    const withFields = DomainErrors.validation(ERROR_CODES.DISPLAY_NAME_INVALID, 'Bad name.', [
      { path: 'displayName', code: ERROR_CODES.DISPLAY_NAME_INVALID, message: 'invalid length' },
    ]);

    expect(withFields.errors).toHaveLength(1);
    expect(withFields.errors[0]?.path).toBe('displayName');
    expect(DomainErrors.validation(ERROR_CODES.VALIDATION_FAILED, 'Bad input.').errors).toEqual([]);
  });

  it('gives forbidden() a usable default that says nothing about what exists', () => {
    const error = DomainErrors.forbidden();

    expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(error.detail).toBe('Not permitted.');
  });
});
