import { describe, expect, it } from 'vitest';

import { isUuidV7, newId } from '#shared/util';

import { UserProfile } from './user-profile.entity';

const CREATED_AT = new Date('2026-08-16T10:00:00.000Z');
const LATER = new Date('2026-08-16T11:00:00.000Z');

function existingProfile(): UserProfile {
  const profile = UserProfile.create({
    userId: newId(),
    displayName: 'Ada Lovelace',
    now: CREATED_AT,
  });
  profile.pullEvents();

  return profile;
}

describe('UserProfile', () => {
  it('create() mints a UUID v7 id and records that the profile was created', () => {
    const userId = newId();

    const profile = UserProfile.create({
      userId,
      displayName: '  Ada Lovelace  ',
      now: CREATED_AT,
    });

    expect(isUuidV7(profile.id)).toBe(true);
    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.avatarFileId).toBeNull();
    expect(profile.createdAt).toBe(CREATED_AT);
    expect(profile.updatedAt).toBe(CREATED_AT);
    expect(profile.pullEvents()).toEqual([
      { kind: 'UserProfileCreated', profileId: profile.id, userId },
    ]);
  });

  it('create() rejects an invalid display name instead of constructing a broken aggregate', () => {
    expect(() =>
      UserProfile.create({ userId: newId(), displayName: ' ', now: CREATED_AT }),
    ).toThrowError();
  });

  it('rehydrate() emits nothing — reading a row is not something that happened', () => {
    const avatarFileId = newId();

    const profile = UserProfile.rehydrate({
      id: newId(),
      userId: newId(),
      displayName: 'Ada Lovelace',
      avatarFileId,
      createdAt: CREATED_AT,
      updatedAt: LATER,
    });

    expect(profile.pullEvents()).toEqual([]);
    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.avatarFileId).toBe(avatarFileId);
    expect(profile.updatedAt).toBe(LATER);
  });

  it('rename() to a different name moves the value, the clock and the event together', () => {
    const profile = existingProfile();

    profile.rename('Grace Hopper', LATER);

    expect(profile.displayName).toBe('Grace Hopper');
    expect(profile.updatedAt).toBe(LATER);
    expect(profile.pullEvents()).toEqual([
      {
        kind: 'UserProfileRenamed',
        profileId: profile.id,
        previous: 'Ada Lovelace',
        current: 'Grace Hopper',
      },
    ]);
  });

  it('rename() to the same name changes nothing and emits nothing', () => {
    const profile = existingProfile();

    profile.rename('  Ada Lovelace  ', LATER);

    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.updatedAt).toBe(CREATED_AT);
    expect(profile.pullEvents()).toEqual([]);
  });

  it('rename() with an invalid name throws and leaves the entity exactly as it was', () => {
    const profile = existingProfile();

    expect(() => profile.rename('a', LATER)).toThrowError();

    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.updatedAt).toBe(CREATED_AT);
    expect(profile.pullEvents()).toEqual([]);
  });

  it('changeAvatar() to the value it already holds is a no-op, including null to null', () => {
    const profile = existingProfile();
    const fileId = newId();

    profile.changeAvatar(null, LATER);
    expect(profile.updatedAt).toBe(CREATED_AT);
    expect(profile.pullEvents()).toEqual([]);

    profile.changeAvatar(fileId, LATER);
    profile.pullEvents();

    profile.changeAvatar(fileId, new Date('2026-08-16T12:00:00.000Z'));
    expect(profile.updatedAt).toBe(LATER);
    expect(profile.pullEvents()).toEqual([]);
  });

  it('changeAvatar() to a new file id emits UserAvatarChanged', () => {
    const profile = existingProfile();
    const fileId = newId();

    profile.changeAvatar(fileId, LATER);

    expect(profile.avatarFileId).toBe(fileId);
    expect(profile.updatedAt).toBe(LATER);
    expect(profile.pullEvents()).toEqual([
      { kind: 'UserAvatarChanged', profileId: profile.id, fileId },
    ]);
  });

  it('changeAvatar(null) clears the avatar and still emits — a removal is a fact too', () => {
    const profile = UserProfile.rehydrate({
      id: newId(),
      userId: newId(),
      displayName: 'Ada Lovelace',
      avatarFileId: newId(),
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    profile.changeAvatar(null, LATER);

    expect(profile.avatarFileId).toBeNull();
    expect(profile.updatedAt).toBe(LATER);
    expect(profile.pullEvents()).toEqual([
      { kind: 'UserAvatarChanged', profileId: profile.id, fileId: null },
    ]);
  });

  it('pullEvents() drains, so a second save cannot republish what already went out', () => {
    const profile = UserProfile.create({
      userId: newId(),
      displayName: 'Ada Lovelace',
      now: CREATED_AT,
    });
    profile.rename('Grace Hopper', LATER);

    expect(profile.pullEvents()).toHaveLength(2);
    expect(profile.pullEvents()).toEqual([]);
  });
});
