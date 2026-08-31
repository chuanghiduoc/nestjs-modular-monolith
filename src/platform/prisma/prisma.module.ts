import { type DynamicModule, Global, Module } from '@nestjs/common';

import { UNIT_OF_WORK } from '#contracts/ports';

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  DEFAULT_TRANSACTION_MAX_WAIT_MS,
  DEFAULT_TRANSACTION_TIMEOUT_MS,
  PRISMA_OPTIONS,
  type PrismaModuleOptions,
} from './prisma.options';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

export interface PrismaModuleInput {
  readonly connectionString: string;
  readonly poolMax: number;
  readonly applicationName: string;
  readonly transactionTimeoutMs?: number;
  readonly transactionMaxWaitMs?: number;
  readonly statementTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
}

@Global()
@Module({})
export class PrismaModule {
  static forRoot(input: PrismaModuleInput): DynamicModule {
    const options: PrismaModuleOptions = {
      connectionString: input.connectionString,
      poolMax: input.poolMax,
      applicationName: input.applicationName,
      transactionTimeoutMs: input.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS,
      transactionMaxWaitMs: input.transactionMaxWaitMs ?? DEFAULT_TRANSACTION_MAX_WAIT_MS,
      statementTimeoutMs: input.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      idleTimeoutMs: input.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      connectTimeoutMs: input.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    };

    return {
      module: PrismaModule,
      providers: [
        { provide: PRISMA_OPTIONS, useValue: options },
        PrismaService,

        { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
      ],
      exports: [PrismaService, UNIT_OF_WORK],
    };
  }
}
