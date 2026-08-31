import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requireTenant, TenantRequired, TenantRoles } from '#platform/tenant-context';
import { ApiCommonErrors, ApiTenantHeader, collectionUrl } from '#shared/http';

import { ListAuditEntriesUseCase } from '../application/list-audit-entries.use-case';
import { AuditLogListResponseDto, AuditLogResponseDto } from './dto/audit-log.response.dto';
import { ListAuditLogsRequestDto } from './dto/list-audit-logs.request.dto';

const ROUTE = 'audit-logs';

@ApiTags('audit-logs')
@ApiCommonErrors({ forbidden: true, validation: true })
@Controller(ROUTE)
@TenantRequired()
@ApiTenantHeader()
export class AuditLogController {
  constructor(private readonly listEntries: ListAuditEntriesUseCase) {}
  @Get()
  @TenantRoles('owner', 'admin')
  @ApiOperation({ summary: 'List audit entries, newest first.' })
  @ApiOkResponse({ type: AuditLogListResponseDto })
  async list(
    @Query()
    query: ListAuditLogsRequestDto,
    @Req() request: { readonly url: string },
  ): Promise<AuditLogListResponseDto> {
    const page = await this.listEntries.execute({
      startingAfter: query.startingAfter,
      limit: query.limit,
      filter: {
        organizationId: requireTenant().organizationId,
        ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
        ...(query.resource === undefined ? {} : { resource: query.resource }),
      },
    });

    return {
      object: 'list',
      url: collectionUrl(request),
      data: page.entries.map((entry) => AuditLogResponseDto.from(entry)),
      hasMore: page.hasMore,
      lastCursor: page.lastCursor,
    };
  }
}
