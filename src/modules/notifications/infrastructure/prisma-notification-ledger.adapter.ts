import { Injectable } from '@nestjs/common';

import { PrismaService } from '#platform/prisma';

import type { NotificationLedgerPort } from '../domain/notification-ledger.port';

@Injectable()
export class PrismaNotificationLedger implements NotificationLedgerPort {
  constructor(private readonly prisma: PrismaService) {}

  async claim(idempotencyKey: string, channel: string): Promise<boolean> {
    const created = await this.prisma.db.sentNotification.createMany({
      data: { idempotencyKey, channel },
      skipDuplicates: true,
    });

    return created.count === 1;
  }

  async release(idempotencyKey: string): Promise<void> {
    await this.prisma.db.sentNotification.deleteMany({ where: { idempotencyKey } });
  }

  async deleteSentBefore(cutoff: Date, limit: number): Promise<number> {
    if (limit <= 0) return 0;

    const candidates = await this.prisma.db.sentNotification.findMany({
      where: { sentAt: { lt: cutoff } },
      select: { idempotencyKey: true },
      orderBy: { sentAt: 'asc' },
      take: limit,
    });
    if (candidates.length === 0) return 0;

    const result = await this.prisma.db.sentNotification.deleteMany({
      where: { idempotencyKey: { in: candidates.map((row) => row.idempotencyKey) } },
    });

    return result.count;
  }
}
