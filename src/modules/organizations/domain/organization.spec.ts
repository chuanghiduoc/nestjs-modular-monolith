import { describe, expect, it } from 'vitest';

import { isDomainException } from '#shared/errors';

import { Organization } from './organization';

describe('Organization', () => {
  it('creates a normalized business identity with a stable id', () => {
    const organization = Organization.create({ slug: 'acme', name: 'Acme Inc.' });

    expect(organization.id).toMatch(/[0-9a-f-]{36}/);
    expect(organization.archivedAt).toBeNull();
  });

  it('rejects invalid slugs and names at the domain boundary', () => {
    expect(() => Organization.create({ slug: 'Not A Slug', name: 'A' })).toThrow();
    try {
      Organization.create({ slug: 'Not A Slug', name: 'A' });
    } catch (error) {
      expect(isDomainException(error)).toBe(true);
    }
  });
});
