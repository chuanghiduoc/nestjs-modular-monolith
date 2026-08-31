import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import { BullMqService } from './bullmq.service';
import { JOB_HANDLER_QUEUE, type JobConsumer } from './job-handler.decorator';
import { QUEUE_OPTIONS, type QueueModuleOptions } from './queue.options';
import { type QueueName, QUEUES } from './queues';

@Injectable()
export class QueueRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueRegistrar.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly queue: BullMqService,
    @Inject(QUEUE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.startWorkers) {
      return;
    }

    const handlers = discoverHandlers(this.discovery.getProviders());

    for (const handler of handlers) {
      await this.queue.work(handler.queue, (job) => handler.consumer.handle(job));
    }

    this.logger.log({
      msg: 'queue handlers registered',
      queues: handlers.map((handler) => handler.queue),
    });
  }
}

interface DiscoveredHandler {
  readonly queue: QueueName;
  readonly consumer: JobConsumer;
}

function discoverHandlers(
  providers: readonly { metatype?: unknown; instance?: unknown }[],
): DiscoveredHandler[] {
  const handlers: DiscoveredHandler[] = [];
  const handlersByQueue = new Map<QueueName, string>();

  for (const wrapper of providers) {
    const queue = readQueueMetadata(wrapper.metatype);
    if (queue === undefined) continue;

    const handlerName = describeHandler(wrapper.metatype);
    if (!isJobConsumer(wrapper.instance)) {
      throw new Error(`BullMQ handler ${handlerName} for ${queue} has no usable handle method.`);
    }

    const previous = handlersByQueue.get(queue);
    if (previous !== undefined) {
      throw new Error(
        `Multiple BullMQ handlers registered for ${queue}: ${previous} and ${handlerName}.`,
      );
    }

    handlersByQueue.set(queue, handlerName);
    handlers.push({ queue, consumer: wrapper.instance });
  }

  return handlers;
}

function describeHandler(metatype: unknown): string {
  return typeof metatype === 'function' && metatype.name.length > 0 ? metatype.name : '<anonymous>';
}

function readQueueMetadata(metatype: unknown): QueueName | undefined {
  if (typeof metatype !== 'function') {
    return undefined;
  }

  const value: unknown = Reflect.getMetadata(JOB_HANDLER_QUEUE, metatype);

  return typeof value === 'string' && isQueueName(value) ? value : undefined;
}

function isQueueName(value: string): value is QueueName {
  return Object.values(QUEUES).some((queue) => queue === value);
}

function isJobConsumer(instance: unknown): instance is JobConsumer {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    'handle' in instance &&
    typeof instance.handle === 'function'
  );
}
