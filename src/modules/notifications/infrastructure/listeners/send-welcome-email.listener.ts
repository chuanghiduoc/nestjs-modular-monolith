import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { INTEGRATION_EVENTS, parseIntegrationEvent } from '#contracts/events';
import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { SendWelcomeEmailUseCase } from '../../application/send-welcome-email.use-case';

@Injectable()
@JobHandler(QUEUES.MAIL_SEND_WELCOME)
export class SendWelcomeEmailListener implements JobConsumer {
  constructor(private readonly sendWelcome: SendWelcomeEmailUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = parseIntegrationEvent(INTEGRATION_EVENTS.USER_EMAIL_VERIFIED, job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'users.email_verified payload did not match the published contract.',
      );
    }

    await this.sendWelcome.execute({
      userId: parsed.data.payload.userId,
      email: parsed.data.payload.email,
      idempotencyKey: parsed.data.eventId,
    });
  }
}
