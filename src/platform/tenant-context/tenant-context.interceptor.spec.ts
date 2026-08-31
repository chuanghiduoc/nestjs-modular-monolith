import type { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { currentTenant } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';

const TENANT = {
  organizationId: '01a00000-0000-7000-8000-000000000001',
  userId: '01a00000-0000-7000-8000-000000000002',
  role: 'admin' as const,
};

describe('TenantContextInterceptor', () => {
  it('keeps tenant context available while the handler observable is subscribed', async () => {
    const interceptor = new TenantContextInterceptor();
    const request = { tenantContext: TENANT };
    const value = await firstValueFrom(
      interceptor.intercept(
        { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext,
        { handle: () => of(currentTenant()) },
      ),
    );

    expect(value).toEqual(TENANT);
    expect(currentTenant()).toBeUndefined();
  });
});
