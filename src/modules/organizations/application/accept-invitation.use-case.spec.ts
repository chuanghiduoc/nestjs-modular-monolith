import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import {
  InMemoryInvitationRepository,
  InMemoryOrganizationRepository,
  InMemoryUnitOfWork,
  TestJournal,
} from '../../../../test/support/in-memory';
import { Organization } from '../domain/organization';
import { OrganizationInvitation } from '../domain/organization-invitation';
import { AcceptInvitationUseCase } from './accept-invitation.use-case';

const USER_ID = newId();
const INVITEE_EMAIL = 'alice@example.com';

function harness() {
  const journal = new TestJournal();
  const organizations = new InMemoryOrganizationRepository({ journal });
  const invitations = new InMemoryInvitationRepository({ journal });
  const uow = new InMemoryUnitOfWork({ journal, participants: [organizations, invitations] });
  const organization = Organization.rehydrate({
    id: newId(),
    slug: 'acme',
    name: 'Acme',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
  });
  organizations.seedOrganization(organization);

  return {
    journal,
    organizations,
    invitations,
    organization,
    useCase: new AcceptInvitationUseCase(organizations, invitations, uow),
  };
}

type Harness = ReturnType<typeof harness>;

function issueInvitation(
  target: Harness,
  input: {
    email?: string;
    role?: 'admin' | 'member' | 'viewer';
    now?: Date;
    ttlDays?: number;
  } = {},
): { invitation: OrganizationInvitation; token: string } {
  const issued = OrganizationInvitation.issue({
    organizationId: target.organization.id,
    email: input.email ?? INVITEE_EMAIL,
    role: input.role ?? 'admin',
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.ttlDays === undefined ? {} : { ttlDays: input.ttlDays }),
  });
  target.invitations.seed(issued.invitation);

  return issued;
}

describe('AcceptInvitationUseCase', () => {
  it('claims the invitation before adding the member, inside one transaction', async () => {
    const target = harness();
    const { token } = issueInvitation(target);

    const accepted = await target.useCase.execute({
      token,
      userId: USER_ID,
      userEmail: ' Alice@Example.COM ',
    });

    expect(accepted).toEqual({ organizationId: target.organization.id, role: 'admin' });
    expect(target.organizations.membershipOf(target.organization.id, USER_ID)).toMatchObject({
      role: 'admin',
    });
    expect(target.journal.trail()).toEqual([
      'uow:begin',
      'invitations:markAccepted',
      'organizations:addMember',
      'uow:commit',
    ]);
  });

  it('answers an unknown token with the same not-found as a spent or expired one', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      target.useCase.execute({ token: 'no-such-token', userId: USER_ID, userEmail: INVITEE_EMAIL }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_NOT_FOUND);
  });

  it('refuses an expired invitation without touching membership state', async () => {
    const target = harness();
    const { token } = issueInvitation(target, {
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlDays: 1,
    });

    const error = await captureDomainError(() =>
      target.useCase.execute({ token, userId: USER_ID, userEmail: INVITEE_EMAIL }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_NOT_FOUND);
    expect(target.organizations.membershipOf(target.organization.id, USER_ID)).toBeNull();
    expect(target.journal.trail()).toEqual([]);
  });

  it('refuses a token that was already redeemed', async () => {
    const target = harness();
    const { invitation, token } = issueInvitation(target);
    await target.invitations.markAccepted(invitation.id, new Date());

    const error = await captureDomainError(() =>
      target.useCase.execute({ token, userId: USER_ID, userEmail: INVITEE_EMAIL }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_NOT_FOUND);
  });

  it('refuses a caller whose address differs from the one on the invitation', async () => {
    const target = harness();
    const { token } = issueInvitation(target);

    const error = await captureDomainError(() =>
      target.useCase.execute({ token, userId: USER_ID, userEmail: 'mallory@example.com' }),
    );

    expect(error.kind).toBe('forbidden');
    expect(target.organizations.membershipOf(target.organization.id, USER_ID)).toBeNull();
  });

  it('loses the claim race cleanly: no membership, and the transaction rolls back', async () => {
    const target = harness();
    const { token } = issueInvitation(target);
    target.invitations.markAccepted = () => Promise.resolve(false);

    const error = await captureDomainError(() =>
      target.useCase.execute({ token, userId: USER_ID, userEmail: INVITEE_EMAIL }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_NOT_FOUND);
    expect(target.organizations.membershipOf(target.organization.id, USER_ID)).toBeNull();
    expect(target.journal.trail()).toContain('uow:rollback');
  });

  it('consumes a second invitation for an existing member without duplicating membership', async () => {
    const target = harness();
    target.organizations.seedMember({
      organizationId: target.organization.id,
      userId: USER_ID,
      role: 'member',
    });
    const { invitation, token } = issueInvitation(target, { role: 'viewer' });

    const accepted = await target.useCase.execute({
      token,
      userId: USER_ID,
      userEmail: INVITEE_EMAIL,
    });

    expect(accepted.role).toBe('viewer');
    expect(target.invitations.rowOf(invitation.id)?.acceptedAt).not.toBeNull();
    expect(target.organizations.membershipOf(target.organization.id, USER_ID)).toMatchObject({
      role: 'member',
    });
  });
});
