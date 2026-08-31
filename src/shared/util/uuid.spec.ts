import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isUuidV7, newId } from './uuid';

const UUID_V4 = '6f4a2c1e-9b3d-4c7a-8f21-0d5e6a7b8c9d';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

afterEach(() => {
  vi.useRealTimers();
});

describe('newId', () => {
  it('returns a valid UUID v7', () => {
    expect(isUuidV7(newId())).toBe(true);
  });

  it('returns a different id every call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));

    expect(ids.size).toBe(100);
  });

  it('sorts lexicographically into the order the ids were created', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const inCreationOrder = Array.from({ length: 5 }, () => {
      const id = newId();
      vi.advanceTimersByTime(3);

      return id;
    });

    expect([...inCreationOrder].reverse().sort()).toEqual(inCreationOrder);
  });

  it('stays ordered for ids minted within the same millisecond', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const inCreationOrder = Array.from({ length: 5 }, () => newId());

    expect([...inCreationOrder].reverse().sort()).toEqual(inCreationOrder);
  });
});

describe('isUuidV7', () => {
  it('rejects a v4 uuid', () => {
    expect(isUuidV7(UUID_V4)).toBe(false);
  });

  it('rejects crypto.randomUUID(), which only ever produces v4', () => {
    expect(isUuidV7(randomUUID())).toBe(false);
  });

  it('rejects the nil uuid and anything that is not a uuid at all', () => {
    expect(isUuidV7(NIL_UUID)).toBe(false);
    expect(isUuidV7('')).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('zzzzzzzz-zzzz-7zzz-zzzz-zzzzzzzzzzzz')).toBe(false);
  });

  it('accepts what newId produces', () => {
    expect(isUuidV7(newId())).toBe(true);
  });
});
