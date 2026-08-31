import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { type AuthenticatedSession, CurrentUser } from '#platform/auth';
import { requireTenant, TenantRequired, TenantRoles } from '#platform/tenant-context';
import { ApiCommonErrors, ApiTenantHeader } from '#shared/http';

import { AcceptInvitationUseCase } from '../application/accept-invitation.use-case';
import { InviteMemberUseCase } from '../application/invite-member.use-case';
import {
  ChangeMemberRoleUseCase,
  ListMembersUseCase,
  RemoveMemberUseCase,
  RevokeInvitationUseCase,
} from '../application/manage-members.use-case';
import {
  AcceptedInvitationResponseDto,
  AcceptInvitationRequestDto,
  ChangeMemberRoleRequestDto,
  InvitationResponseDto,
  InviteMemberRequestDto,
  MemberListResponseDto,
} from './dto/member.dto';

@ApiTags('organization members')
@ApiCommonErrors({ validation: true, forbidden: true, notFound: true, conflict: true })
@Controller('organizations/members')
@TenantRequired()
@ApiTenantHeader()
export class MembersController {
  constructor(
    private readonly listMembers: ListMembersUseCase,
    private readonly inviteMember: InviteMemberUseCase,
    private readonly changeRole: ChangeMemberRoleUseCase,
    private readonly removeMember: RemoveMemberUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
  ) {}

  @Get()
  @TenantRoles('owner', 'admin', 'member', 'viewer')
  @ApiOperation({ summary: 'Members of the selected organization, and its open invitations.' })
  @ApiOkResponse({ type: MemberListResponseDto })
  async list(): Promise<MemberListResponseDto> {
    const page = await this.listMembers.execute(requireTenant().organizationId);

    return {
      members: [...page.members],
      pendingInvitations: [...page.pendingInvitations],
    };
  }

  @Post('invitations')
  @TenantRoles('owner', 'admin')
  @ApiOperation({ summary: 'Invite an address to join, by email, with a role.' })
  @ApiCreatedResponse({ type: InvitationResponseDto })
  async invite(@Body() body: InviteMemberRequestDto): Promise<InvitationResponseDto> {
    const view = await this.inviteMember.execute({
      organizationId: requireTenant().organizationId,
      email: body.email,
      role: body.role,
    });

    return { ...view };
  }

  @Delete('invitations/:invitationId')
  @TenantRoles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw an invitation that has not been accepted.' })
  @ApiNoContentResponse({ description: 'The invitation was withdrawn.' })
  async revoke(
    @Param('invitationId', new ParseUUIDPipe({ version: '7' })) invitationId: string,
  ): Promise<void> {
    await this.revokeInvitation.execute({
      organizationId: requireTenant().organizationId,
      invitationId,
    });
  }

  @Patch(':userId')
  @TenantRoles('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change a member's role. Only an owner may hand out ownership." })
  @ApiNoContentResponse({ description: 'The role was changed.' })
  async setRole(
    @Param('userId', new ParseUUIDPipe({ version: '7' })) userId: string,
    @Body() body: ChangeMemberRoleRequestDto,
  ): Promise<void> {
    await this.changeRole.execute({
      organizationId: requireTenant().organizationId,
      userId,
      role: body.role,
    });
  }

  @Delete(':userId')
  @TenantRoles('owner', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from the organization.' })
  @ApiNoContentResponse({ description: 'The member was removed.' })
  async remove(
    @Param('userId', new ParseUUIDPipe({ version: '7' })) userId: string,
  ): Promise<void> {
    await this.removeMember.execute({
      organizationId: requireTenant().organizationId,
      userId,
    });
  }
}

/**
 * Redeeming an invitation is deliberately not tenant-scoped: the caller is not a
 * member yet, so there is no organization header to validate them against. The
 * token and the session's own address are what authorize it.
 */
@ApiTags('organization members')
@ApiCommonErrors({ validation: true, forbidden: true, notFound: true })
@Controller('organizations/invitations')
export class InvitationRedemptionController {
  constructor(private readonly acceptInvitation: AcceptInvitationUseCase) {}

  @Post('accept')
  @ApiOperation({ summary: 'Join an organization using an invitation token.' })
  @ApiOkResponse({ type: AcceptedInvitationResponseDto })
  async accept(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Body() body: AcceptInvitationRequestDto,
  ): Promise<AcceptedInvitationResponseDto> {
    const session = requireCaller(caller);
    const accepted = await this.acceptInvitation.execute({
      token: body.token,
      userId: session.userId,
      userEmail: session.email,
    });

    return { organizationId: accepted.organizationId, role: accepted.role };
  }
}

function requireCaller(caller: AuthenticatedSession | undefined): AuthenticatedSession {
  if (caller === undefined) throw new UnauthorizedException();

  return caller;
}
