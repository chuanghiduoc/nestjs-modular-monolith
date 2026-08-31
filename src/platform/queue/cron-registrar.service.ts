import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { BullMqService } from './bullmq.service';
import { QUEUE_OPTIONS, type QueueModuleOptions } from './queue.options';
import { CRON_SCHEDULES } from './queues';

@Injectable()
export class CronRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronRegistrar.name);

  constructor(
    private readonly queue: BullMqService,
    @Inject(QUEUE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.registerSchedules) {
      return;
    }

    for (const schedule of CRON_SCHEDULES) {
      await this.queue.schedule(schedule.queue, schedule.cron);
    }

    this.logger.log({
      msg: 'cron schedules registered',
      schedules: CRON_SCHEDULES.map((schedule) => `${schedule.queue}@${schedule.cron}`),
    });
  }
}
