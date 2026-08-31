import { describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { InMemoryUserRepository, TestJournal } from '../../../../test/support/in-memory';
import { UserProfile } from '../domain/user-profile.entity';
import { DeleteUserProfileUseCase } from './delete-user-profile.use-case';

const USER_ID = newId();

function createHarness() {
  const journal = new TestJournal();
  const users = new InMemoryUserRepository({ journal });

  return { journal, users, useCase: new DeleteUserProfileUseCase(users) };
}

describe('DeleteUserProfileUseCase', () => {
  it('removes the profile and reports that it did', async () => {
    const harness = createHarness();
    harness.users.seedProfile(UserProfile.create({ userId: USER_ID, displayName: 'Alice' }));

    await expect(harness.useCase.execute(USER_ID)).resolves.toBe(true);
    expect(harness.users.rowOf(USER_ID)).toBeNull();
  });

  it('reports false on redelivery instead of failing the job', async () => {
    const harness = createHarness();
    harness.users.seedProfile(UserProfile.create({ userId: USER_ID, displayName: 'Alice' }));

    await harness.useCase.execute(USER_ID);

    await expect(harness.useCase.execute(USER_ID)).resolves.toBe(false);
  });

  it('reports false for a user who never had a profile', async () => {
    const harness = createHarness();

    await expect(harness.useCase.execute(newId())).resolves.toBe(false);
  });
});
