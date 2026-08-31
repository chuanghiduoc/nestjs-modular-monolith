import type { OrganizationRole } from '../domain/organization';

export interface OrganizationView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly createdAt: string;
}
