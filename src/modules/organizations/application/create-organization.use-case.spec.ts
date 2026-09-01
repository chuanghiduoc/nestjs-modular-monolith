import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import { InMemoryOrganizationRepository } from '../../../../test/support/in-memory';
import { CreateOrganizationUseCase } from './create-organization.use-case';

const OWNER_ID = newId();

function harness() {
  const organizations = new InMemoryOrganizationRepository();

  return { organizations, useCase: new CreateOrganizationUseCase(organizations) };
}

describe('CreateOrganizationUseCase', () => {
  it('persists the organization with the caller as its owner', async () => {
    const { organizations, useCase } = harness();

    const view = await useCase.execute({ ownerId: OWNER_ID, slug: 'acme', name: 'Acme Inc' });

    expect(view).toMatchObject({ slug: 'acme', name: 'Acme Inc', role: 'owner' });
    expect(organizations.organizationOf(view.id)).not.toBeNull();
    expect(organizations.membershipOf(view.id, OWNER_ID)).toMatchObject({ role: 'owner' });
  });

  it('rejects an invalid slug before anything is written', async () => {
    const { organizations, useCase } = harness();

    const error = await captureDomainError(() =>
      useCase.execute({ ownerId: OWNER_ID, slug: 'Bad Slug!', name: 'Acme Inc' }),
    );

    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_INVALID);
    expect(organizations.journal.entries).toEqual([]);
  });

  it('rejects a name below the minimum length before anything is written', async () => {
    const { organizations, useCase } = harness();

    const error = await captureDomainError(() =>
      useCase.execute({ ownerId: OWNER_ID, slug: 'acme', name: 'A' }),
    );

    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_INVALID);
    expect(organizations.journal.entries).toEqual([]);
  });
});
