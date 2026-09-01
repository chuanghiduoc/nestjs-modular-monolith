import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import {
  InMemoryInvitationRepository,
  InMemoryOrganizationRepository,
  TestJournal,
} from '../../../../test/support/in-memory';
import type { InvitationNotice } from '../domain/invitation-notifier.port';
import { Organization } from '../domain/organization';
import { hashInvitationToken } from '../domain/organization-invitation';
import { InviteMemberUseCase } from './invite-member.use-case';

function harness(options: { failDelivery?: boolean } = {}) {
  const journal = new TestJournal();
  const organizations = new InMemoryOrganizationRepository({ journal });
  const invitations = new InMemoryInvitationRepository({ journal });
  const notices: InvitationNotice[] = [];
  const notifier = {
    sendInvitation: (notice: InvitationNotice): Promise<void> => {
      journal.record('notifier', 'sendInvitation', notice.email);
      if (options.failDelivery === true) {
        return Promise.reject(new Error('smtp unreachable'));
      }
      notices.push(notice);

      return Promise.resolve();
    },
  };
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
    notices,
    organization,
    useCase: new InviteMemberUseCase(organizations, invitations, notifier),
  };
}

describe('InviteMemberUseCase', () => {
  it('persists the invitation before handing the one-time token to the notifier', async () => {
    const target = harness();

    const view = await target.useCase.execute({
      organizationId: target.organization.id,
      email: 'bob@example.com',
      role: 'member',
    });

    const stored = target.invitations.rowOf(view.id);
    expect(stored).not.toBeNull();
    expect(target.notices).toHaveLength(1);
    expect(target.notices[0]).toMatchObject({
      email: 'bob@example.com',
      organizationId: target.organization.id,
      organizationName: 'Acme',
    });
    expect(hashInvitationToken(target.notices[0]?.token ?? '')).toBe(stored?.tokenHash);
    expect(target.journal.trail()).toEqual(['invitations:save', 'notifier:sendInvitation']);
  });

  it('keeps the stored invitation usable when delivery fails, so it can be resent', async () => {
    const target = harness({ failDelivery: true });

    await expect(
      target.useCase.execute({
        organizationId: target.organization.id,
        email: 'bob@example.com',
        role: 'member',
      }),
    ).rejects.toThrow('smtp unreachable');

    expect(target.journal.trail()).toEqual(['invitations:save', 'notifier:sendInvitation']);
  });

  it('answers an unknown organization with not-found', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      target.useCase.execute({ organizationId: newId(), email: 'bob@example.com', role: 'member' }),
    );

    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_NOT_FOUND);
  });

  it('treats an archived organization as not-found for new invitations', async () => {
    const target = harness();
    await target.organizations.setArchivedAt(target.organization.id, new Date());

    const error = await captureDomainError(() =>
      target.useCase.execute({
        organizationId: target.organization.id,
        email: 'bob@example.com',
        role: 'member',
      }),
    );

    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_NOT_FOUND);
  });

  it('refuses to invite an existing member, matching the address case-insensitively', async () => {
    const target = harness();
    target.organizations.seedMember({
      organizationId: target.organization.id,
      userId: newId(),
      email: 'bob@example.com',
      role: 'member',
    });

    const error = await captureDomainError(() =>
      target.useCase.execute({
        organizationId: target.organization.id,
        email: ' Bob@Example.COM ',
        role: 'member',
      }),
    );

    expect(error.kind).toBe('conflict');
    expect(target.notices).toEqual([]);
  });

  it('refuses to hand out ownership by invitation', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      target.useCase.execute({
        organizationId: target.organization.id,
        email: 'bob@example.com',
        role: 'owner',
      }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_INVALID);
    expect(target.notices).toEqual([]);
  });

  it('rejects an address no invitation can reach, and stores nothing', async () => {
    const target = harness();

    const error = await captureDomainError(() =>
      target.useCase.execute({
        organizationId: target.organization.id,
        email: 'not-an-address',
        role: 'member',
      }),
    );

    expect(error.code).toBe(ERROR_CODES.INVITATION_INVALID);
    expect(target.journal.trail()).toEqual([]);
  });
});
