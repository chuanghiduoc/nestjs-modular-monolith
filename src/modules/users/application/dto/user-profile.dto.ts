export interface UserProfileView {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly role: string;
  readonly displayName: string;
  readonly avatarFileId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserProfilePage {
  readonly profiles: readonly UserProfileView[];
  readonly hasMore: boolean;
  readonly lastCursor: string | null;
}
