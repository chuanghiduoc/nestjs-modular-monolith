import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { type Prisma, PrismaService } from '#platform/prisma';

import type {
  BillingEntitlementSet,
  BillingRepository,
  CurrentSubscription,
} from '../domain/billing.repository';

@Injectable()
export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrentSubscription(organizationId: string): Promise<CurrentSubscription | null> {
    const row = await this.prisma.db.subscription.findFirst({
      where: {
        organizationId,
        status: { in: ['trialing', 'active'] },
        plan: { active: true },
      },
      include: { plan: true },
    });

    if (row === null) return null;

    return {
      organizationId: row.organizationId,
      planCode: row.plan.code,
      planName: row.plan.name,
      status: row.status,
      provider: row.provider,
      currentPeriodEnd: row.currentPeriodEnd,
      entitlements: parseEntitlements(row.plan.entitlements),
    };
  }
}

const entitlementSchema = z.object({
  features: z.array(z.string()).default([]),
  limits: z.record(z.string(), z.number().finite().nonnegative()).default({}),
});

export function parseEntitlements(value: Prisma.JsonValue): BillingEntitlementSet {
  const parsed = entitlementSchema.safeParse(value);

  return parsed.success ? parsed.data : { features: [], limits: {} };
}
