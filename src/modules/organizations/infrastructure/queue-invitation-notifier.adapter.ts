import { Inject, Injectable } from '@nestjs/common';

import { JOB_QUEUE, type JobQueuePort } from '#contracts/ports';
import { QUEUES } from '#platform/queue';

import type { InvitationNotice, InvitationNotifierPort } from '../domain/invitation-notifier.port';
import { hashInvitationToken } from '../domain/organization-invitation';

const INVITATION_DEDUP_SECONDS = 300;

/**
 * The invitation link goes out through the queue rather than the outbox. The
 * outbox is durable by design and keeps its rows for the retention window — the
 * wrong home for a bearer token. A job carries it just long enough to be sent,
 * and this queue drops completed jobs immediately.
 */
@Injectable()
export class QueueInvitationNotifier implements InvitationNotifierPort {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueuePort) {}

  async sendInvitation(notice: InvitationNotice): Promise<void> {
    await this.queue.send(
      QUEUES.ORGANIZATION_SEND_INVITATION,
      {
        email: notice.email,
        organizationId: notice.organizationId,
        organizationName: notice.organizationName,
        token: notice.token,
        expiresAt: notice.expiresAt.toISOString(),
      },
      {
        singletonKey: `invitation:${hashInvitationToken(notice.token)}`,
        singletonSeconds: INVITATION_DEDUP_SECONDS,
      },
    );
  }
}
