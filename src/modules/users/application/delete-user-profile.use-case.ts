import { Inject, Injectable } from '@nestjs/common';

import { USER_REPOSITORY, type UserRepository } from '../domain/user.repository';

@Injectable()
export class DeleteUserProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<boolean> {
    return this.users.deleteByUserId(userId);
  }
}
