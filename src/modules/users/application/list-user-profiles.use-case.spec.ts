import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { decodeCursor, encodeCursor } from '#shared/pagination';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import { InMemoryUserRepository, TestJournal } from '../../../../test/support/in-memory';
import { UserProfile } from '../domain/user-profile.entity';
import {
  DEFAULT_PAGE_SIZE,
  ListUserProfilesUseCase,
  MAX_PAGE_SIZE,
} from './list-user-profiles.use-case';

const BASE_TIME = new Date('2026-08-16T10:00:00.000Z');
const MINUTE_MS = 60_000;

function createHarness() {
  const journal = new TestJournal();
  const users = new InMemoryUserRepository({ journal });

  return { journal, users, useCase: new ListUserProfilesUseCase(users) };
}

type Harness = ReturnType<typeof createHarness>;

function seedProfile(harness: Harness, createdAt: Date): UserProfile {
  const userId = newId();
  const profile = UserProfile.rehydrate({
    id: newId(),
    userId,
    displayName: 'Alice',
    avatarFileId: null,
    createdAt,
    updatedAt: createdAt,
  });

  harness.users.seedProfile(profile);
  harness.users.seedIdentity({
    userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    role: 'user',
    createdAt,
  });

  return profile;
}

function seedProfiles(harness: Harness, count: number): UserProfile[] {
  return Array.from({ length: count }, (_unused, index) =>
    seedProfile(harness, new Date(BASE_TIME.getTime() - index * MINUTE_MS)),
  );
}

describe('ListUserProfilesUseCase', () => {
  it('caps the page at MAX_PAGE_SIZE however large a limit is asked for', async () => {
    const harness = createHarness();
    seedProfiles(harness, MAX_PAGE_SIZE + 1);

    const page = await harness.useCase.execute({ limit: 5_000 });

    expect(page.profiles).toHaveLength(MAX_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it('falls back to the default page size', async () => {
    const harness = createHarness();
    seedProfiles(harness, DEFAULT_PAGE_SIZE + 1);

    const page = await harness.useCase.execute({});

    expect(page.profiles).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it('reports hasMore from the extra row, not from a COUNT', async () => {
    const harness = createHarness();
    seedProfiles(harness, 2);

    const truncated = await harness.useCase.execute({ limit: 1 });
    const exact = await harness.useCase.execute({ limit: 2 });

    expect(truncated.profiles).toHaveLength(1);
    expect(truncated.hasMore).toBe(true);
    expect(exact.profiles).toHaveLength(2);
    expect(exact.hasMore).toBe(false);
  });

  it('returns a lastCursor that decodes to the last row of the page', async () => {
    const harness = createHarness();
    const seeded = seedProfiles(harness, 3);

    const page = await harness.useCase.execute({ limit: 2 });

    const decoded = decodeCursor(page.lastCursor!);
    expect(decoded.id).toBe(seeded[1]!.id);
    expect(decoded.sortValue.toISOString()).toBe(seeded[1]!.createdAt.toISOString());
  });

  it('has no cursor when the page is empty', async () => {
    const harness = createHarness();

    const page = await harness.useCase.execute({});

    expect(page.profiles).toEqual([]);
    expect(page.lastCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('walks the whole set without dropping or repeating a row', async () => {
    const harness = createHarness();
    const seeded = seedProfiles(harness, 5);

    const first = await harness.useCase.execute({ limit: 2 });
    const second = await harness.useCase.execute({ limit: 2, startingAfter: first.lastCursor! });
    const third = await harness.useCase.execute({ limit: 2, startingAfter: second.lastCursor! });

    const seen = [...first.profiles, ...second.profiles, ...third.profiles].map(
      (profile) => profile.id,
    );
    expect(seen).toEqual(seeded.map((profile) => profile.id));
    expect(new Set(seen).size).toBe(seeded.length);
    expect(third.hasMore).toBe(false);
  });

  it('breaks a timestamp tie on the id, in both the order and the cursor', async () => {
    const harness = createHarness();
    const collided = [
      seedProfile(harness, BASE_TIME),
      seedProfile(harness, BASE_TIME),
      seedProfile(harness, BASE_TIME),
    ].sort((left, right) => (left.id < right.id ? 1 : -1));

    const first = await harness.useCase.execute({ limit: 2 });
    const second = await harness.useCase.execute({ limit: 2, startingAfter: first.lastCursor! });

    expect(first.profiles.map((profile) => profile.id)).toEqual([collided[0]!.id, collided[1]!.id]);
    expect(second.profiles.map((profile) => profile.id)).toEqual([collided[2]!.id]);
  });

  it('answers a corrupted cursor with malformed, never validation', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() =>
      harness.useCase.execute({ startingAfter: 'not-a-cursor' }),
    );

    expect(error.kind).toBe('malformed');
    expect(error.code).toBe(ERROR_CODES.CURSOR_MALFORMED);
  });

  it('rejects a cursor carrying a non-v7 id rather than paging from it', async () => {
    const harness = createHarness();
    seedProfiles(harness, 2);

    const error = await captureDomainError(() =>
      harness.useCase.execute({
        startingAfter: encodeCursor(BASE_TIME, '6f4a2c1e-9b3d-4c7a-8f21-0d5e6a7b8c9d'),
      }),
    );

    expect(error.code).toBe(ERROR_CODES.CURSOR_MALFORMED);
  });
});
