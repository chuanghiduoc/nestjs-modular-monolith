import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import type { PresignedUploadView, StoredFileView } from '../../application/dto/upload.dto';
import { ALLOWED_MIME_TYPES } from '../../domain/stored-file.entity';

export class PresignUploadRequestDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: ALLOWED_MIME_TYPES })
  @IsString()
  @IsIn([...ALLOWED_MIME_TYPES])
  mimeType!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class ConfirmUploadRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  fileId!: string;
}

export class ListUploadsRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  startingAfter?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PresignedUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: ['PUT'] })
  method!: 'PUT';

  @ApiProperty({
    type: Object,
    description: 'Replay these headers verbatim — they are part of the signature.',
  })
  headers!: Record<string, string>;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty()
  maxSizeBytes!: number;

  static from(view: PresignedUploadView): PresignedUploadResponseDto {
    const dto = new PresignedUploadResponseDto();
    dto.fileId = view.fileId;
    dto.url = view.url;
    dto.method = view.method;
    dto.headers = { ...view.headers };
    dto.expiresAt = view.expiresAt;
    dto.maxSizeBytes = view.maxSizeBytes;

    return dto;
  }
}

export class StoredFileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  static from(view: StoredFileView): StoredFileResponseDto {
    const dto = new StoredFileResponseDto();
    dto.id = view.id;
    dto.filename = view.filename;
    dto.mimeType = view.mimeType;
    dto.sizeBytes = view.sizeBytes;
    dto.status = view.status;
    dto.createdAt = view.createdAt;
    dto.confirmedAt = view.confirmedAt;

    return dto;
  }
}

export class StoredFileListResponseDto {
  @ApiProperty({ enum: ['list'] })
  object!: 'list';

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: [StoredFileResponseDto] })
  data!: StoredFileResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ type: String, nullable: true })
  lastCursor!: string | null;
}
