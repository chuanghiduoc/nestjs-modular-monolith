import { AsyncLocalStorage } from 'node:async_hooks';

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { type Prisma, PrismaClient } from './generated/client';
import { PRISMA_OPTIONS, type PrismaModuleOptions } from './prisma.options';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly db: PrismaClient;
  private readonly transactionStore = new AsyncLocalStorage<Prisma.TransactionClient>();
  constructor(
    @Inject(PRISMA_OPTIONS)
    private readonly options: PrismaModuleOptions,
  ) {
    this.db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: options.connectionString,
        max: options.poolMax,
        application_name: options.applicationName,
        statement_timeout: options.statementTimeoutMs,
        idleTimeoutMillis: options.idleTimeoutMs,
        connectionTimeoutMillis: options.connectTimeoutMs,
      }),
      transactionOptions: {
        maxWait: options.transactionMaxWaitMs,
        timeout: options.transactionTimeoutMs,
      },
    });
  }

  get currentTransaction(): Prisma.TransactionClient | null {
    return this.transactionStore.getStore() ?? null;
  }

  async onModuleInit(): Promise<void> {
    await this.db.$connect();
    this.logger.log(`Connected (pool max ${String(this.options.poolMax)})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }

  async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.currentTransaction !== null) {
      throw new Error(
        'Nested transaction: a second physical transaction would commit independently of the first.',
      );
    }

    return this.db.$transaction((tx) => this.transactionStore.run(tx, () => fn(tx)));
  }
}
