import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';

import { ExpireStaleUploadsUseCase } from '../../application/expire-stale-uploads.use-case';

@Injectable()
@JobHandler(QUEUES.UPLOAD_SWEEP_UNCONFIRMED)
export class SweepUnconfirmedUploadsListener implements JobConsumer {
  private readonly logger = new Logger(SweepUnconfirmedUploadsListener.name);

  constructor(private readonly expire: ExpireStaleUploadsUseCase) {}

  async handle(_job: Job<unknown>): Promise<void> {
    const expired = await this.expire.execute();

    if (expired > 0) {
      this.logger.log({ msg: 'expired unconfirmed uploads', expired });
    }
  }
}
