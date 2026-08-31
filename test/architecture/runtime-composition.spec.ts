import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AuditLogModule } from '#modules/audit-log';
import { BillingModule } from '#modules/billing';
import { UploadModule } from '#modules/upload';
import { UsersModule } from '#modules/users';

const UPLOAD_OPTIONS = { maxFileBytes: 1_048_576 } as const;

const ROLE_MODULES = ['api.module.ts', 'worker.module.ts', 'scheduler.module.ts'] as const;

function roleModuleSource(file: string): string {
  return readFileSync(join(process.cwd(), 'src', 'bootstrap', file), 'utf8');
}

function entrypointSource(file: string): string {
  return readFileSync(join(process.cwd(), 'src', file), 'utf8');
}

describe('runtime composition', () => {
  it('keeps HTTP controllers in the API composition', () => {
    expect(UsersModule.forRoot().controllers).toHaveLength(1);
    expect(UploadModule.forRoot(UPLOAD_OPTIONS).controllers).toHaveLength(1);
    expect(AuditLogModule.forRoot().controllers).toHaveLength(1);
    // Billing exposes two: the tenant-facing entitlements read, and the signed
    // provider webhook.
    expect(BillingModule.forRoot().controllers).toHaveLength(2);
  });

  it('does not expose business HTTP controllers from the worker composition', () => {
    expect(UsersModule.forRoot({ exposeHttp: false }).controllers).toEqual([]);
    expect(UploadModule.forRoot({ ...UPLOAD_OPTIONS, exposeHttp: false }).controllers).toEqual([]);
    expect(AuditLogModule.forRoot({ exposeHttp: false }).controllers).toEqual([]);
    expect(BillingModule.forRoot({ exposeHttp: false }).controllers).toEqual([]);
  });

  it('builds every role through the one factory, so the entrypoints cannot drift', () => {
    // Each single-role entrypoint and the all-in-one one must assemble their
    // apps the same way. Copying the API's fastify setup into a second file is
    // how a plugin ends up registered in one process and missing in another.
    const factories = {
      'main.api.ts': 'createApiApp',
      'main.worker.ts': 'createWorkerApp',
      'main.scheduler.ts': 'createSchedulerApp',
    } as const;

    for (const [file, factory] of Object.entries(factories)) {
      expect(entrypointSource(file), file).toContain(factory);
      expect(entrypointSource(file), file).not.toContain('NestFactory.create');
    }

    const all = entrypointSource('main.all.ts');

    for (const factory of Object.values(factories)) {
      expect(all, 'main.all.ts hosts every role').toContain(factory);
    }
  });

  // A shared-state metrics source registers itself against a collector it takes
  // optionally. A role that produces gauges but composes no metrics module
  // resolves that collector to undefined, publishes nothing, and every alert
  // written against those gauges silently never fires.
  it('gives every role the metrics module its gauges need', () => {
    const missing = ROLE_MODULES.filter(
      (file) => !roleModuleSource(file).includes('ObservabilityMetricsModule.forRootAsync'),
    );

    expect(missing).toEqual([]);
  });
});
