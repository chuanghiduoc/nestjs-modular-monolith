import { describe, expect, it, vi } from 'vitest';

import type { BillingWebhookInboxRepository } from '../domain/billing-webhook.repository';
import {
  DEFAULT_BILLING_WEBHOOK_RETENTION_DAYS,
  PruneBillingWebhookInboxUseCase,
} from './prune-billing-webhook-inbox.use-case';

describe('PruneBillingWebhookInboxUseCase', () => {
  it('deletes only processed events older than the retention window', async () => {
    const deleteProcessedBefore = vi.fn().mockResolvedValue(12);
    const repository: BillingWebhookInboxRepository = {
      claim: vi.fn(),
      findClaimed: vi.fn().mockResolvedValue(null),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
      deleteProcessedBefore,
    };
    const useCase = new PruneBillingWebhookInboxUseCase(repository);
    const now = new Date('2026-08-20T00:00:00.000Z');

    await expect(useCase.execute(now)).resolves.toBe(12);

    expect(deleteProcessedBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - DEFAULT_BILLING_WEBHOOK_RETENTION_DAYS * 86_400_000),
      5_000,
    );
  });
});
