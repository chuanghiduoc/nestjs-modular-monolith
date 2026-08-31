export interface InvitationNotice {
  readonly email: string;
  readonly organizationId: string;
  readonly organizationName: string;

  /**
   * The one-time secret, held only for as long as it takes to compose the
   * message. It is never written to the outbox and never stored beside its own
   * digest.
   */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface InvitationNotifierPort {
  sendInvitation(notice: InvitationNotice): Promise<void>;
}

export const INVITATION_NOTIFIER = Symbol('INVITATION_NOTIFIER');
