import { z } from 'zod';

import { DomainErrors, ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

export const ORGANIZATION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const nameSchema = z.string().trim().min(2).max(160);

export class Organization {
  private constructor(
    readonly id: string,
    readonly slug: string,
    readonly name: string,
    readonly createdAt: Date,
    readonly archivedAt: Date | null,
  ) {}

  static create(input: { slug: string; name: string; now?: Date }): Organization {
    const slug = slugSchema.safeParse(input.slug);
    const name = nameSchema.safeParse(input.name);
    if (!slug.success || !name.success) {
      throw DomainErrors.validation(
        ERROR_CODES.ORGANIZATION_INVALID,
        'Organization name or slug is invalid.',
      );
    }

    return new Organization(newId(), slug.data, name.data, input.now ?? new Date(), null);
  }

  static rehydrate(input: {
    id: string;
    slug: string;
    name: string;
    createdAt: Date;
    archivedAt: Date | null;
  }): Organization {
    return new Organization(input.id, input.slug, input.name, input.createdAt, input.archivedAt);
  }
}

export interface OrganizationMembership {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly createdAt: Date;
}
