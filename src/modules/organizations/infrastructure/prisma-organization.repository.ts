import { Injectable } from '@nestjs/common';

import { type Prisma, PrismaService, type SubscriptionStatus } from '#platform/prisma';
import { newId } from '#shared/util';

import {
  Organization,
  type OrganizationMembership,
  type OrganizationRole,
} from '../domain/organization';
import type {
  MembershipChangeOutcome,
  OrganizationMemberDetail,
  OrganizationRepository,
} from '../domain/organization.repository';

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.currentTransaction ?? this.prisma.db;
  }

  async createWithOwner(organization: Organization, ownerId: string): Promise<void> {
    const current = this.prisma.currentTransaction;

    // Joining a transaction that is already open, rather than demanding a second
    // one. PrismaService throws on a nested transaction, so a caller that later
    // wraps this in a unit of work would fail at runtime, not at compile time.
    if (current !== null) {
      await createOrganizationWithOwner(current, organization, ownerId);

      return;
    }

    await this.prisma.transaction((tx) => createOrganizationWithOwner(tx, organization, ownerId));
  }

  async findById(id: string): Promise<Organization | null> {
    const row = await this.client.organization.findFirst({ where: { id, archivedAt: null } });

    return row === null ? null : Organization.rehydrate(row);
  }

  async findByIdIncludingArchived(id: string): Promise<Organization | null> {
    const row = await this.client.organization.findUnique({ where: { id } });

    return row === null ? null : Organization.rehydrate(row);
  }

  async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembership | null> {
    const row = await this.client.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
        organization: { archivedAt: null },
      },
    });

    return row === null ? null : { ...row, role: row.role };
  }

  async findMembershipIncludingArchived(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembership | null> {
    const row = await this.client.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });

    return row === null ? null : { ...row, role: row.role };
  }

  async listMembershipsWithOrganization(
    userId: string,
  ): Promise<readonly { membership: OrganizationMembership; organization: Organization }[]> {
    const rows = await this.client.organizationMember.findMany({
      where: { userId, organization: { archivedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: { organization: true },
    });

    return rows.map((row) => ({
      membership: {
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt,
      },
      organization: Organization.rehydrate(row.organization),
    }));
  }

  async addMember(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<boolean> {
    const result = await this.client.organizationMember.createMany({
      data: [{ id: newId(), ...input }],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  async listMembers(organizationId: string): Promise<readonly OrganizationMemberDetail[]> {
    const rows = await this.client.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true, name: true } } },
    });

    return rows.map((row) => ({
      userId: row.userId,
      email: row.user.email,
      name: row.user.name,
      role: row.role,
      joinedAt: row.createdAt,
    }));
  }

  async findMemberByEmail(
    organizationId: string,
    email: string,
  ): Promise<OrganizationMembership | null> {
    const row = await this.client.organizationMember.findFirst({
      where: { organizationId, user: { email } },
    });

    return row === null ? null : { ...row, role: row.role };
  }

  async changeMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<MembershipChangeOutcome> {
    return this.withinTransaction((tx) =>
      mutateMembership(tx, input.organizationId, input.userId, async (current) => {
        if (current.role === input.role) return 'changed';
        if (current.role === 'owner' && (await isLastOwner(tx, input.organizationId, input.userId)))
          return 'would-orphan-organization';

        await tx.organizationMember.update({
          where: {
            organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
          },
          data: { role: input.role },
        });

        return 'changed';
      }),
    );
  }

  async removeMember(organizationId: string, userId: string): Promise<MembershipChangeOutcome> {
    return this.withinTransaction((tx) =>
      mutateMembership(tx, organizationId, userId, async (current) => {
        if (current.role === 'owner' && (await isLastOwner(tx, organizationId, userId))) {
          return 'would-orphan-organization';
        }

        await tx.organizationMember.deleteMany({ where: { organizationId, userId } });

        return 'changed';
      }),
    );
  }

  private async withinTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const current = this.prisma.currentTransaction;

    return current === null ? this.prisma.transaction(fn) : fn(current);
  }

  async setArchivedAt(id: string, archivedAt: Date | null): Promise<boolean> {
    const result = await this.client.organization.updateMany({
      where: {
        id,
        archivedAt: archivedAt === null ? { not: null } : null,
      },
      data: { archivedAt },
    });

    return result.count === 1;
  }

  async purge(id: string): Promise<boolean> {
    const transaction = this.prisma.currentTransaction;
    if (transaction !== null) {
      return this.purgeWithClient(transaction, id);
    }

    return this.prisma.transaction((tx) => this.purgeWithClient(tx, id));
  }

  private async purgeWithClient(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const locked = await tx.$queryRaw<readonly { id: string; archivedAt: Date | null }[]>`
        SELECT id, archived_at AS "archivedAt"
          FROM tenancy.organization
         WHERE id = ${id}::uuid
         FOR UPDATE
      `;

    if (locked.length === 0 || locked[0]?.archivedAt === null) return false;

    // Only a live subscription blocks a purge. A cancelled row is history, and
    // because organization_id is unique on that table it never goes away by
    // itself — counting every status would mean any organization that ever paid
    // could never be erased, which is both the stated policy's opposite and a
    // dead end for a deletion request.
    const [liveSubscriptionCount, fileCount] = await Promise.all([
      tx.subscription.count({
        where: { organizationId: id, status: { in: LIVE_SUBSCRIPTION_STATUSES } },
      }),
      tx.storedFile.count({ where: { organizationId: id } }),
    ]);

    if (liveSubscriptionCount > 0 || fileCount > 0) return false;

    await tx.subscription.deleteMany({ where: { organizationId: id } });
    await tx.organizationInvitation.deleteMany({ where: { organizationId: id } });
    await tx.organizationMember.deleteMany({ where: { organizationId: id } });
    const result = await tx.organization.deleteMany({ where: { id, archivedAt: { not: null } } });

    return result.count === 1;
  }
}

/** Statuses that still represent a paying or trialling relationship. */
const LIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'paused',
];

/**
 * Locks the membership row, hands it to the caller's decision, and returns the
 * outcome. The lock is what makes the last-owner check trustworthy: two
 * concurrent demotions would otherwise each see a second owner and both commit.
 */
async function mutateMembership(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  decide: (current: { role: OrganizationRole }) => Promise<MembershipChangeOutcome>,
): Promise<MembershipChangeOutcome> {
  const locked = await tx.$queryRaw<readonly { role: OrganizationRole }[]>`
      SELECT role
        FROM tenancy.organization_member
       WHERE organization_id = ${organizationId}::uuid
         AND user_id = ${userId}::uuid
       FOR UPDATE
    `;
  const current = locked[0];

  if (current === undefined) return 'not-a-member';

  return decide(current);
}

async function isLastOwner(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const others = await tx.organizationMember.count({
    where: { organizationId, role: 'owner', userId: { not: userId } },
  });

  return others === 0;
}

async function createOrganizationWithOwner(
  tx: Prisma.TransactionClient,
  organization: Organization,
  ownerId: string,
): Promise<void> {
  await tx.organization.create({
    data: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      createdAt: organization.createdAt,
    },
  });
  await tx.organizationMember.create({
    data: {
      id: newId(),
      organizationId: organization.id,
      userId: ownerId,
      role: 'owner',
    },
  });
}
