import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds by route template, method and status.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: DURATION_BUCKETS_SECONDS,
  registers: [metricsRegistry],
});

export const httpRequestsInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests currently being served by this replica.',
  registers: [metricsRegistry],
});

export const queueOldestJobAge = new Gauge({
  name: 'queue_oldest_job_age_seconds',
  help: 'Age of the oldest queued job, computed at scrape time.',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Jobs waiting in a queue, computed at scrape time.',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const queueDeadletterDepth = new Gauge({
  name: 'queue_deadletter_depth',
  help: 'Jobs that gave up permanently, computed at scrape time.',
  labelNames: ['queue'] as const,
  registers: [metricsRegistry],
});

export const OUTBOX_UNDRAINED_METRIC = 'outbox_undrained_total';
export const OUTBOX_QUARANTINED_METRIC = 'outbox_quarantined_total';

export const outboxUndrained = new Gauge({
  name: OUTBOX_UNDRAINED_METRIC,
  help: 'Outbox rows not yet turned into jobs, computed at scrape time.',
  registers: [],
});

export const outboxQuarantined = new Gauge({
  name: OUTBOX_QUARANTINED_METRIC,
  help: 'Outbox rows quarantined for operator review, computed at scrape time.',
  registers: [],
});

let defaultMetricsCollected = false;

export function collectNodeDefaultMetrics(): void {
  if (defaultMetricsCollected) {
    return;
  }

  defaultMetricsCollected = true;
  collectDefaultMetrics({ register: metricsRegistry });
}
