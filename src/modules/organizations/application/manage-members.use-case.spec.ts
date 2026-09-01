import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import {
  InMemoryInvitationRepository,
  InMemoryOrganizationRepository,
} from '../../../../test/support/in-memory';
import { Organization } from '../domain/organization';
import { OrganizationInvitation } from '../domain/organization-invitation';
import {
  ChangeMemberRoleUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
} from './manage-members.use-case';

const OWNER_ID = newId();
const MEMBER_ID = newId();

function harness() {
  const organizations = new InMemoryOrganizationRepository();
  const invitations = new InMemoryInvitationRepository();
  const organization = Organization.rehydrate({
    id: newId(),
    slug: 'acme',
    name: 'Acme',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
  });
  organizations.seedOrganization(organization);
  organizations.seedMember({
    organizationId: organization.id,
    userId: OWNER_ID,
    email: 'owner@example.com',
    role: 'owner',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  organizations.seedMember({
    organizationId: organization.id,
    userId: MEMBER_ID,
    email: 'member@example.com',
    role: 'member',
    joinedAt: new Date('2026-02-01T00:00:00.000Z'),
  });

  return { organizations, invitations, organization };
}

describe('ListMembersUseCase', () => {
  it('returns members in join order beside only the still-pending invitations', async () => {
    const target = harness();
    const pending = OrganizationInvitation.issue({
      organizationId: target.organization.id,
      email: 'pending@example.com',
      role: 'member',
    });
    const expired = OrganizationInvitation.issue({
      organizationId: target.organization.id,
      email: 'expired@example.com',
      role: 'member',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlDays: 1,
    });
    const accepted = OrganizationInvitation.issue({
      organizationId: target.organization.id,
      email: 'accepted@example.com',
      role: 'member',
    });
    target.invitations.seed(pending.invitation);
    target.invitations.seed(expired.invitation);
    target.invitations.seed(accepted.invitation);
    await target.invitations.markAccepted(accepted.invitation.id, new Date());

    const result = await new ListMembersUseCase(target.organizations, target.invitations).execute(
      target.organization.id,
    );

    expect(result.members.map((member) => member.email)).toEqual([
      'owner@example.com',
      'member@example.com',
    ]);
    expect(result.pendingInvitations).toHaveLength(1);
    expect(result.pendingInvitations[0]).toMatchObject({ email: 'pending@example.com' });
    expect(result.members[0]?.joinedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('ChangeMemberRoleUseCase', () => {
  it('applies a role change to an existing member', async () => {
    const target = harness();

    await new ChangeMemberRoleUseCase(target.organizations).execute({
      organizationId: target.organization.id,
      userId: MEMBER_ID,
      role: 'admin',
    });

    expect(target.organizations.membershipOf(target.organization.id, MEMBER_ID)).toMatchObject({
      role: 'admin',
    });
  });

  it('answers a non-member with not-found', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      new ChangeMemberRoleUseCase(target.organizations).execute({
        organizationId: target.organization.id,
        userId: newId(),
        role: 'admin',
      }),
    );

    expect(error.code).toBe(ERROR_CODES.MEMBER_NOT_FOUND);
  });

  it('refuses to demote the last owner', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      new ChangeMemberRoleUseCase(target.organizations).execute({
        organizationId: target.organization.id,
        userId: OWNER_ID,
        role: 'member',
      }),
    );

    expect(error.code).toBe(ERROR_CODES.LAST_OWNER);
    expect(target.organizations.membershipOf(target.organization.id, OWNER_ID)).toMatchObject({
      role: 'owner',
    });
  });

  it('allows demoting an owner while another owner remains', async () => {
    const target = harness();
    const secondOwner = newId();
    target.organizations.seedMember({
      organizationId: target.organization.id,
      userId: secondOwner,
      role: 'owner',
    });

    await new ChangeMemberRoleUseCase(target.organizations).execute({
      organizationId: target.organization.id,
      userId: OWNER_ID,
      role: 'member',
    });

    expect(target.organizations.membershipOf(target.organization.id, OWNER_ID)).toMatchObject({
      role: 'member',
    });
  });
});

describe('RemoveMemberUseCase', () => {
  it('removes an existing member', async () => {
    const target = harness();

    await new RemoveMemberUseCase(target.organizations).execute({
      organizationId: target.organization.id,
      userId: MEMBER_ID,
    });

    expect(target.organizations.membershipOf(target.organization.id, MEMBER_ID)).toBeNull();
  });

  it('answers a non-member with not-found', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      new RemoveMemberUseCase(target.organizations).execute({
        organizationId: target.organization.id,
        userId: newId(),
      }),
    );

    expect(error.code).toBe(ERROR_CODES.MEMBER_NOT_FOUND);
  });

  it('refuses to remove the last owner', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      new RemoveMemberUseCase(target.organizations).execute({
        organizationId: target.organization.id,
        userId: OWNER_ID,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.LAST_OWNER);
    expect(target.organizations.membershipOf(target.organization.id, OWNER_ID)).not.toBeNull();
  });
});

describe('RevokeInvitationUseCase', () => {
  it('revokes a pending invitation', async () => {
    const target = harness();
    const { invitation } = OrganizationInvitation.issue({
      organizationId: target.organization.id,
      email: 'pending@example.com',
      role: 'member',
    });
    target.invitations.seed(invitation);

    await new RevokeInvitationUseCase(target.invitations).execute({
      organizationId: target.organization.id,
      invitationId: invitation.id,
    });

    expect(target.invitations.rowOf(invitation.id)).toBeNull();
  });

  it('answers an already-redeemed invitation with not-found', async () => {
    const target = harness();
    const { invitation } = OrganizationInvitation.issue({
      organizationId: target.organization.id,
      email: 'accepted@example.com',
      role: 'member',
    });
    target.invitations.seed(invitation);
    await target.invitations.markAccepted(invitation.id, new Date());

    const error = await captureDomainError(() =>
      new RevokeInvitationUseCase(target.invitations).execute({
        organizationId: target.organization.id,
        invitationId: invitation.id,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_NOT_FOUND);
  });

  it("refuses to revoke through another organization's id", async () => {
    const target = harness();
    const { invitation } = OrganizationInvitation.issue({
      organizationId: target.organization.id,
      email: 'pending@example.com',
      role: 'member',
    });
    target.invitations.seed(invitation);

    const error = await captureDomainError(() =>
      new RevokeInvitationUseCase(target.invitations).execute({
        organizationId: newId(),
        invitationId: invitation.id,
      }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_NOT_FOUND);
    expect(target.invitations.rowOf(invitation.id)).not.toBeNull();
  });
});
