import type { OrganizationInvitation } from './organization-invitation';

export interface InvitationRepository {
  save(invitation: OrganizationInvitation): Promise<void>;

  findPendingByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null>;

  /**
   * Marks one invitation accepted, but only if it is still pending. The return
   * value is the race outcome: two redemptions of the same token settle with one
   * winner rather than two memberships.
   */
  markAccepted(id: string, acceptedAt: Date): Promise<boolean>;

  listPending(organizationId: string, now: Date): Promise<readonly OrganizationInvitation[]>;

  revoke(organizationId: string, invitationId: string): Promise<boolean>;
}

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');
