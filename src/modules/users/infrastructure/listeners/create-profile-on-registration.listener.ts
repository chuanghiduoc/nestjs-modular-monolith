import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { INTEGRATION_EVENTS, parseIntegrationEvent } from '#contracts/events';
import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { EnsureUserProfileUseCase } from '../../application/ensure-user-profile.use-case';

@Injectable()
@JobHandler(QUEUES.USERS_CREATE_PROFILE)
export class CreateProfileOnRegistrationListener implements JobConsumer {
  private readonly logger = new Logger(CreateProfileOnRegistrationListener.name);

  constructor(private readonly ensureProfile: EnsureUserProfileUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_REGISTERED, job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'users.registered payload did not match the published contract.',
      );
    }

    const created = await this.ensureProfile.execute({
      userId: parsed.data.payload.userId,
      email: parsed.data.payload.email,
    });

    if (!created) {
      this.logger.debug({
        msg: 'profile already existed',
        userId: parsed.data.payload.userId,
      });
    }
  }
}
