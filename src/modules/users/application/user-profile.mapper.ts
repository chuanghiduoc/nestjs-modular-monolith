import type { UserIdentity } from '../domain/user.repository';
import type { UserProfile } from '../domain/user-profile.entity';
import type { UserProfileView } from './dto/user-profile.dto';

export function toUserProfileView(profile: UserProfile, identity: UserIdentity): UserProfileView {
  return {
    id: profile.id,
    userId: profile.userId,
    email: identity.email,
    emailVerified: identity.emailVerified,
    role: identity.role,
    displayName: profile.displayName,
    avatarFileId: profile.avatarFileId,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
