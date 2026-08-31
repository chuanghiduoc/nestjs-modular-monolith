import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { REQUIRED_TENANT_ROLES_KEY } from '#shared/http';

import type { TenantRole } from './tenant-context';

@Injectable()
export class TenantRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly TenantRole[]>(
      REQUIRED_TENANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required.length === 0) return true;

    const tenant = context.switchToHttp().getRequest<FastifyRequest>().tenantContext;
    if (tenant === undefined) throw new UnauthorizedException('Tenant context is required.');
    if (!required.includes(tenant.role)) throw new ForbiddenException();

    return true;
  }
}
