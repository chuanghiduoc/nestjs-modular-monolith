import { Inject, Injectable } from '@nestjs/common';

import { ENTITLEMENT_SERVICE, type EntitlementService } from '../domain/entitlement.service';
import type { BillingEntitlementsView } from './billing.dto';

@Injectable()
export class GetEntitlementsUseCase {
  constructor(@Inject(ENTITLEMENT_SERVICE) private readonly entitlements: EntitlementService) {}

  async execute(organizationId: string): Promise<BillingEntitlementsView> {
    const value = await this.entitlements.getFor(organizationId);

    return { features: value.features, limits: value.limits };
  }
}
