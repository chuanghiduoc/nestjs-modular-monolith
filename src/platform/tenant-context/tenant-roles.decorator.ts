import { SetMetadata } from '@nestjs/common';

import { REQUIRED_TENANT_ROLES_KEY } from '#shared/http';

import type { TenantRole } from './tenant-context';

export const TenantRoles = (...roles: readonly TenantRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_TENANT_ROLES_KEY, roles);
