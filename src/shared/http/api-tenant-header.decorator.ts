import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export function ApiTenantHeader(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'x-organization-id',
      description: 'UUIDv7 of the organization selected for this request.',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }),
  );
}
