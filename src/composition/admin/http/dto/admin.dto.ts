import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListUsersRequestDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  startingAfter?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminUserOverviewDto {
  @ApiProperty({ type: AdminUserSummaryDto })
  user!: AdminUserSummaryDto;

  @ApiProperty({ description: 'Total non-archived files owned by this user in this organization.' })
  fileCount!: number;

  @ApiProperty({ type: [String], description: 'Most recent file ids, newest first.' })
  recentFileIds!: string[];
}

export class AdminUserListResponseDto {
  @ApiProperty({ enum: ['list'] })
  object!: 'list';

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: [AdminUserSummaryDto] })
  data!: AdminUserSummaryDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ type: String, nullable: true })
  lastCursor!: string | null;
}
