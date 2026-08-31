import { type DynamicModule, Module } from '@nestjs/common';

import { BullMqEventPublisher } from '#platform/queue';

import { OUTBOX_OPTIONS, type OutboxModuleOptions } from './outbox.options';
import { OutboxDrainService } from './outbox-drain.service';
import { OutboxMetricsSource } from './outbox-metrics.source';

export type MessagingModuleInput = OutboxModuleOptions;

@Module({})
export class MessagingModule {
  static forRoot(input: MessagingModuleInput): DynamicModule {
    return {
      module: MessagingModule,
      providers: [
        { provide: OUTBOX_OPTIONS, useValue: input },

        BullMqEventPublisher,
        OutboxDrainService,
        OutboxMetricsSource,
      ],
      exports: [OutboxDrainService, OutboxMetricsSource],
    };
  }
}
