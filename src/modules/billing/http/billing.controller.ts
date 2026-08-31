import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requireTenant, TenantRequired } from '#platform/tenant-context';
import { ApiCommonErrors, ApiTenantHeader } from '#shared/http';

import type { BillingEntitlementsView } from '../application/billing.dto';
import { GetEntitlementsUseCase } from '../application/get-entitlements.use-case';

@ApiTags('billing')
@ApiCommonErrors({ forbidden: true, notFound: true })
@Controller('billing')
@TenantRequired()
@ApiTenantHeader()
export class BillingController {
  constructor(private readonly getEntitlementsUseCase: GetEntitlementsUseCase) {}

  @Get('entitlements')
  @ApiOperation({ summary: 'Return the active plan entitlements for the selected organization.' })
  @ApiOkResponse({ description: 'Effective feature flags and limits.' })
  getEntitlements(): Promise<BillingEntitlementsView> {
    return this.getEntitlementsUseCase.execute(requireTenant().organizationId);
  }
}
