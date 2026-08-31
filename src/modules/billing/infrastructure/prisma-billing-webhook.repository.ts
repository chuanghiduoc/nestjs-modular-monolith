import { Injectable } from '@nestjs/common';

import { type Prisma, PrismaService } from '#platform/prisma';
import { newId } from '#shared/util';

import type { BillingWebhookInboxRepository } from '../domain/billing-webhook.repository';

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

@Injectable()
export class PrismaBillingWebhookInboxRepository implements BillingWebhookInboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(input: {
    readonly provider: string;
    readonly providerEventId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<string | null> {
    const now = new Date();
    const claimToken = newId();
    const created = await this.prisma.db.billingWebhookInboxEvent.createMany({
      data: {
        id: newId(),
        provider: input.provider,
        providerEventId: input.providerEventId,
        payload: toJsonObject(input.payload),
        processingAt: now,
        processingToken: claimToken,
      },
      skipDuplicates: true,
    });
    if (created.count === 1) return claimToken;

    const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);

    const retried = await this.prisma.db.billingWebhookInboxEvent.updateMany({
      where: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        processedAt: null,
        OR: [{ failedAt: { not: null } }, { processingAt: { lt: staleBefore } }],
      },
      data: {
        receivedAt: now,
        processingAt: now,
        processingToken: claimToken,
        failedAt: null,
        lastError: null,
        payload: toJsonObject(input.payload),
      },
    });

    return retried.count === 1 ? claimToken : null;
  }

  async findClaimed(
    provider: string,
    providerEventId: string,
    claimToken: string,
  ): Promise<{ readonly payload: Readonly<Record<string, unknown>> } | null> {
    const row = await this.prisma.db.billingWebhookInboxEvent.findFirst({
      where: { provider, providerEventId, processingToken: claimToken, processedAt: null },
      select: { payload: true },
    });

    if (row === null || typeof row.payload !== 'object' || row.payload === null) return null;
    if (Array.isArray(row.payload)) return null;

    return { payload: row.payload };
  }

  async markProcessed(
    provider: string,
    providerEventId: string,
    claimToken: string,
  ): Promise<void> {
    await this.prisma.db.billingWebhookInboxEvent.updateMany({
      where: { provider, providerEventId, processedAt: null, processingToken: claimToken },
      data: {
        processingAt: null,
        processingToken: null,
        processedAt: new Date(),
        failedAt: null,
      },
    });
  }

  async markFailed(
    provider: string,
    providerEventId: string,
    claimToken: string,
    error: string,
  ): Promise<void> {
    await this.prisma.db.billingWebhookInboxEvent.updateMany({
      where: { provider, providerEventId, processedAt: null, processingToken: claimToken },
      data: {
        processingAt: null,
        processingToken: null,
        failedAt: new Date(),
        lastError: error.slice(0, 2000),
      },
    });
  }

  async deleteProcessedBefore(cutoff: Date, limit: number): Promise<number> {
    if (limit <= 0) return 0;

    const candidates = await this.prisma.db.billingWebhookInboxEvent.findMany({
      where: { processedAt: { not: null, lt: cutoff } },
      select: { id: true },
      orderBy: { processedAt: 'asc' },
      take: limit,
    });
    if (candidates.length === 0) return 0;

    const result = await this.prisma.db.billingWebhookInboxEvent.deleteMany({
      where: { id: { in: candidates.map((candidate) => candidate.id) } },
    });

    return result.count;
  }
}

function toJsonObject(value: Readonly<Record<string, unknown>>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, toJsonMember(entry)]),
  );
}

function toJsonMember(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => toJsonMember(entry));
  if (isRecord(value)) return toJsonObject(value);

  throw new Error(`Cannot serialize webhook payload value of type ${typeof value}.`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
