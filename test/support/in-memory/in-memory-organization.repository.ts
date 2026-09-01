import { newId } from '#shared/util';

import {
  Organization,
  type OrganizationMembership,
  type OrganizationRole,
} from '../../../src/modules/organizations/domain/organization';
import type {
  MembershipChangeOutcome,
  OrganizationMemberDetail,
  OrganizationRepository,
} from '../../../src/modules/organizations/domain/organization.repository';
import type { TransactionParticipant } from './in-memory-unit-of-work';
import { type JournalOptions, TestJournal } from './journal';

interface MemberRow {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly joinedAt: Date;
}

export interface SeedMemberInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly email?: string;
  readonly name?: string;
  readonly joinedAt?: Date;
}

export class InMemoryOrganizationRepository
  implements OrganizationRepository, TransactionParticipant
{
  readonly journal: TestJournal;

  private organizations = new Map<string, Organization>();
  private members = new Map<string, MemberRow>();

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  snapshot(): () => void {
    const capturedOrganizations = new Map(this.organizations);
    const capturedMembers = new Map(this.members);

    return () => {
      this.organizations = capturedOrganizations;
      this.members = capturedMembers;
    };
  }

  seedOrganization(organization: Organization): void {
    this.organizations.set(organization.id, organization);
  }

  seedMember(input: SeedMemberInput): void {
    this.members.set(memberKey(input.organizationId, input.userId), {
      id: newId(),
      organizationId: input.organizationId,
      userId: input.userId,
      email: input.email ?? `${input.userId}@example.local`,
      name: input.name ?? 'Member',
      role: input.role,
      joinedAt: input.joinedAt ?? new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  organizationOf(id: string): Organization | null {
    return this.organizations.get(id) ?? null;
  }

  membershipOf(organizationId: string, userId: string): OrganizationMembership | null {
    const row = this.members.get(memberKey(organizationId, userId));

    return row === undefined ? null : toMembership(row);
  }

  createWithOwner(organization: Organization, ownerId: string): Promise<void> {
    this.organizations.set(organization.id, organization);
    this.seedMember({
      organizationId: organization.id,
      userId: ownerId,
      role: 'owner',
      joinedAt: organization.createdAt,
    });
    this.journal.record('organizations', 'createWithOwner', organization.id);

    return Promise.resolve();
  }

  findById(id: string): Promise<Organization | null> {
    const organization = this.organizations.get(id);

    return Promise.resolve(organization?.archivedAt !== null ? null : organization);
  }

  findByIdIncludingArchived(id: string): Promise<Organization | null> {
    return Promise.resolve(this.organizations.get(id) ?? null);
  }

  findMembership(organizationId: string, userId: string): Promise<OrganizationMembership | null> {
    const organization = this.organizations.get(organizationId);

    if (organization?.archivedAt !== null) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.membershipOf(organizationId, userId));
  }

  findMembershipIncludingArchived(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembership | null> {
    return Promise.resolve(this.membershipOf(organizationId, userId));
  }

  listMembershipsWithOrganization(
    userId: string,
  ): Promise<readonly { membership: OrganizationMembership; organization: Organization }[]> {
    const rows = [...this.members.values()]
      .filter((row) => row.userId === userId)
      .flatMap((row) => {
        const organization = this.organizations.get(row.organizationId);

        return organization?.archivedAt !== null
          ? []
          : [{ membership: toMembership(row), organization }];
      });

    return Promise.resolve(rows);
  }

  addMember(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<boolean> {
    const key = memberKey(input.organizationId, input.userId);
    const inserted = !this.members.has(key);

    if (inserted) {
      this.seedMember(input);
    }
    this.journal.record('organizations', 'addMember', input.userId);

    return Promise.resolve(inserted);
  }

  listMembers(organizationId: string): Promise<readonly OrganizationMemberDetail[]> {
    const details = [...this.members.values()]
      .filter((row) => row.organizationId === organizationId)
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime())
      .map((row) => ({
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: row.role,
        joinedAt: row.joinedAt,
      }));

    return Promise.resolve(details);
  }

  findMemberByEmail(organizationId: string, email: string): Promise<OrganizationMembership | null> {
    const row = [...this.members.values()].find(
      (candidate) => candidate.organizationId === organizationId && candidate.email === email,
    );

    return Promise.resolve(row === undefined ? null : toMembership(row));
  }

  changeMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<MembershipChangeOutcome> {
    const key = memberKey(input.organizationId, input.userId);
    const row = this.members.get(key);

    if (row === undefined) {
      return Promise.resolve('not-a-member');
    }
    if (
      row.role === 'owner' &&
      input.role !== 'owner' &&
      this.ownerCount(input.organizationId) === 1
    ) {
      return Promise.resolve('would-orphan-organization');
    }

    this.members.set(key, { ...row, role: input.role });
    this.journal.record('organizations', 'changeMemberRole', input.userId);

    return Promise.resolve('changed');
  }

  removeMember(organizationId: string, userId: string): Promise<MembershipChangeOutcome> {
    const key = memberKey(organizationId, userId);
    const row = this.members.get(key);

    if (row === undefined) {
      return Promise.resolve('not-a-member');
    }
    if (row.role === 'owner' && this.ownerCount(organizationId) === 1) {
      return Promise.resolve('would-orphan-organization');
    }

    this.members.delete(key);
    this.journal.record('organizations', 'removeMember', userId);

    return Promise.resolve('changed');
  }

  setArchivedAt(id: string, archivedAt: Date | null): Promise<boolean> {
    const organization = this.organizations.get(id);

    if (organization === undefined) {
      return Promise.resolve(false);
    }

    this.organizations.set(
      id,
      Organization.rehydrate({
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        createdAt: organization.createdAt,
        archivedAt,
      }),
    );

    return Promise.resolve(true);
  }

  purge(id: string): Promise<boolean> {
    const existed = this.organizations.delete(id);

    for (const [key, row] of this.members) {
      if (row.organizationId === id) {
        this.members.delete(key);
      }
    }

    return Promise.resolve(existed);
  }

  private ownerCount(organizationId: string): number {
    return [...this.members.values()].filter(
      (row) => row.organizationId === organizationId && row.role === 'owner',
    ).length;
  }
}

function memberKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

function toMembership(row: MemberRow): OrganizationMembership {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    createdAt: row.joinedAt,
  };
}
