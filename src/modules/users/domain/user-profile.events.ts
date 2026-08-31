export interface UserProfileCreated {
  readonly kind: 'UserProfileCreated';
  readonly profileId: string;
  readonly userId: string;
}

export interface UserProfileRenamed {
  readonly kind: 'UserProfileRenamed';
  readonly profileId: string;
  readonly previous: string;
  readonly current: string;
}

export interface UserAvatarChanged {
  readonly kind: 'UserAvatarChanged';
  readonly profileId: string;
  readonly fileId: string | null;
}

export type UserProfileEvent = UserProfileCreated | UserProfileRenamed | UserAvatarChanged;
