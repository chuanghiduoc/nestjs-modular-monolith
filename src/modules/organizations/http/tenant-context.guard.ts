import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { TENANT_REQUIRED_KEY } from '#shared/http';
import { isUuidV7 } from '#shared/util';

import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const required = this.reflector.getAllAndOverride<boolean>(TENANT_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const organizationId = request.headers['x-organization-id'];
    const user = request.authSession;

    if (typeof organizationId !== 'string' || !isUuidV7(organizationId)) {
      if (required === true) throw new UnauthorizedException('X-Organization-Id is required.');

      return true;
    }
    if (user === undefined) {
      if (required === true) throw new UnauthorizedException();

      return true;
    }

    const membership = await this.organizations.findMembership(organizationId, user.userId);
    if (membership === null) {
      // No live membership: either the caller does not belong to this
      // organization, or it is archived — live lookups exclude archived rows.
      // Routes that demand a tenant fail closed. Routes that merely accept the
      // header stay neutral, so lifecycle commands such as restore and purge —
      // which authorize the owner against archived rows themselves — remain
      // reachable for clients that always send their tenant header, and the
      // endpoint cannot double as a membership-existence oracle.
      if (required === true) throw new ForbiddenException();

      return true;
    }

    request.tenantContext = { organizationId, userId: user.userId, role: membership.role };

    return true;
  }
}
