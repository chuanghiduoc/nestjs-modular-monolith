import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { type JobConsumer, JobHandler, QUEUES } from '#platform/queue';
import { DomainErrors, ERROR_CODES } from '#shared/errors';
import { sha256Hex } from '#shared/util';

import { SendInvitationEmailUseCase } from '../../application/send-invitation-email.use-case';

const invitationJobSchema = z.object({
  email: z.email(),
  organizationId: z.uuid({ version: 'v7' }),
  organizationName: z.string().min(1),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

@Injectable()
@JobHandler(QUEUES.ORGANIZATION_SEND_INVITATION)
export class SendInvitationEmailListener implements JobConsumer {
  constructor(private readonly sendInvitation: SendInvitationEmailUseCase) {}

  async handle(job: Job<unknown>): Promise<void> {
    const parsed = invitationJobSchema.safeParse(job.data);

    if (!parsed.success) {
      throw DomainErrors.validation(
        ERROR_CODES.VALIDATION_FAILED,
        'Invitation mail payload did not match its schema.',
      );
    }

    await this.sendInvitation.execute({
      to: parsed.data.email,
      organizationName: parsed.data.organizationName,
      token: parsed.data.token,
      expiresAt: new Date(parsed.data.expiresAt),
      // Derived, never the token itself: an idempotency key travels into
      // provider logs and headers.
      idempotencyKey: sha256Hex(parsed.data.token),
    });
  }
}
