import { describe, expect, it } from 'vitest';

import { isDomainException } from '#shared/errors';

import { hashInvitationToken, OrganizationInvitation } from './organization-invitation';

const ORGANIZATION_ID = '01a00000-0000-7000-8000-000000000001';

function issue(overrides: { email?: string; ttlDays?: number; now?: Date } = {}) {
  return OrganizationInvitation.issue({
    organizationId: ORGANIZATION_ID,
    email: overrides.email ?? 'Invitee@Example.com',
    role: 'member',
    ...(overrides.ttlDays === undefined ? {} : { ttlDays: overrides.ttlDays }),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  });
}

describe('OrganizationInvitation', () => {
  it('stores the digest of the token and never the token itself', () => {
    const { invitation, token } = issue();

    expect(invitation.tokenHash).toBe(hashInvitationToken(token));
    expect(JSON.stringify(invitation)).not.toContain(token);
  });

  it('normalises the address it was issued to', () => {
    const { invitation } = issue({ email: '  Invitee@Example.COM ' });

    expect(invitation.email).toBe('invitee@example.com');
  });

  it('refuses an address it could never reach', () => {
    expect(() => issue({ email: 'not-an-address' })).toThrowError(
      expect.objectContaining({ code: 'invitation_invalid' }),
    );
  });

  it('refuses to hand out ownership, which is transferred rather than invited', () => {
    try {
      OrganizationInvitation.issue({
        organizationId: ORGANIZATION_ID,
        email: 'invitee@example.com',
        role: 'owner',
      });
      expect.unreachable('issuing an owner invitation should throw');
    } catch (error) {
      expect(isDomainException(error) && error.code).toBe('invitation_invalid');
    }
  });

  it('is redeemable until it expires, and never after it is accepted', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { invitation } = issue({ now, ttlDays: 1 });

    expect(invitation.isRedeemableAt(new Date('2026-01-01T12:00:00.000Z'))).toBe(true);
    expect(invitation.isRedeemableAt(new Date('2026-01-02T00:00:01.000Z'))).toBe(false);

    const accepted = OrganizationInvitation.rehydrate({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      tokenHash: invitation.tokenHash,
      expiresAt: invitation.expiresAt,
      acceptedAt: new Date('2026-01-01T01:00:00.000Z'),
      createdAt: invitation.createdAt,
    });

    expect(accepted.isRedeemableAt(new Date('2026-01-01T12:00:00.000Z'))).toBe(false);
  });

  it('only recognises the address it was addressed to', () => {
    const { invitation } = issue({ email: 'invitee@example.com' });

    expect(invitation.matchesRecipient('  INVITEE@example.com ')).toBe(true);
    expect(invitation.matchesRecipient('someone-else@example.com')).toBe(false);
    // Different length: the comparison must reject rather than throw.
    expect(invitation.matchesRecipient('a@b.co')).toBe(false);
  });

  it('issues a different token every time', () => {
    expect(issue().token).not.toBe(issue().token);
  });
});
