import type { TenantContext } from '#platform/tenant-context';

import type { AuthenticatedSession } from './authenticated-session';

declare module 'fastify' {
  interface FastifyRequest {
    authSession?: AuthenticatedSession;
    tenantContext?: TenantContext;
  }
}
