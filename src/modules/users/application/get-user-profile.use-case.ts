import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { USER_REPOSITORY, type UserRepository } from '../domain/user.repository';
import type { UserProfileView } from './dto/user-profile.dto';
import { toUserProfileView } from './user-profile.mapper';

@Injectable()
export class GetUserProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<UserProfileView> {
    const [profile, identity] = await Promise.all([
      this.users.findByUserId(userId),
      this.users.findIdentity(userId),
    ]);

    if (profile === null || identity === null) {
      throw DomainErrors.notFound(ERROR_CODES.USER_PROFILE_NOT_FOUND, 'Profile not found.');
    }

    return toUserProfileView(profile, identity);
  }
}
