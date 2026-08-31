import { Inject, Injectable } from '@nestjs/common';

import { UNIT_OF_WORK, type UnitOfWorkPort } from '#contracts/ports';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { INVITATION_REPOSITORY, type InvitationRepository } from '../domain/invitation.repository';
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';
import { hashInvitationToken } from '../domain/organization-invitation';

export interface AcceptInvitationInput {
  readonly token: string;
  readonly userId: string;
  readonly userEmail: string;
}

export interface AcceptedInvitation {
  readonly organizationId: string;
  readonly role: string;
}

@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(input: AcceptInvitationInput): Promise<AcceptedInvitation> {
    const now = new Date();
    const invitation = await this.invitations.findPendingByTokenHash(
      hashInvitationToken(input.token),
    );

    // One answer for unknown, spent and expired alike: distinguishing them turns
    // this endpoint into an oracle for guessing tokens.
    if (!invitation?.isRedeemableAt(now)) {
      throw DomainErrors.notFound(
        ERROR_CODES.INVITATION_NOT_FOUND,
        'That invitation is no longer valid.',
      );
    }
    if (!invitation.matchesRecipient(input.userEmail)) {
      throw DomainErrors.forbidden(
        ERROR_CODES.INVITATION_NOT_FOUND,
        'That invitation was issued to a different address.',
      );
    }

    await this.uow.transaction(async () => {
      // Claim first. The conditional update is the race winner-picker: a second
      // redemption of the same token finds nothing left to claim and stops here
      // rather than adding the member twice.
      const claimed = await this.invitations.markAccepted(invitation.id, now);

      if (!claimed) {
        throw DomainErrors.notFound(
          ERROR_CODES.INVITATION_NOT_FOUND,
          'That invitation is no longer valid.',
        );
      }

      await this.organizations.addMember({
        organizationId: invitation.organizationId,
        userId: input.userId,
        role: invitation.role,
      });
    });

    return { organizationId: invitation.organizationId, role: invitation.role };
  }
}
