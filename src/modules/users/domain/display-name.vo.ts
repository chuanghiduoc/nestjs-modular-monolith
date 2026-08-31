import { DomainErrors, ERROR_CODES } from '#shared/errors';

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

export class DisplayName {
  static readonly MIN_LENGTH = 2;
  static readonly MAX_LENGTH = 80;

  private constructor(readonly value: string) {}

  static of(raw: string): DisplayName {
    const trimmed = raw.trim();

    if (trimmed.length < DisplayName.MIN_LENGTH || trimmed.length > DisplayName.MAX_LENGTH) {
      throw DomainErrors.validation(
        ERROR_CODES.DISPLAY_NAME_INVALID,
        `Display name must be between ${String(DisplayName.MIN_LENGTH)} and ${String(DisplayName.MAX_LENGTH)} characters.`,
        [
          {
            path: 'displayName',
            code: ERROR_CODES.DISPLAY_NAME_INVALID,
            message: 'invalid length',
          },
        ],
      );
    }

    if (containsControlCharacter(trimmed)) {
      throw DomainErrors.validation(
        ERROR_CODES.DISPLAY_NAME_INVALID,
        'Display name must not contain control characters.',
        [
          {
            path: 'displayName',
            code: ERROR_CODES.DISPLAY_NAME_INVALID,
            message: 'invalid characters',
          },
        ],
      );
    }

    return new DisplayName(trimmed);
  }

  /**
   * For values that were already accepted by `of()` on their way into storage.
   *
   * Re-validating on read looks safe and is not: the day a rule tightens, every
   * stored row that predates it starts throwing on load, and the endpoint a user
   * would need in order to fix their own name is the one that breaks first.
   * Invariants belong at the write boundary.
   */
  static rehydrate(stored: string): DisplayName {
    return new DisplayName(stored);
  }

  equals(other: DisplayName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
