import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { INTEGRATION_EVENTS, parseIntegrationEvent } from '#contracts/events';
import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { PurgeUserFilesUseCase } from '../../application/purge-user-files.use-case';

@Injectable()
@JobHandler(QUEUES.UPLOAD_PURGE_USER_FILES)
export class PurgeFilesOnUserDeletedListener implements JobConsumer {
  private readonly logger = new Logger(PurgeFilesOnUserDeletedListener.name);

  constructor(private readonly purge: PurgeUserFilesUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_DELETED, job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'users.deleted payload did not match the published contract.',
      );
    }

    const purged = await this.purge.execute(parsed.data.payload.userId);

    if (purged > 0) {
      this.logger.log({ msg: 'purged files for deleted user', purged });
    }
  }
}
