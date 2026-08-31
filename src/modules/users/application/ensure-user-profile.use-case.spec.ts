import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { InMemoryUserRepository, TestJournal } from '../../../../test/support/in-memory';
import { DisplayName } from '../domain/display-name.vo';
import { EnsureUserProfileUseCase } from './ensure-user-profile.use-case';

const USER_ID = newId();

function createHarness() {
  const journal = new TestJournal();
  const users = new InMemoryUserRepository({ journal });

  return { journal, users, useCase: new EnsureUserProfileUseCase(users) };
}

describe('EnsureUserProfileUseCase', () => {
  it('creates the profile for an identity that just appeared', async () => {
    const harness = createHarness();

    const created = await harness.useCase.execute({
      userId: USER_ID,
      email: 'alice@example.com',
    });

    expect(created).toBe(true);
    expect(harness.users.rowOf(USER_ID)?.displayName).toBe('alice');
    expect(harness.users.rowOf(USER_ID)?.avatarFileId).toBeNull();
  });

  it('produces ONE profile when the registration is delivered twice', async () => {
    const harness = createHarness();

    await harness.useCase.execute({ userId: USER_ID, email: 'alice@example.com' });
    const first = harness.users.rowOf(USER_ID);
    harness.journal.clear();

    const created = await harness.useCase.execute({ userId: USER_ID, email: 'alice@example.com' });

    expect(created).toBe(false);
    expect(harness.users.size).toBe(1);
    expect(harness.users.rowOf(USER_ID)?.id).toBe(first?.id);
    expect(harness.journal.trail()).toEqual([]);
  });

  it('pads a local part that is too short for the display-name rule', async () => {
    const harness = createHarness();

    const created = await harness.useCase.execute({ userId: USER_ID, email: 'a@b.com' });

    expect(created).toBe(true);
    expect(harness.users.rowOf(USER_ID)?.displayName).toBe('a-user');
  });

  it('truncates a local part that is too long for the display-name rule', async () => {
    const harness = createHarness();
    const longLocalPart = 'a'.repeat(120);

    await harness.useCase.execute({ userId: USER_ID, email: `${longLocalPart}@example.com` });

    expect(harness.users.rowOf(USER_ID)?.displayName).toHaveLength(DisplayName.MAX_LENGTH);
  });

  it('prefers the name the identity supplied over the address', async () => {
    const harness = createHarness();

    await harness.useCase.execute({
      userId: USER_ID,
      email: 'alice@example.com',
      displayName: 'Alice Cooper',
    });

    expect(harness.users.rowOf(USER_ID)?.displayName).toBe('Alice Cooper');
  });

  it('writes exactly once per creation', async () => {
    const harness = createHarness();

    await harness.useCase.execute({ userId: USER_ID, email: 'alice@example.com' });

    expect(harness.journal.trail()).toEqual(['users:save']);
  });
});
