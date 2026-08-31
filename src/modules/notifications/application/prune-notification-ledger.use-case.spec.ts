import { describe, expect, it, vi } from 'vitest';

import type { NotificationLedgerPort } from '../domain/notification-ledger.port';
import {
  DEFAULT_LEDGER_RETENTION_DAYS,
  PruneNotificationLedgerUseCase,
} from './prune-notification-ledger.use-case';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 5_000;
const NOW = new Date('2026-08-20T00:00:00.000Z');

function ledgerDeleting(...counts: readonly number[]): {
  ledger: NotificationLedgerPort;
  deleteSentBefore: ReturnType<typeof vi.fn>;
} {
  const deleteSentBefore = vi.fn();

  for (const count of counts) {
    deleteSentBefore.mockResolvedValueOnce(count);
  }
  deleteSentBefore.mockResolvedValue(0);

  return {
    ledger: { claim: vi.fn(), release: vi.fn(), deleteSentBefore },
    deleteSentBefore,
  };
}

describe('PruneNotificationLedgerUseCase', () => {
  it('deletes rows older than the retention window in one pass when the batch is not full', async () => {
    const { ledger, deleteSentBefore } = ledgerDeleting(12);
    const useCase = new PruneNotificationLedgerUseCase(ledger);

    await expect(useCase.execute(NOW)).resolves.toBe(12);

    expect(deleteSentBefore).toHaveBeenCalledTimes(1);
    expect(deleteSentBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - DEFAULT_LEDGER_RETENTION_DAYS * DAY_MS),
      BATCH_SIZE,
    );
  });

  it('keeps draining while a full batch says a backlog is left', async () => {
    const { ledger, deleteSentBefore } = ledgerDeleting(BATCH_SIZE, BATCH_SIZE, 7);
    const useCase = new PruneNotificationLedgerUseCase(ledger);

    await expect(useCase.execute(NOW)).resolves.toBe(BATCH_SIZE * 2 + 7);

    expect(deleteSentBefore).toHaveBeenCalledTimes(3);
  });

  it('computes the cutoff once, so a long run cannot widen its own window', async () => {
    const { ledger, deleteSentBefore } = ledgerDeleting(BATCH_SIZE, 1);
    const useCase = new PruneNotificationLedgerUseCase(ledger);

    await useCase.execute(NOW);

    const cutoffs = deleteSentBefore.mock.calls.map((call) => call[0] as Date);

    expect(cutoffs[1]).toStrictEqual(cutoffs[0]);
  });

  it('stops at the pass budget instead of looping on an endless backlog', async () => {
    const { ledger, deleteSentBefore } = ledgerDeleting();
    deleteSentBefore.mockResolvedValue(BATCH_SIZE);
    const useCase = new PruneNotificationLedgerUseCase(ledger);

    await expect(useCase.execute(NOW)).resolves.toBe(BATCH_SIZE * 20);

    expect(deleteSentBefore).toHaveBeenCalledTimes(20);
  });
});
