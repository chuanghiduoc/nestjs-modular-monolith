import { Injectable } from '@nestjs/common';

import type { TxHandle, UnitOfWorkPort } from '#contracts/ports';

import type { Prisma } from './generated/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly prisma: PrismaService) {}

  async transaction<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> {
    return this.prisma.transaction(async (tx) => fn(toTxHandle(tx)));
  }
}

export function toTxHandle(tx: Prisma.TransactionClient): TxHandle {
  return tx as unknown as TxHandle;
}

export function fromTxHandle(tx: TxHandle): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}
