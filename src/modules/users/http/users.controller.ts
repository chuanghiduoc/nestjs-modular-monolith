import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AuthenticatedSession, CurrentUser, Roles } from '#platform/auth';
import { ApiCommonErrors } from '#shared/http';

import { GetUserProfileUseCase } from '../application/get-user-profile.use-case';
import { UpdateUserProfileUseCase } from '../application/update-user-profile.use-case';
import { UpdateProfileRequestDto } from './dto/update-profile.request.dto';
import { UserProfileResponseDto } from './dto/user-profile.response.dto';

@ApiTags('users')
@ApiCommonErrors({ forbidden: true, notFound: true, validation: true })
@Controller('users')
export class UsersController {
  constructor(
    private readonly getProfile: GetUserProfileUseCase,
    private readonly updateProfile: UpdateUserProfileUseCase,
  ) {}

  @Get('me')
  @ApiOperation({ summary: "The authenticated caller's own profile." })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async me(
    @CurrentUser() caller: AuthenticatedSession | undefined,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(await this.getProfile.execute(requireCaller(caller).userId));
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'A profile by user id.' })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async byId(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(await this.getProfile.execute(id));
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the caller's own profile." })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async updateMe(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Body() body: UpdateProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    const session = requireCaller(caller);

    const view = await this.updateProfile.execute({
      callerId: session.userId,

      targetUserId: session.userId,
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      ...(body.avatarFileId === undefined ? {} : { avatarFileId: body.avatarFileId }),
    });

    return UserProfileResponseDto.from(view);
  }
}

function requireCaller(caller: AuthenticatedSession | undefined): AuthenticatedSession {
  if (caller === undefined) {
    throw new UnauthorizedException();
  }

  return caller;
}
