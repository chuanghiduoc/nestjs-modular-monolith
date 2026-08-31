import { AsyncLocalStorage } from 'node:async_hooks';

export const TENANT_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export interface TenantContext {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: TenantRole;
  readonly requestId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

export function requireTenant(): TenantContext {
  const context = currentTenant();
  if (context === undefined) {
    throw new Error('Tenant context is required for this operation.');
  }

  return context;
}
