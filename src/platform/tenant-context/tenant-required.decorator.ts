import { SetMetadata } from '@nestjs/common';

import { TENANT_REQUIRED_KEY } from '#shared/http';

export const TenantRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_REQUIRED_KEY, true);
