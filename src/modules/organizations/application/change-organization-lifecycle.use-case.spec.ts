import { describe, expect, it } from 'vitest';

import { INTEGRATION_EVENTS, type IntegrationEvent } from '#contracts/events';
import type { EventPublisherPort, TxHandle, UnitOfWorkPort } from '#contracts/ports';

import { Organization } from '../domain/organization';
import type { OrganizationRepository } from '../domain/organization.repository';
import { ChangeOrganizationLifecycleUseCase } from './change-organization-lifecycle.use-case';

const ORGANIZATION_ID = '01a00000-0000-7000-8000-000000000001';
const OWNER_ID = '01a00000-0000-7000-8000-000000000002';

interface HarnessOptions {
  readonly setArchivedAtResult?: boolean;
  readonly missing?: boolean;
  readonly role?: 'owner' | 'admin' | 'member' | 'viewer';
}

function harness(
  archivedAt: Date | null = null,
  purgeResult = true,
  options: HarnessOptions = {},
): {
  readonly useCase: ChangeOrganizationLifecycleUseCase;
  readonly calls: { archivedAt: Date | null | undefined; purged: boolean };
  readonly published: IntegrationEvent[];
} {
  const calls = { archivedAt: undefined as Date | null | undefined, purged: false };
  const published: IntegrationEvent[] = [];
  const uow: UnitOfWorkPort = {
    transaction: async <T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> =>
      fn({ __brand: 'TxHandle' }),
  };
  const publisher: EventPublisherPort = {
    publishAll: (_tx, events) => {
      published.push(...events);

      return Promise.resolve();
    },
  };
  const organization = Organization.rehydrate({
    id: ORGANIZATION_ID,
    slug: 'acme',
    name: 'Acme',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt,
  });
  const repository: OrganizationRepository = {
    createWithOwner: () => Promise.resolve(),
    findById: () => Promise.resolve(organization),
    findByIdIncludingArchived: () =>
      Promise.resolve(options.missing === true ? null : organization),
    findMembership: () => Promise.resolve(null),
    findMembershipIncludingArchived: () =>
      Promise.resolve({
        id: '01a00000-0000-7000-8000-000000000003',
        organizationId: ORGANIZATION_ID,
        userId: OWNER_ID,
        role: options.role ?? 'owner',
        createdAt: new Date(),
      }),
    listMembershipsWithOrganization: () => Promise.resolve([]),
    addMember: () => Promise.resolve(true),
    listMembers: () => Promise.resolve([]),
    findMemberByEmail: () => Promise.resolve(null),
    changeMemberRole: () => Promise.resolve('changed' as const),
    removeMember: () => Promise.resolve('changed' as const),
    setArchivedAt: (_id, value) => {
      calls.archivedAt = value;

      return Promise.resolve(options.setArchivedAtResult ?? true);
    },
    purge: () => {
      calls.purged = true;

      return Promise.resolve(purgeResult);
    },
  };

  return {
    useCase: new ChangeOrganizationLifecycleUseCase(repository, uow, publisher),
    calls,
    published,
  };
}

describe('ChangeOrganizationLifecycleUseCase', () => {
  it('archives an active organization and restores an archived one', async () => {
    const active = harness();
    await active.useCase.archive({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID });
    expect(active.calls.archivedAt).toBeInstanceOf(Date);
    expect(active.published).toMatchObject([
      {
        name: INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED,
        payload: { organizationId: ORGANIZATION_ID, actorId: OWNER_ID },
      },
    ]);

    const archived = harness(new Date());
    await archived.useCase.restore({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID });
    expect(archived.calls.archivedAt).toBeNull();
    expect(archived.published).toMatchObject([
      {
        name: INTEGRATION_EVENTS.ORGANIZATION_RESTORED,
        payload: { organizationId: ORGANIZATION_ID, actorId: OWNER_ID },
      },
    ]);
  });

  it('requires archived state and dependency-free purge before hard delete', async () => {
    const active = harness(null);
    await expect(
      active.useCase.purge({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).rejects.toThrow('Archive the organization before purging it.');

    const blocked = harness(new Date(), false);
    await expect(
      blocked.useCase.purge({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).rejects.toThrow('Remove tenant files and billing records before purging the organization.');
    expect(blocked.calls.purged).toBe(true);
    expect(blocked.published).toEqual([]);
  });

  it('publishes the purge event only after the hard delete succeeds', async () => {
    const archived = harness(new Date());

    await archived.useCase.purge({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID });

    expect(archived.calls.purged).toBe(true);
    expect(archived.published).toMatchObject([
      {
        name: INTEGRATION_EVENTS.ORGANIZATION_PURGED,
        payload: { organizationId: ORGANIZATION_ID, actorId: OWNER_ID },
      },
    ]);
  });

  it('settles a repeated archive as a no-op instead of a 404, and publishes once', async () => {
    // A retried request whose success was never acknowledged must not read as
    // "organization not found", and must not emit a second archived event.
    const alreadyArchived = harness(new Date('2026-02-01T00:00:00.000Z'));

    await expect(
      alreadyArchived.useCase.archive({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).resolves.toBeUndefined();

    expect(alreadyArchived.calls.archivedAt).toBeUndefined();
    expect(alreadyArchived.published).toEqual([]);
  });

  it('settles a repeated restore as a no-op instead of a 404, and publishes once', async () => {
    const alreadyActive = harness(null);

    await expect(
      alreadyActive.useCase.restore({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).resolves.toBeUndefined();

    expect(alreadyActive.calls.archivedAt).toBeUndefined();
    expect(alreadyActive.published).toEqual([]);
  });

  it('reports a concurrent state change as a conflict, not as a missing organization', async () => {
    // The row exists — the compare-and-set lost a race with another writer, so
    // the honest answer is "retry", not "no such organization".
    const raced = harness(null, true, { setArchivedAtResult: false });

    await expect(
      raced.useCase.archive({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).rejects.toThrow('The organization changed state concurrently. Retry the command.');

    expect(raced.published).toEqual([]);
  });

  it('answers a vanished organization with not-found on both transitions', async () => {
    const gone = harness(null, true, { missing: true });

    await expect(
      gone.useCase.archive({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).rejects.toThrow('Organization not found.');
    await expect(
      gone.useCase.restore({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
    ).rejects.toThrow('Organization not found.');
  });

  it('refuses a non-owner before it touches state, on every transition', async () => {
    for (const run of ['archive', 'restore', 'purge'] as const) {
      const stranger = harness(new Date(), true, { role: 'admin' });

      await expect(
        stranger.useCase[run]({ organizationId: ORGANIZATION_ID, actorId: OWNER_ID }),
      ).rejects.toThrow('Owner access is required.');

      expect(stranger.calls.archivedAt).toBeUndefined();
      expect(stranger.calls.purged).toBe(false);
      expect(stranger.published).toEqual([]);
    }
  });
});
