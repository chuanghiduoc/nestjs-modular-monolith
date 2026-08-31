import { describe, expect, it } from 'vitest';

import { ERROR_CODES, isDomainException } from '../errors';
import { newId } from '../util';
import { decodeCursor, decodeOptionalCursor, encodeCursor } from './cursor';

describe('cursor', () => {
  const id = newId();
  const sortValue = new Date('2026-08-16T10:12:33.356Z');

  it('round-trips a timestamp and an id', () => {
    const decoded = decodeCursor(encodeCursor(sortValue, id));

    expect(decoded.id).toBe(id);
    expect(decoded.sortValue.toISOString()).toBe(sortValue.toISOString());
  });

  it('splits on the LAST separator, because an ISO timestamp contains colons', () => {
    const raw = Buffer.from(`${sortValue.toISOString()}:${id}`, 'utf8').toString('base64url');

    expect(decodeCursor(raw).sortValue.getTime()).toBe(sortValue.getTime());
  });

  it('preserves millisecond precision', () => {
    const withMillis = new Date('2026-08-16T10:12:33.007Z');

    expect(decodeCursor(encodeCursor(withMillis, id)).sortValue.getTime()).toBe(
      withMillis.getTime(),
    );
  });

  it('rejects a cursor that is not base64url of two parts as malformed, not validation', () => {
    expect.assertions(3);
    try {
      decodeCursor('not-a-cursor');
    } catch (error) {
      expect(isDomainException(error)).toBe(true);
      if (isDomainException(error)) {
        expect(error.kind).toBe('malformed');
        expect(error.code).toBe(ERROR_CODES.CURSOR_MALFORMED);
      }
    }
  });

  it('rejects a non-v7 uuid — a v4 id makes the page order unstable', () => {
    const raw = Buffer.from(
      `${sortValue.toISOString()}:6f4a2c1e-9b3d-4c7a-8f21-0d5e6a7b8c9d`,
      'utf8',
    ).toString('base64url');

    expect(() => decodeCursor(raw)).toThrowError();
  });

  it('rejects a timestamp that is not a strict ISO string', () => {
    const raw = Buffer.from(`16/08/2026:${id}`, 'utf8').toString('base64url');

    expect(() => decodeCursor(raw)).toThrowError();
  });

  it('never leaks the rejected cursor value in the error detail', () => {
    try {
      decodeCursor('c2VjcmV0LWN1cnNvci12YWx1ZQ');
    } catch (error) {
      expect(isDomainException(error) && error.detail).not.toContain('secret');
    }
  });

  it('treats an absent cursor as the first page rather than an error', () => {
    expect(decodeOptionalCursor(undefined)).toBeNull();
    expect(decodeOptionalCursor(null)).toBeNull();
    expect(decodeOptionalCursor('')).toBeNull();
    expect(decodeOptionalCursor(encodeCursor(sortValue, id))?.id).toBe(id);
  });
});
