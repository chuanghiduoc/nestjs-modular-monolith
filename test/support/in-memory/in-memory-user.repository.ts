import type { DecodedCursor } from '#shared/pagination';

import type {
  UserIdentity,
  UserProfileWithIdentity,
  UserRepository,
} from '../../../src/modules/users/domain/user.repository';
import { UserProfile } from '../../../src/modules/users/domain/user-profile.entity';
import type { TransactionParticipant } from './in-memory-unit-of-work';
import { type JournalOptions, TestJournal } from './journal';
import { byKeyDescending, comesAfterCursor } from './ordering';

interface UserProfileRow {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarFileId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class InMemoryUserRepository implements UserRepository, TransactionParticipant {
  readonly journal: TestJournal;

  private rows = new Map<string, UserProfileRow>();
  private identities = new Map<string, UserIdentity>();

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  snapshot(): () => void {
    const capturedRows = new Map(this.rows);
    const capturedIdentities = new Map(this.identities);

    return () => {
      this.rows = capturedRows;
      this.identities = capturedIdentities;
    };
  }

  seedProfile(profile: UserProfile): void {
    this.rows.set(profile.userId, toRow(profile));
  }

  seedIdentity(identity: UserIdentity): void {
    this.identities.set(identity.userId, identity);
  }

  get size(): number {
    return this.rows.size;
  }

  rowOf(userId: string): UserProfile | null {
    const row = this.rows.get(userId);

    return row === undefined ? null : toAggregate(row);
  }

  findByUserId(userId: string): Promise<UserProfile | null> {
    return Promise.resolve(this.rowOf(userId));
  }

  findIdentity(userId: string): Promise<UserIdentity | null> {
    return Promise.resolve(this.identities.get(userId) ?? null);
  }

  save(profile: UserProfile): Promise<void> {
    const existing = this.rows.get(profile.userId);

    this.rows.set(
      profile.userId,
      existing === undefined
        ? toRow(profile)
        : {
            ...existing,
            displayName: profile.displayName,
            avatarFileId: profile.avatarFileId,
            updatedAt: profile.updatedAt,
          },
    );
    this.journal.record('users', 'save', profile.userId);

    return Promise.resolve();
  }

  deleteByUserId(userId: string): Promise<boolean> {
    const deleted = this.rows.delete(userId);
    this.journal.record('users', 'deleteByUserId', userId);

    return Promise.resolve(deleted);
  }

  listPage(cursor: DecodedCursor | null, limit: number): Promise<UserProfileWithIdentity[]> {
    const page = [...this.rows.values()]
      .filter((row) => comesAfterCursor(cursor, { sortValue: row.createdAt, id: row.id }))
      .sort((left, right) =>
        byKeyDescending(
          { sortValue: left.createdAt, id: left.id },
          { sortValue: right.createdAt, id: right.id },
        ),
      )
      .slice(0, limit);

    return Promise.resolve(
      page.flatMap((row): UserProfileWithIdentity[] => {
        const identity = this.identities.get(row.userId);

        return identity === undefined ? [] : [{ profile: toAggregate(row), identity }];
      }),
    );
  }
}

function toRow(profile: UserProfile): UserProfileRow {
  return {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    avatarFileId: profile.avatarFileId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function toAggregate(row: UserProfileRow): UserProfile {
  return UserProfile.rehydrate({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    avatarFileId: row.avatarFileId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
