import { describe, expect, it } from 'vitest';

import { isAddressAllowed, parseCidrAllowList } from './cidr-allowlist';

const LOOPBACK = parseCidrAllowList(['127.0.0.1/32', '::1/128']);

describe('parseCidrAllowList', () => {
  it('refuses a malformed entry rather than dropping it', () => {
    expect(() => parseCidrAllowList(['10.0.0.0/8', 'not-a-cidr'])).toThrow(/not a valid CIDR/);
  });

  it('refuses a prefix outside the family range', () => {
    expect(() => parseCidrAllowList(['10.0.0.0/33'])).toThrow(/not a valid CIDR/);
  });

  it('tolerates surrounding whitespace from a comma-separated variable', () => {
    expect(isAddressAllowed('10.1.2.3', parseCidrAllowList([' 10.0.0.0/8 ']))).toBe(true);
  });
});

describe('isAddressAllowed', () => {
  it('fails closed on an empty allow-list', () => {
    expect(isAddressAllowed('127.0.0.1', parseCidrAllowList([]))).toBe(false);
  });

  it('fails closed when the socket has no remote address', () => {
    expect(isAddressAllowed(undefined, LOOPBACK)).toBe(false);
  });

  it('fails closed on an unparsable remote address', () => {
    expect(isAddressAllowed('unix:/tmp/app.sock', LOOPBACK)).toBe(false);
  });

  it('matches an IPv4 address inside its prefix', () => {
    const allowList = parseCidrAllowList(['10.4.0.0/16']);

    expect(isAddressAllowed('10.4.7.9', allowList)).toBe(true);
    expect(isAddressAllowed('10.5.7.9', allowList)).toBe(false);
  });

  it('matches an IPv6 address inside its prefix', () => {
    const allowList = parseCidrAllowList(['2001:db8:abcd::/48']);

    expect(isAddressAllowed('2001:db8:abcd:1234::1', allowList)).toBe(true);
    expect(isAddressAllowed('2001:db8:abce::1', allowList)).toBe(false);
  });

  it('matches an IPv4-mapped IPv6 peer against the IPv4 entry a human wrote', () => {
    expect(isAddressAllowed('::ffff:127.0.0.1', LOOPBACK)).toBe(true);
    expect(isAddressAllowed('::ffff:10.0.0.1', LOOPBACK)).toBe(false);
  });

  it('ignores the zone id on a scoped address', () => {
    expect(isAddressAllowed('::1%lo0', LOOPBACK)).toBe(true);
  });

  it('treats /32 and /128 as single hosts', () => {
    expect(isAddressAllowed('127.0.0.1', LOOPBACK)).toBe(true);
    expect(isAddressAllowed('127.0.0.2', LOOPBACK)).toBe(false);
    expect(isAddressAllowed('::1', LOOPBACK)).toBe(true);
    expect(isAddressAllowed('::2', LOOPBACK)).toBe(false);
  });

  it('lets /0 match its own family and nothing else', () => {
    const everyV4 = parseCidrAllowList(['0.0.0.0/0']);

    expect(isAddressAllowed('203.0.113.9', everyV4)).toBe(true);
    expect(isAddressAllowed('2001:db8::1', everyV4)).toBe(false);
  });
});
