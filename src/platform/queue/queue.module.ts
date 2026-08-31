import { type DynamicModule, Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { EVENT_PUBLISHER, JOB_QUEUE, JOB_QUEUE_ADMIN } from '#contracts/ports';

import { BullMqService } from './bullmq.service';
import { BullMqEventPublisher } from './bullmq-event-publisher';
import { CronRegistrar } from './cron-registrar.service';
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  QUEUE_OPTIONS,
  type QueueModuleOptions,
} from './queue.options';
import { QueueMetricsSource } from './queue-metrics.source';
import { QueueRegistrar } from './queue-registrar.service';

export interface QueueModuleInput {
  readonly redisUrl: string;
  readonly applicationName: string;
  readonly concurrency: number;
  readonly startWorkers: boolean;
  readonly registerSchedules?: boolean;
  readonly shutdownTimeoutMs?: number;
}

@Global()
@Module({})
export class QueueModule {
  static forRoot(input: QueueModuleInput): DynamicModule {
    const options: QueueModuleOptions = {
      redisUrl: input.redisUrl,
      applicationName: input.applicationName,
      concurrency: input.concurrency,
      startWorkers: input.startWorkers,
      registerSchedules: input.registerSchedules ?? false,
      shutdownTimeoutMs: input.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    };

    return {
      module: QueueModule,

      imports: [DiscoveryModule],
      providers: [
        { provide: QUEUE_OPTIONS, useValue: options },
        BullMqService,
        { provide: JOB_QUEUE, useExisting: BullMqService },
        { provide: JOB_QUEUE_ADMIN, useExisting: BullMqService },
        { provide: EVENT_PUBLISHER, useClass: BullMqEventPublisher },
        QueueRegistrar,
        CronRegistrar,
        QueueMetricsSource,
      ],
      exports: [BullMqService, JOB_QUEUE, JOB_QUEUE_ADMIN, EVENT_PUBLISHER, QueueMetricsSource],
    };
  }
}
