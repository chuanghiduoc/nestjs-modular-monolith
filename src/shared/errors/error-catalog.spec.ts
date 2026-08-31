import { describe, expect, it } from 'vitest';

import { describeErrorCode, ERROR_CATALOG } from './error-catalog';
import { ERROR_CODES, type ErrorCode } from './error-codes';

describe('ERROR_CATALOG', () => {
  const codes = Object.values(ERROR_CODES) as ErrorCode[];

  it('documents every published error code', () => {
    const undocumented = codes.filter((code) => ERROR_CATALOG[code] === undefined);

    expect(undocumented).toEqual([]);
  });

  it('documents nothing that is not a published code', () => {
    const published = new Set<string>(codes);
    const stale = Object.keys(ERROR_CATALOG).filter((code) => !published.has(code));

    expect(stale).toEqual([]);
  });

  it('says what happened and what the client should do about it', () => {
    for (const code of codes) {
      const entry = describeErrorCode(code);

      expect(entry.summary.length).toBeGreaterThan(10);
      expect(entry.clientAction.length).toBeGreaterThan(10);
    }
  });
});
