import { DomainErrors, ERROR_CODES } from '#shared/errors';

export class __MODULE_PASCAL__Label {
  static readonly MIN_LENGTH = 1;
  static readonly MAX_LENGTH = 120;

  private constructor(readonly value: string) {}

  static of(raw: string): __MODULE_PASCAL__Label {
    const trimmed = raw.trim();

    if (trimmed.length < __MODULE_PASCAL__Label.MIN_LENGTH || trimmed.length > __MODULE_PASCAL__Label.MAX_LENGTH) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        `Label must be between ${String(__MODULE_PASCAL__Label.MIN_LENGTH)} and ${String(__MODULE_PASCAL__Label.MAX_LENGTH)} characters.`,
        [{ path: 'label', code: ERROR_CODES.VALIDATION_FAILED, message: 'invalid length' }],
      );
    }

    if (containsControlCharacter(trimmed)) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'Label must not contain control characters.',
        [{ path: 'label', code: ERROR_CODES.VALIDATION_FAILED, message: 'invalid characters' }],
      );
    }

    return new __MODULE_PASCAL__Label(trimmed);
  }

  equals(other: __MODULE_PASCAL__Label): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}
