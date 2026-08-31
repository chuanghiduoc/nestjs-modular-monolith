import { Inject, Injectable } from '@nestjs/common';

import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '#modules/organizations';
import { CountUserUploadsUseCase, ListMyUploadsUseCase } from '#modules/upload';
import { GetUserProfileUseCase, ListUserProfilesUseCase } from '#modules/users';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import type { AdminUserOverviewDto, AdminUserSummaryDto } from './http/dto/admin.dto';

const RECENT_FILE_LIMIT = 5;

@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly listProfiles: ListUserProfilesUseCase,
    private readonly getProfile: GetUserProfileUseCase,
    private readonly listUploads: ListMyUploadsUseCase,
    private readonly countUploads: CountUserUploadsUseCase,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}

  async listUsers(input: {
    organizationId: string;
    startingAfter?: string;
    limit?: number;
  }): Promise<{
    users: AdminUserSummaryDto[];
    hasMore: boolean;
    lastCursor: string | null;
  }> {
    const page = await this.listProfiles.execute({
      organizationId: input.organizationId,
      ...(input.startingAfter === undefined ? {} : { startingAfter: input.startingAfter }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });

    return {
      users: page.profiles.map((profile) => ({
        userId: profile.userId,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
        emailVerified: profile.emailVerified,
        createdAt: profile.createdAt,
      })),
      hasMore: page.hasMore,
      lastCursor: page.lastCursor,
    };
  }

  async overview(userId: string, organizationId: string): Promise<AdminUserOverviewDto> {
    const membership = await this.organizations.findMembership(organizationId, userId);
    if (membership === null) {
      throw DomainErrors.notFound(ERROR_CODES.USER_PROFILE_NOT_FOUND, 'Profile not found.');
    }

    const profile = await this.getProfile.execute(userId);
    const [total, recent] = await Promise.all([
      this.countUploads.execute({ organizationId, ownerId: userId }),
      this.listUploads.execute({
        organizationId,
        ownerId: userId,
        limit: RECENT_FILE_LIMIT,
      }),
    ]);

    return {
      user: {
        userId: profile.userId,
        email: profile.email,
        displayName: profile.displayName,
        role: profile.role,
        emailVerified: profile.emailVerified,
        createdAt: profile.createdAt,
      },

      fileCount: total,
      recentFileIds: recent.files.map((file) => file.id),
    };
  }
}
