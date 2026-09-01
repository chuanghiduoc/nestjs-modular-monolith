# Outbox Relay Capacity

Measured with `pnpm bench:outbox [count]`, which drains a synthetic backlog
through the real relay against throwaway testcontainers. The benchmark is
excluded from CI: it only runs when `OUTBOX_BENCH=1` is set, which the script
does for you.

## Measured baseline

Environment: local Docker (postgres:18-alpine, redis:8-alpine), single drainer,
production-default options, one subscriber queue per event
(`organizations.archived`).

| Metric           | Value         |
| ---------------- | ------------- |
| Backlog size     | 2,000 events  |
| `drainBatchSize` | 100           |
| Wall time        | 7.49 s        |
| Relay throughput | ~267 events/s |

Re-run the benchmark on hardware that resembles production before trusting any
number here for capacity planning; a laptop measurement is a floor for
reasoning, not a promise.

## What actually caps sustained throughput

The relay itself moved ~267 events/s, but the scheduler cadence binds first.
One scheduled run drains at most `MAX_PASSES_PER_RUN (20) × drainBatchSize`
rows, and runs start every `OUTBOX_DRAIN_INTERVAL_SECONDS`. At the defaults
(batch 100, interval 10 s) the configured ceiling is:

```text
20 passes × 100 rows / 10 s = 200 events/s sustained
```

A steady publish rate above that ceiling grows the backlog without bound even
though the relay has headroom. Raise `OUTBOX_DRAIN_BATCH_SIZE` first — it
multiplies the per-run budget without adding scheduling pressure.

## Tuning knobs

| Knob                            | Where                                                    | Default | Effect                                                            |
| ------------------------------- | -------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `OUTBOX_DRAIN_BATCH_SIZE`       | env (`env.scheduler.ts`, max 1000)                       | 100     | Rows claimed per pass. The main throughput lever.                 |
| `OUTBOX_DRAIN_INTERVAL_SECONDS` | env (`env.scheduler.ts`, max 300; production caps at 60) | 10      | Worst-case event latency when the backlog is empty.               |
| `MAX_PASSES_PER_RUN`            | `outbox-drain.service.ts`                                | 20      | Passes one run may take before yielding the worker.               |
| `CLAIM_LEASE_SECONDS`           | `outbox-drain.service.ts`                                | 120     | How long a crashed drainer blocks redelivery of its claimed rows. |
| `MAX_RELAY_ATTEMPTS`            | `outbox-drain.service.ts`                                | 10      | Attempts before a row is quarantined (dead-lettered).             |
| `OUTBOX_RETENTION_DAYS`         | env (`env.scheduler.ts`)                                 | 14      | How long drained and dead-lettered rows survive before pruning.   |
| `PRUNE_BATCH_SIZE`              | `outbox-drain.service.ts`                                | 5000    | Rows deleted per prune pass, bounding lock time.                  |

Claiming uses `FOR UPDATE SKIP LOCKED`, so a second drainer (another worker
replica) adds throughput near-linearly until Postgres or Redis saturates;
duplicate delivery is prevented by the claim token, not by having one drainer.

## Watching it in production

`OutboxDrainService.countUndrained()` and `countQuarantined()` feed
`outbox-metrics.source.ts`. Alert on a growing undrained count across several
intervals — that is the signal the publish rate has passed the configured
ceiling — and on any nonzero quarantined count, which means an event failed
its contract or exhausted its attempts.
