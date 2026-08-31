import { type DynamicModule, Module } from '@nestjs/common';

import { DeleteUserProfileUseCase } from './application/delete-user-profile.use-case';
import { EnsureUserProfileUseCase } from './application/ensure-user-profile.use-case';
import { GetUserProfileUseCase } from './application/get-user-profile.use-case';
import { ListUserProfilesUseCase } from './application/list-user-profiles.use-case';
import { UpdateUserProfileUseCase } from './application/update-user-profile.use-case';
import { AVATAR_FILE_REPOSITORY } from './domain/avatar-file.repository';
import { USER_REPOSITORY } from './domain/user.repository';
import { UsersController } from './http/users.controller';
import { CreateProfileOnRegistrationListener } from './infrastructure/listeners/create-profile-on-registration.listener';
import { DeleteProfileOnUserDeletedListener } from './infrastructure/listeners/delete-profile-on-user-deleted.listener';
import { PrismaAvatarFileRepository } from './infrastructure/prisma-avatar-file.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

@Module({})
export class UsersModule {
  static forRoot(input: UsersModuleInput = {}): DynamicModule {
    return {
      module: UsersModule,
      controllers: input.exposeHttp === false ? [] : [UsersController],
      providers: [
        GetUserProfileUseCase,
        UpdateUserProfileUseCase,
        EnsureUserProfileUseCase,
        DeleteUserProfileUseCase,
        ListUserProfilesUseCase,
        CreateProfileOnRegistrationListener,
        DeleteProfileOnUserDeletedListener,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: AVATAR_FILE_REPOSITORY, useClass: PrismaAvatarFileRepository },
      ],
      exports: [GetUserProfileUseCase, ListUserProfilesUseCase],
    };
  }
}

export interface UsersModuleInput {
  readonly exposeHttp?: boolean;
}
