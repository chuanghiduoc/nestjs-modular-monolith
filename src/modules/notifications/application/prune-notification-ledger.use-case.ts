import { Inject, Injectable } from '@nestjs/common';

import {
  NOTIFICATION_LEDGER,
  type NotificationLedgerPort,
} from '../domain/notification-ledger.port';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 5_000;
const MAX_PASSES = 20;

/**
 * The ledger only has to outlive the retry window of the job that wrote it.
 * Ninety days is far past that and still keeps the table small.
 */
export const DEFAULT_LEDGER_RETENTION_DAYS = 90;

@Injectable()
export class PruneNotificationLedgerUseCase {
  constructor(@Inject(NOTIFICATION_LEDGER) private readonly ledger: NotificationLedgerPort) {}

  /**
   * Bounded batches, repeated: one batch per night loses to any deployment that
   * sends more notifications a day than a batch holds, and the ledger would then
   * grow for as long as that stays true.
   */
  async execute(
    now: Date = new Date(),
    retentionDays = DEFAULT_LEDGER_RETENTION_DAYS,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    let deleted = 0;

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const removed = await this.ledger.deleteSentBefore(cutoff, BATCH_SIZE);
      deleted += removed;

      if (removed < BATCH_SIZE) break;
    }

    return deleted;
  }
}
