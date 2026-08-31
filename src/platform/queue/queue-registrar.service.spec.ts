import type { DiscoveryService } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { BullMqService } from './bullmq.service';
import { JOB_HANDLER_QUEUE } from './job-handler.decorator';
import type { QueueModuleOptions } from './queue.options';
import { QueueRegistrar } from './queue-registrar.service';
import { QUEUES } from './queues';

import 'reflect-metadata';

const OPTIONS: QueueModuleOptions = {
  redisUrl: 'redis://localhost:6379',
  applicationName: 'test-worker',
  concurrency: 1,
  startWorkers: true,
  registerSchedules: false,
  shutdownTimeoutMs: 1_000,
};

interface HandlerInstance {
  handle(): Promise<void>;
}

interface HandlerConstructor {
  new (): HandlerInstance;
  readonly name: string;
}

interface HandlerProvider {
  readonly metatype: HandlerConstructor;
  readonly instance: HandlerInstance;
}

class FirstHandler {
  handle(): Promise<void> {
    return Promise.resolve();
  }
}

class SecondHandler {
  handle(): Promise<void> {
    return Promise.resolve();
  }
}

describe('QueueRegistrar', () => {
  it('registers each discovered handler once', async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const registrar = createRegistrar(
      [{ metatype: FirstHandler, instance: new FirstHandler() }],
      work,
    );

    await registrar.onApplicationBootstrap();

    expect(work).toHaveBeenCalledTimes(1);
    expect(work.mock.calls[0]?.[0]).toBe(QUEUES.USERS_CREATE_PROFILE);
  });

  it('fails bootstrap when two handlers claim the same queue', async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const registrar = createRegistrar(
      [
        { metatype: FirstHandler, instance: new FirstHandler() },
        { metatype: SecondHandler, instance: new SecondHandler() },
      ],
      work,
    );

    Reflect.defineMetadata(JOB_HANDLER_QUEUE, QUEUES.USERS_CREATE_PROFILE, FirstHandler);
    Reflect.defineMetadata(JOB_HANDLER_QUEUE, QUEUES.USERS_CREATE_PROFILE, SecondHandler);

    await expect(registrar.onApplicationBootstrap()).rejects.toThrow(
      'Multiple BullMQ handlers registered',
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('fails bootstrap before starting workers when a decorated provider is malformed', async () => {
    const work = vi.fn().mockResolvedValue(undefined);
    const registrar = createRegistrar([{ metatype: FirstHandler, instance: {} }], work);

    await expect(registrar.onApplicationBootstrap()).rejects.toThrow('has no usable handle method');
    expect(work).not.toHaveBeenCalled();
  });
});

function createRegistrar(
  providers: readonly (
    HandlerProvider | { readonly metatype: HandlerConstructor; readonly instance: object }
  )[],
  work: ReturnType<typeof vi.fn>,
): QueueRegistrar {
  Reflect.defineMetadata(JOB_HANDLER_QUEUE, QUEUES.USERS_CREATE_PROFILE, FirstHandler);

  const discovery = {
    getProviders: () => providers,
  } as unknown as DiscoveryService;
  const queue = { work } as unknown as BullMqService;

  return new QueueRegistrar(discovery, queue, OPTIONS);
}
