import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { InMemoryOrganizationRepository } from '../../../../test/support/in-memory';
import { Organization } from '../domain/organization';
import { ListMyOrganizationsUseCase } from './list-my-organizations.use-case';

const USER_ID = newId();

function seedOrganization(
  organizations: InMemoryOrganizationRepository,
  input: { slug: string; archivedAt?: Date | null; role?: 'owner' | 'member' },
): Organization {
  const organization = Organization.rehydrate({
    id: newId(),
    slug: input.slug,
    name: input.slug.toUpperCase(),
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    archivedAt: input.archivedAt ?? null,
  });
  organizations.seedOrganization(organization);
  organizations.seedMember({
    organizationId: organization.id,
    userId: USER_ID,
    role: input.role ?? 'member',
  });

  return organization;
}

describe('ListMyOrganizationsUseCase', () => {
  it('returns each membership with its role and the organization it belongs to', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const owned = seedOrganization(organizations, { slug: 'acme', role: 'owner' });
    seedOrganization(organizations, { slug: 'globex' });

    const views = await new ListMyOrganizationsUseCase(organizations).execute(USER_ID);

    expect(views).toHaveLength(2);
    expect(views.find((view) => view.id === owned.id)).toMatchObject({
      slug: 'acme',
      name: 'ACME',
      role: 'owner',
      createdAt: '2026-03-01T00:00:00.000Z',
    });
  });

  it('leaves archived organizations out of the listing', async () => {
    const organizations = new InMemoryOrganizationRepository();
    seedOrganization(organizations, { slug: 'acme' });
    seedOrganization(organizations, { slug: 'closed', archivedAt: new Date() });

    const views = await new ListMyOrganizationsUseCase(organizations).execute(USER_ID);

    expect(views.map((view) => view.slug)).toEqual(['acme']);
  });

  it('answers a user without memberships with an empty list', async () => {
    const organizations = new InMemoryOrganizationRepository();

    await expect(new ListMyOrganizationsUseCase(organizations).execute(USER_ID)).resolves.toEqual(
      [],
    );
  });
});
