import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { authMailPayloadSchema } from '#platform/auth';
import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { SendAuthEmailUseCase } from '../../application/send-auth-email.use-case';

@Injectable()
@JobHandler(QUEUES.MAIL_SEND_AUTH_EMAIL)
export class SendAuthEmailListener implements JobConsumer {
  constructor(private readonly sendAuthEmail: SendAuthEmailUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = authMailPayloadSchema.safeParse(job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'Auth mail payload did not match its schema.',
      );
    }

    await this.sendAuthEmail.execute({
      kind: parsed.data.kind,
      to: parsed.data.to,
      url: parsed.data.url,
      idempotencyKey: parsed.data.tokenDigest,
    });
  }
}
