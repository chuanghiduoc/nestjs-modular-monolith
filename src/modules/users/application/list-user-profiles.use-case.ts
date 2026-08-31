import { Inject, Injectable } from '@nestjs/common';

import { decodeOptionalCursor, encodeCursor } from '#shared/pagination';

import { USER_REPOSITORY, type UserRepository } from '../domain/user.repository';
import type { UserProfilePage } from './dto/user-profile.dto';
import { toUserProfileView } from './user-profile.mapper';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface ListUserProfilesInput {
  readonly startingAfter?: string;
  readonly limit?: number;
  readonly organizationId?: string;
}

@Injectable()
export class ListUserProfilesUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(input: ListUserProfilesInput): Promise<UserProfilePage> {
    const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeOptionalCursor(input.startingAfter);

    const rows = await this.users.listPage(cursor, limit + 1, input.organizationId);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      profiles: page.map((row) => toUserProfileView(row.profile, row.identity)),
      hasMore,
      lastCursor: last === undefined ? null : encodeCursor(last.profile.createdAt, last.profile.id),
    };
  }
}
