import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength } from 'class-validator';

import { ORGANIZATION_ROLES, type OrganizationRole } from '../../domain/organization';

/** Ownership moves by promoting an existing member, never by invitation. */
const INVITABLE_ROLES = ORGANIZATION_ROLES.filter((role) => role !== 'owner');

export class InviteMemberRequestDto {
  @ApiProperty({ format: 'email', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsString()
  @IsIn([...INVITABLE_ROLES])
  role!: Exclude<OrganizationRole, 'owner'>;
}

export class ChangeMemberRoleRequestDto {
  @ApiProperty({ enum: ORGANIZATION_ROLES })
  @IsString()
  @IsIn([...ORGANIZATION_ROLES])
  role!: OrganizationRole;
}

export class AcceptInvitationRequestDto {
  @ApiProperty({ description: 'The one-time token from the invitation email.' })
  @IsString()
  @MaxLength(256)
  token!: string;
}

export class MemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ORGANIZATION_ROLES })
  role!: OrganizationRole;

  @ApiProperty({ format: 'date-time' })
  joinedAt!: string;
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ORGANIZATION_ROLES })
  role!: OrganizationRole;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class MemberListResponseDto {
  @ApiProperty({ type: [MemberResponseDto] })
  members!: MemberResponseDto[];

  @ApiProperty({ type: [InvitationResponseDto] })
  pendingInvitations!: InvitationResponseDto[];
}

export class AcceptedInvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ enum: ORGANIZATION_ROLES })
  role!: string;
}
