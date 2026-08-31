import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors, ERROR_CODES } from '#shared/errors';

import {
  AVATAR_FILE_REPOSITORY,
  type AvatarFileRepository,
} from '../domain/avatar-file.repository';
import { USER_REPOSITORY, type UserRepository } from '../domain/user.repository';
import type { UserProfileView } from './dto/user-profile.dto';
import { toUserProfileView } from './user-profile.mapper';

export interface UpdateUserProfileInput {
  readonly callerId: string;
  readonly targetUserId: string;
  readonly displayName?: string;

  readonly avatarFileId?: string | null;
}

@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AVATAR_FILE_REPOSITORY) private readonly avatarFiles: AvatarFileRepository,
  ) {}

  async execute(input: UpdateUserProfileInput): Promise<UserProfileView> {
    if (input.callerId !== input.targetUserId) {
      throw DomainErrors.forbidden(
        ERROR_CODES.FORBIDDEN,
        'A profile may only be edited by its owner.',
      );
    }

    const profile = await this.users.findByUserId(input.targetUserId);

    if (profile === null) {
      throw DomainErrors.notFound(ERROR_CODES.USER_PROFILE_NOT_FOUND, 'Profile not found.');
    }

    if (input.displayName !== undefined) {
      profile.rename(input.displayName);
    }
    if (input.avatarFileId !== undefined) {
      await this.assertAvatarUsable(input.avatarFileId, input.callerId);
      profile.changeAvatar(input.avatarFileId);
    }

    await this.users.save(profile);

    const identity = await this.users.findIdentity(input.targetUserId);

    if (identity === null) {
      throw DomainErrors.notFound(ERROR_CODES.USER_NOT_FOUND, 'User not found.');
    }

    return toUserProfileView(profile, identity);
  }

  private async assertAvatarUsable(avatarFileId: string | null, ownerId: string): Promise<void> {
    // Clearing the avatar is always allowed; only attaching a file is checked.
    if (avatarFileId === null) {
      return;
    }

    const usable = await this.avatarFiles.existsUsableForOwner(avatarFileId, ownerId);

    if (!usable) {
      throw DomainErrors.notFound(
        ERROR_CODES.UPLOAD_NOT_FOUND,
        'No usable confirmed upload with that id belongs to you.',
      );
    }
  }
}
