import { Inject, Injectable } from '@nestjs/common';

import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';
import type { OrganizationView } from './organization.dto';

@Injectable()
export class ListMyOrganizationsUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async execute(userId: string): Promise<readonly OrganizationView[]> {
    const rows = await this.organizations.listMembershipsWithOrganization(userId);

    return rows.map(({ membership, organization }) => ({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      role: membership.role,
      createdAt: organization.createdAt.toISOString(),
    }));
  }
}
