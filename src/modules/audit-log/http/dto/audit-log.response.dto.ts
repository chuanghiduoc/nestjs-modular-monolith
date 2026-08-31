import { ApiProperty } from '@nestjs/swagger';

import type { AuditEntryView } from '../../application/dto/audit-entry.dto';

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  organizationId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  resource!: string;

  @ApiProperty({ type: String, nullable: true })
  resourceId!: string | null;

  @ApiProperty({ type: Object })
  metadata!: Record<string, unknown>;

  static from(view: AuditEntryView): AuditLogResponseDto {
    const dto = new AuditLogResponseDto();
    dto.id = view.id;
    dto.occurredAt = view.occurredAt;
    dto.actorId = view.actorId;
    dto.organizationId = view.organizationId;
    dto.action = view.action;
    dto.resource = view.resource;
    dto.resourceId = view.resourceId;
    dto.metadata = view.metadata;

    return dto;
  }
}

export class AuditLogListResponseDto {
  @ApiProperty({ enum: ['list'] })
  object!: 'list';

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: [AuditLogResponseDto] })
  data!: AuditLogResponseDto[];

  @ApiProperty()
  hasMore!: boolean;

  @ApiProperty({ type: String, nullable: true })
  lastCursor!: string | null;
}
