import { ApiProperty } from '@nestjs/swagger';

import type { UserProfileView } from '../../application/dto/user-profile.dto';

export class UserProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  avatarFileId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static from(view: UserProfileView): UserProfileResponseDto {
    const dto = new UserProfileResponseDto();
    dto.id = view.id;
    dto.userId = view.userId;
    dto.email = view.email;
    dto.emailVerified = view.emailVerified;
    dto.role = view.role;
    dto.displayName = view.displayName;
    dto.avatarFileId = view.avatarFileId;
    dto.createdAt = view.createdAt;
    dto.updatedAt = view.updatedAt;

    return dto;
  }
}

export class UserProfileListResponseDto {
  @ApiProperty({ enum: ['list'] })
  object!: 'list';

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: [UserProfileResponseDto] })
  data!: UserProfileResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ type: String, nullable: true })
  lastCursor!: string | null;
}
