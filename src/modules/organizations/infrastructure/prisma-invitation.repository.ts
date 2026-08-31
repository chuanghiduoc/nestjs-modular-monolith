import { Injectable } from '@nestjs/common';

import { PrismaService } from '#platform/prisma';

import type { InvitationRepository } from '../domain/invitation.repository';
import type { OrganizationRole } from '../domain/organization';
import { OrganizationInvitation } from '../domain/organization-invitation';

interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.currentTransaction ?? this.prisma.db;
  }

  async save(invitation: OrganizationInvitation): Promise<void> {
    await this.client.organizationInvitation.create({
      data: {
        id: invitation.id,
        organizationId: invitation.organizationId,
        email: invitation.email,
        role: invitation.role,
        tokenHash: invitation.tokenHash,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
    });
  }

  async findPendingByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null> {
    const row = await this.client.organizationInvitation.findUnique({ where: { tokenHash } });

    return row?.acceptedAt === null ? toAggregate(row) : null;
  }

  async markAccepted(id: string, acceptedAt: Date): Promise<boolean> {
    const result = await this.client.organizationInvitation.updateMany({
      where: { id, acceptedAt: null, expiresAt: { gt: acceptedAt } },
      data: { acceptedAt },
    });

    return result.count === 1;
  }

  async listPending(organizationId: string, now: Date): Promise<readonly OrganizationInvitation[]> {
    const rows = await this.client.organizationInvitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toAggregate);
  }

  async revoke(organizationId: string, invitationId: string): Promise<boolean> {
    const result = await this.client.organizationInvitation.deleteMany({
      where: { id: invitationId, organizationId, acceptedAt: null },
    });

    return result.count === 1;
  }
}

function toAggregate(row: InvitationRow): OrganizationInvitation {
  return OrganizationInvitation.rehydrate({
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  });
}
