import { describe, expect, it } from 'vitest';

import { retryAfterSecondsFor } from './domain-exception.filter';

describe('retryAfterSecondsFor', () => {
  it('answers for every status a client is meant to back off from', () => {
    expect(retryAfterSecondsFor(429)).toBeGreaterThan(0);
    expect(retryAfterSecondsFor(503)).toBeGreaterThan(0);
  });

  it('says nothing for statuses that retrying will not fix', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 415, 422, 500]) {
      expect(retryAfterSecondsFor(status)).toBeNull();
    }
  });

  it('keeps the 503 hint shorter than the 429 one', () => {
    expect(retryAfterSecondsFor(503)).toBeLessThan(retryAfterSecondsFor(429) ?? 0);
  });
});
