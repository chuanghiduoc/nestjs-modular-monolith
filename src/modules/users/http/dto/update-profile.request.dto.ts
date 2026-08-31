import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

import { DisplayName } from '../../domain/display-name.vo';

export class UpdateProfileRequestDto {
  @ApiPropertyOptional({ minLength: DisplayName.MIN_LENGTH, maxLength: DisplayName.MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Length(DisplayName.MIN_LENGTH, DisplayName.MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('7')
  avatarFileId?: string | null;
}
