import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { INVITATION_REPOSITORY, type InvitationRepository } from '../domain/invitation.repository';
import {
  INVITATION_NOTIFIER,
  type InvitationNotifierPort,
} from '../domain/invitation-notifier.port';
import type { OrganizationRole } from '../domain/organization';
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';
import { OrganizationInvitation } from '../domain/organization-invitation';
import type { InvitationView } from './member.dto';

export interface InviteMemberInput {
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
}

@Injectable()
export class InviteMemberUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(INVITATION_NOTIFIER) private readonly notifier: InvitationNotifierPort,
  ) {}

  async execute(input: InviteMemberInput): Promise<InvitationView> {
    const organization = await this.organizations.findById(input.organizationId);

    if (organization === null) {
      throw DomainErrors.notFound(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organization not found.');
    }

    const alreadyAMember = await this.organizations.findMemberByEmail(
      input.organizationId,
      input.email.trim().toLowerCase(),
    );

    if (alreadyAMember !== null) {
      throw DomainErrors.conflict(
        ERROR_CODES.CONFLICT,
        'That person is already a member of this organization.',
        true,
      );
    }

    const { invitation, token } = OrganizationInvitation.issue({
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
    });

    await this.invitations.save(invitation);

    // Sending after the row is committed: a delivery that fails leaves a usable
    // invitation the operator can resend, whereas a send before the write could
    // deliver a link to a token that does not exist.
    await this.notifier.sendInvitation({
      email: invitation.email,
      organizationId: organization.id,
      organizationName: organization.name,
      token,
      expiresAt: invitation.expiresAt,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }
}
