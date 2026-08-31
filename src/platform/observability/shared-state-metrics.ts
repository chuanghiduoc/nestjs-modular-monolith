import { Inject, Injectable, Logger } from '@nestjs/common';

import { withTimeout } from '#shared/util';

import {
  metricsRegistry,
  OUTBOX_QUARANTINED_METRIC,
  OUTBOX_UNDRAINED_METRIC,
  outboxQuarantined,
  outboxUndrained,
  queueDeadletterDepth,
  queueDepth,
  queueOldestJobAge,
} from './metrics';
import { METRICS_OPTIONS, type MetricsOptions } from './options';

const DEFAULT_SHARED_STATE_TIMEOUT_MS = 1000;
const MILLISECONDS_PER_SECOND = 1000;

export type QueueSharedStateMetric =
  'queue_depth' | 'queue_deadletter_depth' | 'queue_oldest_job_age_seconds';
export type SharedStateReading =
  | {
      readonly metric: QueueSharedStateMetric;
      readonly queue: string;
      readonly value: number;
    }
  | {
      readonly metric: 'outbox_undrained_total';
      readonly value: number;
    }
  | {
      readonly metric: 'outbox_quarantined_total';
      readonly value: number;
    };
export interface SharedStateMetricsSource {
  readonly sourceName: string;
  collectSharedState(): Promise<readonly SharedStateReading[]>;
}
@Injectable()
export class SharedStateMetricsCollector {
  private readonly logger = new Logger(SharedStateMetricsCollector.name);
  private readonly sources: SharedStateMetricsSource[] = [];
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private freshUntilMs = 0;
  private inFlight: Promise<void> | undefined;
  constructor(
    @Inject(METRICS_OPTIONS)
    options: MetricsOptions,
  ) {
    this.cacheTtlMs = options.cacheTtlSeconds * MILLISECONDS_PER_SECOND;
    this.timeoutMs = options.sharedStateTimeoutMs ?? DEFAULT_SHARED_STATE_TIMEOUT_MS;
  }

  register(source: SharedStateMetricsSource): void {
    this.sources.push(source);
    this.freshUntilMs = 0;
  }

  async refresh(): Promise<void> {
    if (Date.now() < this.freshUntilMs) {
      return;
    }
    this.inFlight ??= this.collectAndApply();
    await this.inFlight;
  }

  private async collectAndApply(): Promise<void> {
    try {
      const collected = await Promise.all(this.sources.map((source) => this.collectOne(source)));
      resetSharedStateGauges();
      for (const reading of collected.flat()) {
        if (!Number.isFinite(reading.value)) {
          this.logger.warn(`dropped a non-numeric ${reading.metric} reading: ${reading.value}`);
          continue;
        }
        applyReading(reading);
      }
      this.freshUntilMs = Date.now() + this.cacheTtlMs;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async collectOne(
    source: SharedStateMetricsSource,
  ): Promise<readonly SharedStateReading[]> {
    try {
      return await withTimeout(source.collectSharedState(), this.timeoutMs, source.sourceName);
    } catch (error) {
      this.logger.warn(
        `shared-state metrics source "${source.sourceName}" failed; its gauges are omitted from this scrape: ${describeError(error)}`,
      );

      return [];
    }
  }
}

function applyReading(reading: SharedStateReading): void {
  switch (reading.metric) {
    case 'queue_depth':
      queueDepth.set({ queue: reading.queue }, reading.value);

      return;
    case 'queue_deadletter_depth':
      queueDeadletterDepth.set({ queue: reading.queue }, reading.value);

      return;
    case 'queue_oldest_job_age_seconds':
      queueOldestJobAge.set({ queue: reading.queue }, reading.value);

      return;
    case 'outbox_undrained_total':
      metricsRegistry.registerMetric(outboxUndrained);
      outboxUndrained.set(reading.value);

      return;
    case 'outbox_quarantined_total':
      metricsRegistry.registerMetric(outboxQuarantined);
      outboxQuarantined.set(reading.value);

      return;
  }
}

function resetSharedStateGauges(): void {
  queueDepth.reset();
  queueDeadletterDepth.reset();
  queueOldestJobAge.reset();
  metricsRegistry.removeSingleMetric(OUTBOX_UNDRAINED_METRIC);
  metricsRegistry.removeSingleMetric(OUTBOX_QUARANTINED_METRIC);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
