import { describe, expect, it } from 'vitest';

import { REDACTED, sanitiseUrl } from './sanitise-url';

const TOKEN = 'a-token-worth-an-account';

describe('sanitiseUrl', () => {
  it('leaves a URL without a credential exactly as it was', () => {
    expect(sanitiseUrl('/api/v1/users/me')).toBe('/api/v1/users/me');
    expect(sanitiseUrl('/api/v1/uploads?limit=20&cursor=abc')).toBe(
      '/api/v1/uploads?limit=20&cursor=abc',
    );
  });

  it('redacts the value but keeps the key, so the shape stays debuggable', () => {
    expect(sanitiseUrl(`/api/auth/verify-email?token=${TOKEN}`)).toBe(
      `/api/auth/verify-email?token=${REDACTED}`,
    );
  });

  it('keeps the harmless parameters around a redacted one', () => {
    expect(sanitiseUrl(`/x?a=1&token=${TOKEN}&b=2`)).toBe(`/x?a=1&token=${REDACTED}&b=2`);
  });

  it('matches the key case-insensitively', () => {
    expect(sanitiseUrl(`/x?TOKEN=${TOKEN}`)).toBe(`/x?TOKEN=${REDACTED}`);
  });

  it('redacts a credential Better Auth puts in the path', () => {
    expect(sanitiseUrl(`/api/auth/reset-password/${TOKEN}`)).toBe(
      `/api/auth/reset-password/${REDACTED}`,
    );
  });

  it('redacts a presigned S3 signature', () => {
    const signed = sanitiseUrl('/bucket/key?X-Amz-Signature=deadbeef&X-Amz-Expires=900');

    expect(signed).not.toContain('deadbeef');
    expect(signed).toContain('X-Amz-Expires=900');
  });

  it('leaves a valueless flag alone instead of inventing one', () => {
    expect(sanitiseUrl('/x?token')).toBe('/x?token');
  });

  it('handles an empty query without producing a stray separator', () => {
    expect(sanitiseUrl('/x?')).toBe('/x?');
  });
});
