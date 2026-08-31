import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import {
  InMemoryAvatarFileRepository,
  InMemoryUserRepository,
  TestJournal,
} from '../../../../test/support/in-memory';
import type { UserIdentity } from '../domain/user.repository';
import { UserProfile } from '../domain/user-profile.entity';
import { UpdateUserProfileUseCase } from './update-user-profile.use-case';

const USER_ID = newId();
const STRANGER_ID = newId();
const AVATAR_ID = newId();
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

function createHarness() {
  const journal = new TestJournal();
  const users = new InMemoryUserRepository({ journal });
  const avatarFiles = new InMemoryAvatarFileRepository();

  return {
    journal,
    users,
    avatarFiles,
    useCase: new UpdateUserProfileUseCase(users, avatarFiles),
  };
}

type Harness = ReturnType<typeof createHarness>;

function identityOf(userId: string): UserIdentity {
  return {
    userId,
    email: 'alice@example.com',
    emailVerified: true,
    role: 'user',
    createdAt: CREATED_AT,
  };
}

interface SeedInput {
  readonly displayName?: string;
  readonly avatarFileId?: string | null;
  readonly withIdentity?: boolean;
}

function seedProfile(harness: Harness, input: SeedInput = {}): UserProfile {
  const profile = UserProfile.rehydrate({
    id: newId(),
    userId: USER_ID,
    displayName: input.displayName ?? 'Alice',
    avatarFileId: input.avatarFileId ?? null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });

  harness.users.seedProfile(profile);
  if (input.withIdentity !== false) {
    harness.users.seedIdentity(identityOf(USER_ID));
  }

  return profile;
}

describe('UpdateUserProfileUseCase', () => {
  it('refuses a caller editing somebody else, and writes nothing', async () => {
    const harness = createHarness();
    seedProfile(harness);

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        callerId: STRANGER_ID,
        targetUserId: USER_ID,
        displayName: 'Mallory',
      }),
    );

    expect(error.kind).toBe('forbidden');
    expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(harness.journal.trail()).toEqual([]);
    expect(harness.users.rowOf(USER_ID)?.displayName).toBe('Alice');
  });

  it('applies the aggregate rule to a rename rather than restating it', async () => {
    const harness = createHarness();
    seedProfile(harness);

    const error = await captureDomainError(() =>
      harness.useCase.execute({ callerId: USER_ID, targetUserId: USER_ID, displayName: 'A' }),
    );

    expect(error.kind).toBe('validation');
    expect(error.code).toBe(ERROR_CODES.DISPLAY_NAME_INVALID);
    expect(error.errors[0]?.path).toBe('displayName');
    expect(harness.journal.trail()).toEqual([]);
    expect(harness.users.rowOf(USER_ID)?.displayName).toBe('Alice');
  });

  it('renames, trims and moves updatedAt', async () => {
    const harness = createHarness();
    seedProfile(harness);

    const view = await harness.useCase.execute({
      callerId: USER_ID,
      targetUserId: USER_ID,
      displayName: '  Alice Cooper  ',
    });

    expect(view.displayName).toBe('Alice Cooper');
    const stored = harness.users.rowOf(USER_ID);
    expect(stored?.displayName).toBe('Alice Cooper');
    expect(stored!.updatedAt.getTime()).toBeGreaterThan(CREATED_AT.getTime());
  });

  it('leaves updatedAt alone when the name did not actually change', async () => {
    const harness = createHarness();
    seedProfile(harness);

    await harness.useCase.execute({
      callerId: USER_ID,
      targetUserId: USER_ID,
      displayName: 'Alice',
    });

    expect(harness.users.rowOf(USER_ID)!.updatedAt.getTime()).toBe(CREATED_AT.getTime());
  });

  it('clears the avatar on null and leaves it alone on undefined', async () => {
    const harness = createHarness();
    seedProfile(harness, { avatarFileId: AVATAR_ID });

    const untouched = await harness.useCase.execute({
      callerId: USER_ID,
      targetUserId: USER_ID,
      displayName: 'Alice Cooper',
    });
    expect(untouched.avatarFileId).toBe(AVATAR_ID);

    const cleared = await harness.useCase.execute({
      callerId: USER_ID,
      targetUserId: USER_ID,
      avatarFileId: null,
    });

    expect(cleared.avatarFileId).toBeNull();
    expect(harness.users.rowOf(USER_ID)?.avatarFileId).toBeNull();
  });

  it('refuses to attach a file that is not a usable confirmed upload of the caller', async () => {
    const harness = createHarness();
    seedProfile(harness);

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        callerId: USER_ID,
        targetUserId: USER_ID,
        avatarFileId: AVATAR_ID,
      }),
    );

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(ERROR_CODES.UPLOAD_NOT_FOUND);
    expect(harness.journal.trail()).toEqual([]);
    expect(harness.users.rowOf(USER_ID)?.avatarFileId).toBeNull();
  });

  it('attaches a confirmed upload owned by the caller', async () => {
    const harness = createHarness();
    seedProfile(harness);
    harness.avatarFiles.seedUsableFile(AVATAR_ID);

    const view = await harness.useCase.execute({
      callerId: USER_ID,
      targetUserId: USER_ID,
      avatarFileId: AVATAR_ID,
    });

    expect(view.avatarFileId).toBe(AVATAR_ID);
    expect(harness.users.rowOf(USER_ID)?.avatarFileId).toBe(AVATAR_ID);
  });

  it('answers not_found for a caller who has no profile row yet', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        callerId: USER_ID,
        targetUserId: USER_ID,
        displayName: 'Alice',
      }),
    );

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(ERROR_CODES.USER_PROFILE_NOT_FOUND);
  });

  it('answers not_found when the identity behind the profile is gone', async () => {
    const harness = createHarness();
    seedProfile(harness, { withIdentity: false });

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        callerId: USER_ID,
        targetUserId: USER_ID,
        displayName: 'Alice Cooper',
      }),
    );

    expect(error.kind).toBe('not_found');
    expect(error.code).toBe(ERROR_CODES.USER_NOT_FOUND);
    expect(harness.journal.trail()).toEqual(['users:save']);
  });

  it('returns the projection every profile endpoint shares', async () => {
    const harness = createHarness();
    const profile = seedProfile(harness);

    const view = await harness.useCase.execute({
      callerId: USER_ID,
      targetUserId: USER_ID,
      displayName: 'Alice Cooper',
    });

    expect(view).toEqual({
      id: profile.id,
      userId: USER_ID,
      email: 'alice@example.com',
      emailVerified: true,
      role: 'user',
      displayName: 'Alice Cooper',
      avatarFileId: null,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: harness.users.rowOf(USER_ID)!.updatedAt.toISOString(),
    });
  });
});
