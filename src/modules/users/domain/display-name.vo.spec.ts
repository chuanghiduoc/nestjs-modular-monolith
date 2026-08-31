import { describe, expect, it } from 'vitest';

import { ERROR_CODES, isDomainException } from '#shared/errors';

import { DisplayName } from './display-name.vo';

const NUL = String.fromCharCode(0x00);
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
const DELETE = String.fromCharCode(0x7f);

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe('DisplayName', () => {
  it('accepts both length boundaries exactly', () => {
    expect(DisplayName.of('ab').value).toBe('ab');
    expect(DisplayName.of('x'.repeat(DisplayName.MAX_LENGTH)).value).toHaveLength(
      DisplayName.MAX_LENGTH,
    );
  });

  it('rejects one character below and one character above the range', () => {
    expect(() => DisplayName.of('a')).toThrowError();
    expect(() => DisplayName.of('x'.repeat(DisplayName.MAX_LENGTH + 1))).toThrowError();
  });

  it('trims before measuring, and keeps the trimmed value', () => {
    expect(DisplayName.of('  ab  ').value).toBe('ab');
    expect(() => DisplayName.of('   a   ')).toThrowError();
  });

  it('rejects control characters, which render invisibly in one client and as mojibake in another', () => {
    expect(() => DisplayName.of(`Ann${NUL}a`)).toThrowError();
    expect(() => DisplayName.of(`Ann${UNIT_SEPARATOR}a`)).toThrowError();
    expect(() => DisplayName.of(`Ann${DELETE}a`)).toThrowError();
    expect(() => DisplayName.of('Ann\na')).toThrowError();
  });

  it('still accepts an inner space — the control-character rule must not be over-broad', () => {
    expect(DisplayName.of('Ada Lovelace').value).toBe('Ada Lovelace');
  });

  it('throws a validation DomainException the client can act on field-by-field', () => {
    expect.assertions(4);

    const error = thrownBy(() => DisplayName.of('a'));

    expect(isDomainException(error)).toBe(true);
    if (isDomainException(error)) {
      expect(error.kind).toBe('validation');
      expect(error.code).toBe(ERROR_CODES.DISPLAY_NAME_INVALID);
      expect(error.errors).toEqual([
        expect.objectContaining({
          path: 'displayName',
          code: ERROR_CODES.DISPLAY_NAME_INVALID,
        }),
      ]);
    }
  });

  it('reports the same code for a bad length and for bad characters', () => {
    const tooShort = thrownBy(() => DisplayName.of('a'));
    const control = thrownBy(() => DisplayName.of(`Ann${NUL}a`));

    expect(isDomainException(tooShort) && tooShort.code).toBe(ERROR_CODES.DISPLAY_NAME_INVALID);
    expect(isDomainException(control) && control.code).toBe(ERROR_CODES.DISPLAY_NAME_INVALID);
  });

  it('compares by trimmed value, so padding alone does not make two names differ', () => {
    expect(DisplayName.of('Ada').equals(DisplayName.of('  Ada  '))).toBe(true);
    expect(DisplayName.of('Ada').equals(DisplayName.of('Grace'))).toBe(false);
  });

  it('stringifies to the value, so a log line reads as the name', () => {
    expect(String(DisplayName.of('  Ada  '))).toBe('Ada');
  });
});
