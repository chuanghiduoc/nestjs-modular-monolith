import { describe, expect, it } from 'vitest';

import { detectMimeTypes } from './file-signature';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const UNRECOGNISED = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

describe('detectMimeTypes', () => {
  it('reads the type from the magic bytes', () => {
    expect(detectMimeTypes(PNG)).toContain('image/png');
    expect(detectMimeTypes(JPEG)).toContain('image/jpeg');
    expect(detectMimeTypes(PDF)).toContain('application/pdf');
  });

  it('returns every candidate, because one signature can mean more than one type', () => {
    expect(detectMimeTypes(PNG).length).toBeGreaterThan(1);
  });

  /**
   * The upload adapter stores the first candidate and the aggregate checks that
   * one against its allow-list. If a shared signature ever started reporting the
   * accepted type second, every such upload would be refused — so the order is
   * part of the contract, not an implementation detail.
   */
  it('puts the type the bytes primarily are first', () => {
    expect(detectMimeTypes(PNG)[0]).toBe('image/png');
    expect(detectMimeTypes(JPEG)[0]).toBe('image/jpeg');
    expect(detectMimeTypes(PDF)[0]).toBe('application/pdf');
  });

  it('returns nothing for bytes it cannot place', () => {
    expect(detectMimeTypes(UNRECOGNISED)).toEqual([]);
  });

  it('returns nothing for an empty sample — "unknown" is not "safe"', () => {
    expect(detectMimeTypes(Uint8Array.from([]))).toEqual([]);
  });
});
