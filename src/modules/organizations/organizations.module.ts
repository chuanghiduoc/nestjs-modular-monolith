import { Module } from '@nestjs/common';

import { AcceptInvitationUseCase } from './application/accept-invitation.use-case';
import { ChangeOrganizationLifecycleUseCase } from './application/change-organization-lifecycle.use-case';
import { CreateOrganizationUseCase } from './application/create-organization.use-case';
import { InviteMemberUseCase } from './application/invite-member.use-case';
import { ListMyOrganizationsUseCase } from './application/list-my-organizations.use-case';
import {
  ChangeMemberRoleUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
} from './application/manage-members.use-case';
import { INVITATION_REPOSITORY } from './domain/invitation.repository';
import { INVITATION_NOTIFIER } from './domain/invitation-notifier.port';
import { ORGANIZATION_REPOSITORY } from './domain/organization.repository';
import { InvitationRedemptionController, MembersController } from './http/members.controller';
import { OrganizationsController } from './http/organizations.controller';
import { TenantContextGuard } from './http/tenant-context.guard';
import { PrismaInvitationRepository } from './infrastructure/prisma-invitation.repository';
import { PrismaOrganizationRepository } from './infrastructure/prisma-organization.repository';
import { QueueInvitationNotifier } from './infrastructure/queue-invitation-notifier.adapter';

@Module({
  controllers: [OrganizationsController, MembersController, InvitationRedemptionController],
  providers: [
    CreateOrganizationUseCase,
    ChangeOrganizationLifecycleUseCase,
    ListMyOrganizationsUseCase,
    InviteMemberUseCase,
    AcceptInvitationUseCase,
    ListMembersUseCase,
    ChangeMemberRoleUseCase,
    RemoveMemberUseCase,
    RevokeInvitationUseCase,
    { provide: ORGANIZATION_REPOSITORY, useClass: PrismaOrganizationRepository },
    { provide: INVITATION_REPOSITORY, useClass: PrismaInvitationRepository },
    { provide: INVITATION_NOTIFIER, useClass: QueueInvitationNotifier },
    TenantContextGuard,
  ],
  exports: [ORGANIZATION_REPOSITORY, TenantContextGuard],
})
export class OrganizationsModule {}
