import { Inject, Injectable } from '@nestjs/common';

import { Organization } from '../domain/organization';
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';
import type { OrganizationView } from './organization.dto';

@Injectable()
export class CreateOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async execute(input: { ownerId: string; slug: string; name: string }): Promise<OrganizationView> {
    const organization = Organization.create(input);
    await this.organizations.createWithOwner(organization, input.ownerId);

    return {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      role: 'owner',
      createdAt: organization.createdAt.toISOString(),
    };
  }
}
