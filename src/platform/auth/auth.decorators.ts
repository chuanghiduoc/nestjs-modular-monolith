import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { PUBLIC_ROUTE_KEY, REQUIRED_ROLES_KEY as ROLES_KEY } from '#shared/http';

import type { AuthenticatedSession } from './authenticated-session';

export const IS_PUBLIC_KEY = PUBLIC_ROUTE_KEY;
export const REQUIRED_ROLES_KEY = ROLES_KEY;

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession | undefined => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    return request.authSession;
  },
);
