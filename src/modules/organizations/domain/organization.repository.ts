import type { Organization, OrganizationMembership, OrganizationRole } from './organization';

export interface OrganizationMemberDetail {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly joinedAt: Date;
}

export type MembershipChangeOutcome = 'changed' | 'not-a-member' | 'would-orphan-organization';

export interface OrganizationRepository {
  createWithOwner(organization: Organization, ownerId: string): Promise<void>;
  findById(id: string): Promise<Organization | null>;
  findByIdIncludingArchived(id: string): Promise<Organization | null>;
  findMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null>;
  findMembershipIncludingArchived(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembership | null>;
  /**
   * Memberships joined to their organization in one query. Reading the
   * memberships and then fetching each organization separately is an unbounded
   * fan-out: a user in N organizations issues N concurrent queries and can
   * exhaust the connection pool on its own.
   */
  listMembershipsWithOrganization(
    userId: string,
  ): Promise<readonly { membership: OrganizationMembership; organization: Organization }[]>;
  addMember(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<boolean>;

  listMembers(organizationId: string): Promise<readonly OrganizationMemberDetail[]>;

  findMemberByEmail(organizationId: string, email: string): Promise<OrganizationMembership | null>;

  /**
   * Applies a role change under the "an organization always has an owner"
   * invariant, in one transaction that locks the membership rows it counts.
   * Returns why it refused, so the caller can answer 404 and 409 differently.
   */
  changeMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<MembershipChangeOutcome>;

  removeMember(organizationId: string, userId: string): Promise<MembershipChangeOutcome>;
  setArchivedAt(id: string, archivedAt: Date | null): Promise<boolean>;
  purge(id: string): Promise<boolean>;
}

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
