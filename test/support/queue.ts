import type { Job } from 'bullmq';

import { BullMqService } from '#platform/queue';
import { isDomainException } from '#shared/errors';
import { newId } from '#shared/util';

const POLL_INTERVAL_MS = 25;
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;

/**
 * The shutdown deadline is deliberately generous here.
 *
 * When it expires, the service falls back to `disconnect()` while `close()` is
 * still in flight, and ioredis then rejects whatever was on the wire with
 * "Connection is closed." — an unhandled rejection that fails the whole run with
 * every test passing. A container-backed suite closes sixteen queues at once on
 * a shared CI runner, so five seconds is a deadline it can genuinely miss.
 * Production keeps its own, much shorter, deadline.
 */
const TEST_SHUTDOWN_TIMEOUT_MS = 30_000;

export function createTestQueue(redisUrl: string, concurrency = 1): BullMqService {
  return new BullMqService({
    redisUrl,
    applicationName: 'integration-test',
    concurrency,
    startWorkers: true,
    registerSchedules: false,
    shutdownTimeoutMs: TEST_SHUTDOWN_TIMEOUT_MS,
  });
}

export function makeJob<TData>(name: string, data: TData, id: string = newId()): Job<TData> {
  return { id, name, data } as Job<TData>;
}

export interface JobResultLike {
  readonly status: string;
}

type SingleHandler = (job: Job<unknown>) => Promise<void>;

export type BatchHandler = (jobs: readonly Job<unknown>[]) => Promise<readonly JobResultLike[]>;

export function readBatchHandler(calls: readonly unknown[][]): BatchHandler {
  const handler = calls
    .at(-1)
    ?.find((value): value is SingleHandler => typeof value === 'function');
  if (typeof handler !== 'function') throw new Error('BullMQ worker handler was not captured');

  return async (jobs) =>
    Promise.all(
      jobs.map(async (job) => {
        try {
          await handler(job);

          return { status: 'completed' };
        } catch (error) {
          return { status: isDomainException(error) && error.permanent ? 'deadletter' : 'failed' };
        }
      }),
    );
}

export interface WaitForOptions {
  readonly timeoutMs?: number;
  readonly description?: string;
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: WaitForOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out after ${String(timeoutMs)}ms waiting for ${options.description ?? 'a condition'}`,
      );
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
