import { Inject, Injectable } from '@nestjs/common';

import { USER_REPOSITORY, type UserRepository } from '../domain/user.repository';
import { UserProfile } from '../domain/user-profile.entity';

export interface EnsureUserProfileInput {
  readonly userId: string;

  readonly email: string;
  readonly displayName?: string;
}

@Injectable()
export class EnsureUserProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(input: EnsureUserProfileInput): Promise<boolean> {
    const existing = await this.users.findByUserId(input.userId);

    if (existing !== null) {
      return false;
    }

    const profile = UserProfile.create({
      userId: input.userId,
      displayName: input.displayName ?? defaultDisplayName(input.email),
    });

    await this.users.save(profile);

    return true;
  }
}

function defaultDisplayName(email: string): string {
  const localPart = email.split('@')[0] ?? 'user';

  return localPart.length >= 2 ? localPart.slice(0, 80) : `${localPart}-user`;
}
