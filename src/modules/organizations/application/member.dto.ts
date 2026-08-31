import type { OrganizationRole } from '../domain/organization';

export interface MemberView {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly joinedAt: string;
}

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly expiresAt: string;
  readonly createdAt: string;
}
