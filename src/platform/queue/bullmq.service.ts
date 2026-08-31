import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';

import type { JobQueueAdminPort, JobQueuePort, JobScheduleOptions } from '#contracts/ports';
import { isDomainException } from '#shared/errors';

import { QUEUE_OPTIONS, type QueueModuleOptions } from './queue.options';
import { QUEUE_DEFINITIONS, type QueueName } from './queues';

export type JobHandlerFn<TData = unknown> = (job: Job<TData>) => Promise<void>;

const MILLISECONDS_PER_SECOND = 1000;

@Injectable()
export class BullMqService
  implements OnModuleInit, OnModuleDestroy, JobQueuePort, JobQueueAdminPort
{
  private readonly logger = new Logger(BullMqService.name);
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly definitions = new Map(
    QUEUE_DEFINITIONS.map((definition) => [definition.name, definition]),
  );

  // Each Queue opens its own socket. Sharing one client across queues would cut
  // the connection count from one-per-queue to one-per-process, but BullMQ 5
  // bundles ioredis 5 while this project runs ioredis 6 — handing it our client
  // would mean passing an incompatible one. Revisit when the two agree.
  constructor(@Inject(QUEUE_OPTIONS) private readonly options: QueueModuleOptions) {
    for (const definition of QUEUE_DEFINITIONS) {
      this.register(
        definition.name,
        new Queue(definition.name, {
          connection: { url: options.redisUrl, connectionName: options.applicationName },
          defaultJobOptions: {
            attempts: definition.retryLimit + 1,
            backoff: {
              type: definition.retryBackoff ? 'bounded-exponential' : 'fixed',
              delay: definition.retryDelaySeconds * 1000,
              ...(definition.retryBackoff ? { jitter: 0.2 } : {}),
            },
            removeOnFail: {
              age: definition.failedJobRetentionSeconds,
              count: 10_000,
            },
            // A retention of zero means "drop it the moment it succeeds" — the
            // only safe setting for a queue whose payload carries a credential.
            removeOnComplete:
              definition.completedJobRetentionSeconds === 0
                ? true
                : { age: definition.completedJobRetentionSeconds, count: 1000 },
          },
        }),
      );
    }
  }

  /**
   * A Queue is an EventEmitter over its own Redis client, and a connection that
   * drops mid-command reports through it. Without a listener that arrives as an
   * unhandled rejection instead — which is how a clean shutdown ends up failing
   * the process, and how a test run ends up red with every test passing.
   */
  private register(name: QueueName, queue: Queue): void {
    queue.on('error', (error: Error) => {
      this.logger.warn({
        msg: 'bullmq queue connection error',
        queue: name,
        err: describeError(error),
      });
    });
    this.queues.set(name, queue);
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.waitUntilReady()));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => this.closeWorker(worker)));
    await Promise.all([...this.queues.values()].map((queue) => this.closeQueue(queue)));
  }

  work<TData>(queue: QueueName, handler: JobHandlerFn<TData>): Promise<void> {
    const worker = new Worker<TData>(
      queue,
      async (job) => {
        try {
          await handler(job);
        } catch (error) {
          const permanent = isDomainException(error) && error.permanent;
          this.logger[permanent ? 'error' : 'warn']({
            msg: permanent ? 'job failed permanently' : 'job failed and will retry',
            queue,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            err: describeError(error),
          });
          throw error;
        }
      },
      {
        connection: { url: this.options.redisUrl, connectionName: this.options.applicationName },
        concurrency: this.options.concurrency,
        settings: {
          backoffStrategy: (attemptsMade, type) => {
            const definition = this.definitionFor(queue);
            if (type !== 'bounded-exponential') return 0;

            const delay = definition.retryDelaySeconds * 1000 * 2 ** Math.max(0, attemptsMade - 1);

            return Math.min(delay, definition.retryDelayMaxSeconds * 1000);
          },
        },
      },
    );
    worker.on('error', (error) =>
      this.logger.error({ msg: 'bullmq worker error', queue, err: error }),
    );
    worker.on('failed', (job, error) =>
      this.logger.warn({ msg: 'bullmq job failed', queue, jobId: job?.id, err: error }),
    );
    this.workers.push(worker);

    return Promise.resolve();
  }

  async send<TPayload extends object>(
    queue: string,
    data: TPayload,
    options: { startAfterSeconds?: number; singletonKey?: string; singletonSeconds?: number } = {},
  ): Promise<string | null> {
    const instance = this.queueOf(queue);
    const job = await instance.add(queue, data, {
      ...(options.startAfterSeconds === undefined
        ? {}
        : { delay: options.startAfterSeconds * 1000 }),
      ...(options.singletonKey === undefined
        ? {}
        : {
            deduplication: {
              id: options.singletonKey,
              ...(options.singletonSeconds === undefined
                ? {}
                : { ttl: options.singletonSeconds * 1000 }),
            },
          }),
    });

    return job.id ?? null;
  }

  async schedule<TPayload extends object>(
    queue: string,
    cron: string,
    data?: TPayload,
    scheduleOptions?: JobScheduleOptions,
  ): Promise<void> {
    await this.upsertSchedule(queue, { pattern: cron }, data, scheduleOptions);
  }

  /**
   * A fixed-interval schedule. BullMQ owns the timer, so exactly one job exists
   * per queue at a time and there is nothing for a deduplication key to swallow.
   */
  async scheduleEvery<TPayload extends object>(
    queue: string,
    everySeconds: number,
    data?: TPayload,
    scheduleOptions?: JobScheduleOptions,
  ): Promise<void> {
    await this.upsertSchedule(
      queue,
      { every: everySeconds * MILLISECONDS_PER_SECOND },
      data,
      scheduleOptions,
    );
  }

  /**
   * The repeat key intentionally excludes the cron expression or interval.
   * Folding the schedule into its own key means editing a cron leaves the old
   * scheduler in place — both fire, forever, and both report success.
   */
  private async upsertSchedule<TPayload extends object>(
    queue: string,
    repeat: { pattern: string } | { every: number },
    data: TPayload | undefined,
    scheduleOptions: JobScheduleOptions | undefined,
  ): Promise<void> {
    const instance = this.queueOf(queue);
    const key = scheduleOptions?.repeatKey ?? `schedule:${queue}`;

    await this.removeStaleSchedulers(instance, key);
    await instance.upsertJobScheduler(key, repeat, { name: queue, data: data ?? {} });
  }

  /**
   * Drops schedulers this queue no longer declares — including the
   * `schedule:<queue>:<cron>` keys written by earlier versions of this service.
   */
  private async removeStaleSchedulers(instance: Queue, keep: string): Promise<void> {
    const existing: readonly unknown[] = await instance.getJobSchedulers();

    for (const scheduler of existing) {
      const id = schedulerKeyOf(scheduler);

      if (id === undefined || id === keep || !id.startsWith(`schedule:${instance.name}`)) {
        continue;
      }

      await instance.removeJobScheduler(id);
      this.logger.log({ msg: 'removed a stale job scheduler', queue: instance.name, key: id });
    }
  }

  async ping(): Promise<boolean> {
    const instance = this.queues.values().next().value;
    if (instance === undefined) return false;
    await instance.getJobCounts('wait');

    return true;
  }

  getQueue(queue: QueueName): Queue {
    const instance = this.queues.get(queue);
    if (instance === undefined) throw new Error(`Queue is not registered: ${queue}`);

    return instance;
  }

  private queueOf(queue: string): Queue {
    const definition = QUEUE_DEFINITIONS.find((item) => item.name === queue);
    if (definition === undefined) throw new Error(`Queue is not registered: ${queue}`);

    return this.getQueue(definition.name);
  }

  private definitionFor(queue: QueueName): (typeof QUEUE_DEFINITIONS)[number] {
    const definition = this.definitions.get(queue);
    if (definition === undefined) throw new Error(`Queue is not registered: ${queue}`);

    return definition;
  }

  private async closeWorker(worker: Worker): Promise<void> {
    if (await this.completesWithin(worker.close())) return;

    this.logger.warn({ msg: 'forcing BullMQ worker shutdown', queue: worker.name });
    // The forced close drops the socket under whatever was still in flight, so
    // it can reject on its own. It is already the fallback path; letting it
    // throw would abort the shutdown of everything queued behind it.
    await this.quietly(() => worker.close(true), 'forced worker close', worker.name);
  }

  private async closeQueue(queue: Queue): Promise<void> {
    if (await this.completesWithin(queue.close())) return;

    this.logger.warn({
      msg: 'disconnecting BullMQ queue after shutdown deadline',
      queue: queue.name,
    });
    await this.quietly(() => queue.disconnect(), 'queue disconnect', queue.name);
  }

  private async quietly(
    operation: () => Promise<void>,
    step: string,
    queue: string,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logger.warn({ msg: `${step} failed`, queue, err: describeError(error) });
    }
  }

  private async completesWithin(operation: Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The loser of this race is abandoned. When the deadline wins, close() is
    // still in flight and ioredis rejects it as the socket drops — an
    // unhandled rejection that fails the process even though disconnect()
    // below is the intended fallback. Marking it handled changes nothing on
    // the fast path: a close() that rejects before the deadline still
    // propagates through the race.
    operation.catch(() => undefined);
    try {
      return await Promise.race([
        operation.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), this.options.shutdownTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async deleteAllJobs(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.obliterate({ force: true })));
  }

  async findJobs(queue: string): Promise<Job[]> {
    return this.queueOf(queue).getJobs(['wait', 'delayed', 'active', 'completed', 'failed']);
  }

  async offWork(queue: QueueName): Promise<void> {
    const matches = this.workers.filter((worker) => worker.name === queue);
    await Promise.all(matches.map((worker) => worker.close()));
    for (const worker of matches) this.workers.splice(this.workers.indexOf(worker), 1);
  }

  async pause(queue: string): Promise<void> {
    await this.queueOf(queue).pause();
  }

  async resume(queue: string): Promise<void> {
    await this.queueOf(queue).resume();
  }

  async retryFailed(queue: string, limit = 100): Promise<number> {
    if (limit <= 0) return 0;

    const jobs = await this.queueOf(queue).getJobs(['failed'], 0, limit - 1);
    for (const job of jobs) await job.retry('failed');

    return jobs.length;
  }

  async remove(queue: string, jobId: string): Promise<void> {
    const job = await this.queueOf(queue).getJob(jobId);
    await job?.remove();
  }
}

function schedulerKeyOf(scheduler: unknown): string | undefined {
  if (typeof scheduler !== 'object' || scheduler === null || !('key' in scheduler)) {
    return undefined;
  }

  const { key } = scheduler;

  return typeof key === 'string' ? key : undefined;
}

function describeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) };
}
