import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requireTenant, TenantRequired, TenantRoles } from '#platform/tenant-context';
import { ApiCommonErrors, ApiTenantHeader, collectionUrl } from '#shared/http';

import { AdminOverviewService } from '../admin-overview.service';
import {
  AdminUserListResponseDto,
  AdminUserOverviewDto,
  ListUsersRequestDto,
} from './dto/admin.dto';

const ROUTE = 'admin';

@ApiTags('admin')
@ApiCommonErrors({ forbidden: true, notFound: true, validation: true })
@Controller(ROUTE)
@TenantRequired()
@TenantRoles('owner', 'admin')
@ApiTenantHeader()
export class AdminController {
  constructor(private readonly overview: AdminOverviewService) {}

  @Get('users')
  @ApiOperation({ summary: 'List users across the users context.' })
  @ApiOkResponse({ type: AdminUserListResponseDto })
  async listUsers(
    @Query() query: ListUsersRequestDto,
    @Req() request: { readonly url: string },
  ): Promise<AdminUserListResponseDto> {
    const result = await this.overview.listUsers({
      organizationId: requireTenant().organizationId,
      ...(query.startingAfter === undefined ? {} : { startingAfter: query.startingAfter }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });

    return {
      object: 'list',
      url: collectionUrl(request),
      data: result.users,
      hasMore: result.hasMore,
      lastCursor: result.lastCursor,
    };
  }

  @Get('users/:id/overview')
  @ApiOperation({ summary: 'One user, aggregated across users and upload.' })
  @ApiOkResponse({ type: AdminUserOverviewDto })
  async userOverview(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<AdminUserOverviewDto> {
    return this.overview.overview(id, requireTenant().organizationId);
  }
}
