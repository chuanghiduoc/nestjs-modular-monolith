import { type DynamicModule, Module } from '@nestjs/common';

import {
  AUDIT_RETENTION,
  type AuditRetention,
  DEFAULT_AUDIT_RETENTION_DAYS,
} from './application/audit.retention';
import { ListAuditEntriesUseCase } from './application/list-audit-entries.use-case';
import { PruneAuditEntriesUseCase } from './application/prune-audit-entries.use-case';
import { RecordAuditEntryUseCase } from './application/record-audit-entry.use-case';
import { AUDIT_REPOSITORY } from './domain/audit.repository';
import { AuditLogController } from './http/audit-log.controller';
import { PruneAuditLogListener } from './infrastructure/listeners/prune-audit-log.listener';
import { RecordIntegrationEventListener } from './infrastructure/listeners/record-integration-event.listener';
import { PrismaAuditRepository } from './infrastructure/prisma-audit.repository';

export interface AuditLogModuleInput {
  readonly retentionDays?: number;
  readonly exposeHttp?: boolean;
}

@Module({})
export class AuditLogModule {
  static forRoot(input: AuditLogModuleInput = {}): DynamicModule {
    const retention: AuditRetention = {
      retentionDays: input.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS,
    };

    return {
      module: AuditLogModule,
      controllers: input.exposeHttp === false ? [] : [AuditLogController],
      providers: [
        { provide: AUDIT_RETENTION, useValue: retention },
        RecordAuditEntryUseCase,
        ListAuditEntriesUseCase,
        PruneAuditEntriesUseCase,
        RecordIntegrationEventListener,
        PruneAuditLogListener,
        { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
      ],
      exports: [RecordAuditEntryUseCase, ListAuditEntriesUseCase],
    };
  }
}
