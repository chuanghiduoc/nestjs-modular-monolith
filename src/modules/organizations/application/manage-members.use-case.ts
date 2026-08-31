import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { INVITATION_REPOSITORY, type InvitationRepository } from '../domain/invitation.repository';
import type { OrganizationRole } from '../domain/organization';
import {
  type MembershipChangeOutcome,
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';
import type { InvitationView, MemberView } from './member.dto';

@Injectable()
export class ListMembersUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
  ) {}

  async execute(organizationId: string): Promise<{
    readonly members: readonly MemberView[];
    readonly pendingInvitations: readonly InvitationView[];
  }> {
    const now = new Date();
    const [members, invitations] = await Promise.all([
      this.organizations.listMembers(organizationId),
      this.invitations.listPending(organizationId, now),
    ]);

    return {
      members: members.map((member) => ({
        userId: member.userId,
        email: member.email,
        name: member.name,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      })),
      pendingInvitations: invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      })),
    };
  }
}

@Injectable()
export class ChangeMemberRoleUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async execute(input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly role: OrganizationRole;
  }): Promise<void> {
    settle(await this.organizations.changeMemberRole(input));
  }
}

@Injectable()
export class RemoveMemberUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async execute(input: {
    readonly organizationId: string;
    readonly userId: string;
  }): Promise<void> {
    settle(await this.organizations.removeMember(input.organizationId, input.userId));
  }
}

@Injectable()
export class RevokeInvitationUseCase {
  constructor(@Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository) {}

  async execute(input: {
    readonly organizationId: string;
    readonly invitationId: string;
  }): Promise<void> {
    const revoked = await this.invitations.revoke(input.organizationId, input.invitationId);

    if (!revoked) {
      throw DomainErrors.notFound(
        ERROR_CODES.INVITATION_NOT_FOUND,
        'That invitation is no longer pending.',
      );
    }
  }
}

function settle(outcome: MembershipChangeOutcome): void {
  switch (outcome) {
    case 'changed':
      return;
    case 'not-a-member':
      throw DomainErrors.notFound(
        ERROR_CODES.MEMBER_NOT_FOUND,
        'That person is not a member of this organization.',
      );
    case 'would-orphan-organization':
      throw DomainErrors.conflict(
        ERROR_CODES.LAST_OWNER,
        'Promote another member to owner before giving up the last ownership.',
        true,
      );
  }
}
