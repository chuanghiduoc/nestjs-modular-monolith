import type { DecodedCursor } from '#shared/pagination';

import type { UserProfile } from './user-profile.entity';

export interface UserIdentity {
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly role: string;
  readonly createdAt: Date;
}

export interface UserProfileWithIdentity {
  readonly profile: UserProfile;
  readonly identity: UserIdentity;
}

export interface UserRepository {
  findByUserId(userId: string): Promise<UserProfile | null>;
  findIdentity(userId: string): Promise<UserIdentity | null>;
  save(profile: UserProfile): Promise<void>;
  deleteByUserId(userId: string): Promise<boolean>;

  listPage(
    cursor: DecodedCursor | null,
    limit: number,
    organizationId?: string,
  ): Promise<UserProfileWithIdentity[]>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
