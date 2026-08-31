import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import { InMemoryUserRepository } from '../../../../test/support/in-memory';
import { UserProfile } from '../domain/user-profile.entity';
import { GetUserProfileUseCase } from './get-user-profile.use-case';

const USER_ID = newId();
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

function createHarness() {
  const users = new InMemoryUserRepository();

  return { users, useCase: new GetUserProfileUseCase(users) };
}

function profileOf(userId: string): UserProfile {
  return UserProfile.rehydrate({
    id: newId(),
    userId,
    displayName: 'Alice',
    avatarFileId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

describe('GetUserProfileUseCase', () => {
  it('joins the profile to its identity', async () => {
    const harness = createHarness();
    const profile = profileOf(USER_ID);
    harness.users.seedProfile(profile);
    harness.users.seedIdentity({
      userId: USER_ID,
      email: 'alice@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: CREATED_AT,
    });

    const view = await harness.useCase.execute(USER_ID);

    expect(view).toEqual({
      id: profile.id,
      userId: USER_ID,
      email: 'alice@example.com',
      emailVerified: true,
      role: 'admin',
      displayName: 'Alice',
      avatarFileId: null,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: CREATED_AT.toISOString(),
    });
  });

  it('answers not_found for an unknown user', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() => harness.useCase.execute(newId()));

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(ERROR_CODES.USER_PROFILE_NOT_FOUND);
  });

  it('answers not_found — not half a profile — when the identity is gone', async () => {
    const harness = createHarness();
    harness.users.seedProfile(profileOf(USER_ID));

    const error = await captureDomainError(() => harness.useCase.execute(USER_ID));

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(ERROR_CODES.USER_PROFILE_NOT_FOUND);
  });
});
