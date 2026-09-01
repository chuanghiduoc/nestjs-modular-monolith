import type { InvitationRepository } from '../../../src/modules/organizations/domain/invitation.repository';
import { OrganizationInvitation } from '../../../src/modules/organizations/domain/organization-invitation';
import type { TransactionParticipant } from './in-memory-unit-of-work';
import { type JournalOptions, TestJournal } from './journal';

export class InMemoryInvitationRepository implements InvitationRepository, TransactionParticipant {
  readonly journal: TestJournal;

  private rows = new Map<string, OrganizationInvitation>();

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  snapshot(): () => void {
    const captured = new Map(this.rows);

    return () => {
      this.rows = captured;
    };
  }

  seed(invitation: OrganizationInvitation): void {
    this.rows.set(invitation.id, invitation);
  }

  rowOf(id: string): OrganizationInvitation | null {
    return this.rows.get(id) ?? null;
  }

  save(invitation: OrganizationInvitation): Promise<void> {
    this.rows.set(invitation.id, invitation);
    this.journal.record('invitations', 'save', invitation.id);

    return Promise.resolve();
  }

  findPendingByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null> {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.tokenHash === tokenHash && candidate.acceptedAt === null,
    );

    return Promise.resolve(row ?? null);
  }

  markAccepted(id: string, acceptedAt: Date): Promise<boolean> {
    const row = this.rows.get(id);

    if (row?.acceptedAt !== null) {
      return Promise.resolve(false);
    }

    this.rows.set(
      id,
      OrganizationInvitation.rehydrate({
        id: row.id,
        organizationId: row.organizationId,
        email: row.email,
        role: row.role,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        acceptedAt,
        createdAt: row.createdAt,
      }),
    );
    this.journal.record('invitations', 'markAccepted', id);

    return Promise.resolve(true);
  }

  listPending(organizationId: string, now: Date): Promise<readonly OrganizationInvitation[]> {
    const pending = [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.acceptedAt === null &&
          row.expiresAt.getTime() > now.getTime(),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    return Promise.resolve(pending);
  }

  revoke(organizationId: string, invitationId: string): Promise<boolean> {
    const row = this.rows.get(invitationId);

    if (row?.organizationId !== organizationId || row.acceptedAt !== null) {
      return Promise.resolve(false);
    }

    this.rows.delete(invitationId);
    this.journal.record('invitations', 'revoke', invitationId);

    return Promise.resolve(true);
  }
}
