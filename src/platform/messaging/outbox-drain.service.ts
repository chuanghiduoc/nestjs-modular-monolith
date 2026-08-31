import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { type IntegrationEvent, parseAnyIntegrationEvent } from '#contracts/events';
import { PrismaService } from '#platform/prisma';
import { BullMqEventPublisher, BullMqService, EVENT_SUBSCRIBERS, QUEUES } from '#platform/queue';
import { newId } from '#shared/util';

import { OUTBOX_OPTIONS, type OutboxModuleOptions } from './outbox.options';

interface OutboxRow {
  readonly event_id: string;
  readonly occurred_at: Date;
  readonly event_name: string;
  readonly schema_version: number;
  readonly payload: unknown;
  readonly claim_token: string;
  readonly attempt_count: number;
}

const CLAIM_LEASE_SECONDS = 120;
const MAX_RELAY_ATTEMPTS = 10;

/**
 * How many full batches one scheduled run will drain before yielding. A backlog
 * is cleared inside a single run rather than one batch per tick, while the cap
 * keeps a single run from holding the worker indefinitely.
 */
const MAX_PASSES_PER_RUN = 20;

@Injectable()
export class OutboxDrainService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxDrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: BullMqEventPublisher,
    private readonly queue: BullMqService,
    @Inject(OUTBOX_OPTIONS) private readonly options: OutboxModuleOptions,
  ) {}

  async drainOnce(): Promise<number> {
    const claimToken = newId();
    await this.quarantineExhaustedRows();
    const rows = await this.claimBatch(claimToken);

    if (rows.length === 0) return 0;

    const { publishable, invalid } = partitionByContract(rows);

    if (invalid.length > 0) {
      await this.quarantineRows(invalid, claimToken);
    }

    let dispatched = 0;

    // Per row, not per batch. Releasing the whole claim on one failure would
    // re-publish every row that already succeeded, and would charge all of them
    // an attempt — enough repetitions and one poisonous event drags the rest of
    // its batch into quarantine with it.
    for (const row of publishable) {
      try {
        await this.publisher.dispatch(toIntegrationEvent(row));
        await this.markDrained(row.event_id, claimToken);
        dispatched += 1;
      } catch (error) {
        await this.releaseClaim(row.event_id, claimToken, describeError(error));
        this.logger.error({
          msg: 'outbox relay failed for one event; its claim was released for retry',
          eventId: row.event_id,
          eventName: row.event_name,
          attempt: row.attempt_count,
          err: error,
        });
      }
    }

    return dispatched + invalid.length;
  }

  /**
   * Drains until the backlog is gone or the pass budget runs out. Returns the
   * number of rows this run settled.
   */
  async drainUntilIdle(): Promise<number> {
    let settled = 0;

    for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass += 1) {
      const drained = await this.drainOnce();
      settled += drained;

      if (drained < this.options.drainBatchSize) break;
    }

    return settled;
  }

  async pruneOnce(): Promise<number> {
    const deleted = await this.prisma.db.$executeRawUnsafe(
      `DELETE FROM messaging.outbox_events
        WHERE event_id IN (
          SELECT event_id FROM messaging.outbox_events
           WHERE (drained_at IS NOT NULL AND drained_at < now() - ($1 || ' days')::interval)
              OR (dead_lettered_at IS NOT NULL AND dead_lettered_at < now() - ($1 || ' days')::interval)
           LIMIT $2
        )`,
      String(this.options.retentionDays),
      PRUNE_BATCH_SIZE,
    );

    return deleted;
  }

  /**
   * Prunes in bounded batches so one nightly run cannot hold a long lock, and so
   * a backlog larger than a single batch still drains instead of growing.
   */
  async pruneUntilIdle(): Promise<number> {
    let deleted = 0;

    for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass += 1) {
      const removed = await this.pruneOnce();
      deleted += removed;

      if (removed < PRUNE_BATCH_SIZE) break;
    }

    return deleted;
  }

  async countUndrained(): Promise<number> {
    const [row] = await this.prisma.db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM messaging.outbox_events
        WHERE drained_at IS NULL AND dead_lettered_at IS NULL`,
    );

    return row === undefined ? 0 : Number(row.count);
  }

  async countQuarantined(): Promise<number> {
    const [row] = await this.prisma.db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count
         FROM messaging.outbox_events
        WHERE dead_lettered_at IS NOT NULL`,
    );

    return row === undefined ? 0 : Number(row.count);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.registerWorkers();
  }

  async registerWorkers(): Promise<void> {
    await this.queue.work(QUEUES.OUTBOX_DRAIN, async () => {
      await this.drainUntilIdle();
    });

    await this.queue.work(QUEUES.OUTBOX_PRUNE, async () => {
      const deleted = await this.pruneUntilIdle();
      if (deleted > 0) {
        this.logger.log({ msg: 'pruned drained outbox rows', deleted });
      }
    });

    // A BullMQ scheduler owns the cadence. The previous design re-armed itself
    // from inside the handler using a deduplication key with no TTL: because
    // the running job still held that key, every follow-up job was silently
    // dropped, and the drain only ever ran from its one-minute watchdog.
    await this.queue.scheduleEvery(QUEUES.OUTBOX_DRAIN, this.options.drainIntervalSeconds);
    await this.queue.schedule(QUEUES.OUTBOX_PRUNE, OUTBOX_PRUNE_CRON);
  }

  private async claimBatch(claimToken: string): Promise<OutboxRow[]> {
    return this.prisma.db.$queryRawUnsafe<OutboxRow[]>(
      `UPDATE messaging.outbox_events
          SET claimed_at = now(), claim_token = $1::uuid, attempt_count = attempt_count + 1
        WHERE event_id IN (
          SELECT event_id
            FROM messaging.outbox_events
           WHERE drained_at IS NULL
             AND dead_lettered_at IS NULL
             AND attempt_count < $4
             AND (claimed_at IS NULL OR claimed_at < now() - ($3 || ' seconds')::interval)
           ORDER BY occurred_at, event_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
        )
      RETURNING event_id, occurred_at, event_name, schema_version, payload, claim_token, attempt_count`,
      claimToken,
      this.options.drainBatchSize,
      String(CLAIM_LEASE_SECONDS),
      MAX_RELAY_ATTEMPTS,
    );
  }

  private async markDrained(eventId: string, claimToken: string): Promise<void> {
    await this.prisma.db.$executeRawUnsafe(
      `UPDATE messaging.outbox_events
          SET drained_at = now(), claimed_at = NULL, claim_token = NULL
        WHERE event_id = $1::uuid
          AND claim_token = $2::uuid
          AND dead_lettered_at IS NULL`,
      eventId,
      claimToken,
    );
  }

  private async releaseClaim(
    eventId: string,
    claimToken: string,
    lastError: string,
  ): Promise<void> {
    await this.prisma.db.$executeRawUnsafe(
      `UPDATE messaging.outbox_events
          SET claimed_at = NULL, claim_token = NULL, last_error = $3
        WHERE event_id = $1::uuid AND claim_token = $2::uuid`,
      eventId,
      claimToken,
      lastError,
    );
  }

  private async quarantineExhaustedRows(): Promise<void> {
    await this.prisma.db.$executeRawUnsafe(
      `UPDATE messaging.outbox_events
          SET dead_lettered_at = now(), claimed_at = NULL, claim_token = NULL,
              last_error = COALESCE(last_error, $1)
        WHERE drained_at IS NULL
          AND dead_lettered_at IS NULL
          AND attempt_count >= $2
          AND (claimed_at IS NULL OR claimed_at < now() - ($3 || ' seconds')::interval)`,
      `Outbox relay exceeded ${String(MAX_RELAY_ATTEMPTS)} attempts.`,
      MAX_RELAY_ATTEMPTS,
      String(CLAIM_LEASE_SECONDS),
    );
  }

  private async quarantineRows(rows: readonly OutboxRow[], claimToken: string): Promise<void> {
    const names = [...new Set(rows.map((row) => row.event_name))].join(', ');
    await this.prisma.db.$executeRawUnsafe(
      `UPDATE messaging.outbox_events
          SET dead_lettered_at = now(), claimed_at = NULL, claim_token = NULL,
              last_error = $1
        WHERE event_id = ANY($2::uuid[]) AND claim_token = $3::uuid`,
      `Unknown or invalid integration event contract: ${names}`,
      rows.map((row) => row.event_id),
      claimToken,
    );
    this.logger.error({ msg: 'quarantined invalid outbox events', names, count: rows.length });
  }
}

const PRUNE_BATCH_SIZE = 5000;
const OUTBOX_PRUNE_CRON = '17 3 * * *';

function partitionByContract(rows: readonly OutboxRow[]): {
  publishable: OutboxRow[];
  invalid: OutboxRow[];
} {
  const known = new Set(Object.keys(EVENT_SUBSCRIBERS));
  const publishable: OutboxRow[] = [];
  const invalid: OutboxRow[] = [];

  for (const row of rows) {
    if (!known.has(row.event_name) || parseOutboxEvent(row) === null) {
      invalid.push(row);
    } else {
      publishable.push(row);
    }
  }

  return { publishable, invalid };
}

function toIntegrationEvent(row: OutboxRow): IntegrationEvent {
  const parsed = parseOutboxEvent(row);

  if (parsed === null) {
    throw new Error(`Outbox event ${row.event_id} failed contract validation.`);
  }

  return parsed;
}

function parseOutboxEvent(row: OutboxRow): IntegrationEvent | null {
  const parsed = parseAnyIntegrationEvent({
    eventId: row.event_id,
    name: row.event_name,
    occurredAt: row.occurred_at.toISOString(),
    schemaVersion: row.schema_version,
    payload: row.payload,
  });

  return parsed.success ? parsed.data : null;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return message.slice(0, 2000);
}
