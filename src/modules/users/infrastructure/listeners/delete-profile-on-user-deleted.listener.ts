import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { INTEGRATION_EVENTS, parseIntegrationEvent } from '#contracts/events';
import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { DeleteUserProfileUseCase } from '../../application/delete-user-profile.use-case';

@Injectable()
@JobHandler(QUEUES.USERS_DELETE_PROFILE)
export class DeleteProfileOnUserDeletedListener implements JobConsumer {
  private readonly logger = new Logger(DeleteProfileOnUserDeletedListener.name);

  constructor(private readonly deleteProfile: DeleteUserProfileUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_DELETED, job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'users.deleted payload did not match the published contract.',
      );
    }

    const deleted = await this.deleteProfile.execute(parsed.data.payload.userId);

    if (!deleted) {
      this.logger.debug({ msg: 'no profile to delete', userId: parsed.data.payload.userId });
    }
  }
}
