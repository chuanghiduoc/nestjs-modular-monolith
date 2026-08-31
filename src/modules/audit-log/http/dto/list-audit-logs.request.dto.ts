import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { MAX_PAGE_SIZE } from '../../application/list-audit-entries.use-case';

export class ListAuditLogsRequestDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  startingAfter?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by the acting user.' })
  @IsOptional()
  @IsUUID('7')
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filter by resource kind, e.g. "users".' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  resource?: string;
}
