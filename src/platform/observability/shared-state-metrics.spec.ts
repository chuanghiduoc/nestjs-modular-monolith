import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { metricsRegistry } from './metrics';
import type { MetricsOptions } from './options';
import {
  SharedStateMetricsCollector,
  type SharedStateMetricsSource,
  type SharedStateReading,
} from './shared-state-metrics';

const CACHE_TTL_SECONDS = 10;

function collectorWith(overrides: Partial<MetricsOptions> = {}): SharedStateMetricsCollector {
  return new SharedStateMetricsCollector({
    allowCidrs: [],
    cacheTtlSeconds: CACHE_TTL_SECONDS,
    sharedStateTimeoutMs: 50,
    ...overrides,
  });
}

function sourceReturning(
  sourceName: string,
  readings: readonly SharedStateReading[],
): SharedStateMetricsSource & { calls: number } {
  return {
    sourceName,
    calls: 0,
    collectSharedState(): Promise<readonly SharedStateReading[]> {
      this.calls += 1;

      return Promise.resolve(readings);
    },
  };
}

function hangingSource(sourceName: string): SharedStateMetricsSource {
  return {
    sourceName,
    collectSharedState: () => new Promise<readonly SharedStateReading[]>(() => undefined),
  };
}

beforeAll(() => {
  Logger.overrideLogger(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SharedStateMetricsCollector', () => {
  it('publishes the readings a source returns', async () => {
    const collector = collectorWith();
    collector.register(
      sourceReturning('queue', [
        { metric: 'queue_depth', queue: 'emails', value: 3 },
        { metric: 'queue_oldest_job_age_seconds', queue: 'emails', value: 12.5 },
        { metric: 'outbox_undrained_total', value: 7 },
      ]),
    );

    await collector.refresh();

    const scrape = await metricsRegistry.metrics();
    expect(scrape).toContain('queue_depth{queue="emails"} 3');
    expect(scrape).toContain('queue_oldest_job_age_seconds{queue="emails"} 12.5');
    expect(scrape).toContain('outbox_undrained_total 7');
  });

  it('memoises the readings for the configured TTL', async () => {
    vi.useFakeTimers();
    const source = sourceReturning('queue', [{ metric: 'queue_depth', queue: 'ttl', value: 1 }]);
    const collector = collectorWith();
    collector.register(source);

    await collector.refresh();
    await collector.refresh();
    vi.advanceTimersByTime((CACHE_TTL_SECONDS - 1) * 1000);
    await collector.refresh();

    expect(source.calls).toBe(1);

    vi.advanceTimersByTime(2000);
    await collector.refresh();

    expect(source.calls).toBe(2);
  });

  it('collapses concurrent scrapes into a single pass', async () => {
    const source = sourceReturning('queue', [{ metric: 'queue_depth', queue: 'single', value: 1 }]);
    const collector = collectorWith({ cacheTtlSeconds: 0 });
    collector.register(source);

    await Promise.all([collector.refresh(), collector.refresh(), collector.refresh()]);

    expect(source.calls).toBe(1);
  });

  it('serves the per-replica series while a timed-out source leaves its gauges absent', async () => {
    vi.useFakeTimers();
    const collector = collectorWith({ cacheTtlSeconds: 0 });
    collector.register(sourceReturning('outbox', [{ metric: 'outbox_undrained_total', value: 4 }]));
    await collector.refresh();

    const stalled = collectorWith({ cacheTtlSeconds: 0 });
    stalled.register(hangingSource('queue'));
    const pending = stalled.refresh();
    await vi.advanceTimersByTimeAsync(50);
    await pending;

    const scrape = await metricsRegistry.metrics();
    expect(scrape).not.toContain('queue_depth{');
    expect(scrape).not.toContain('outbox_undrained_total');
    expect(scrape).toContain('http_requests_in_flight');
    expect(scrape).toContain('http_request_duration_seconds');
  });

  it('keeps a healthy source when another one fails', async () => {
    const collector = collectorWith({ cacheTtlSeconds: 0 });
    collector.register(
      sourceReturning('queue', [{ metric: 'queue_depth', queue: 'ok', value: 2 }]),
    );
    collector.register({
      sourceName: 'outbox',
      collectSharedState: () => Promise.reject(new Error('connection terminated unexpectedly')),
    });

    await expect(collector.refresh()).resolves.toBeUndefined();

    const scrape = await metricsRegistry.metrics();
    expect(scrape).toContain('queue_depth{queue="ok"} 2');
    expect(scrape).not.toContain('outbox_undrained_total');
  });

  it('drops a non-numeric reading instead of failing the scrape', async () => {
    const collector = collectorWith({ cacheTtlSeconds: 0 });
    collector.register(
      sourceReturning('queue', [
        { metric: 'queue_depth', queue: 'broken', value: Number.NaN },
        { metric: 'queue_depth', queue: 'healthy', value: 8 },
      ]),
    );

    await expect(collector.refresh()).resolves.toBeUndefined();

    const scrape = await metricsRegistry.metrics();
    expect(scrape).toContain('queue_depth{queue="healthy"} 8');
    expect(scrape).not.toContain('queue_depth{queue="broken"');
  });

  it('drops a series that a later pass no longer reports', async () => {
    const collector = collectorWith({ cacheTtlSeconds: 0 });
    collector.register(
      sourceReturning('queue', [{ metric: 'queue_depth', queue: 'gone', value: 5 }]),
    );
    await collector.refresh();

    const emptied = collectorWith({ cacheTtlSeconds: 0 });
    emptied.register(sourceReturning('queue', []));
    await emptied.refresh();

    expect(await metricsRegistry.metrics()).not.toContain('queue_depth{queue="gone"');
  });
});
