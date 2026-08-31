import { newId } from '#shared/util';

import { DisplayName } from './display-name.vo';
import type { UserProfileEvent } from './user-profile.events';

export class UserProfile {
  private readonly events: UserProfileEvent[] = [];

  private constructor(
    readonly id: string,
    readonly userId: string,
    private name: DisplayName,
    private avatar: string | null,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {}

  static create(input: { userId: string; displayName: string; now?: Date }): UserProfile {
    const now = input.now ?? new Date();
    const profile = new UserProfile(
      newId(),
      input.userId,
      DisplayName.of(input.displayName),
      null,
      now,
      now,
    );

    profile.events.push({
      kind: 'UserProfileCreated',
      profileId: profile.id,
      userId: profile.userId,
    });

    return profile;
  }

  static rehydrate(input: {
    id: string;
    userId: string;
    displayName: string;
    avatarFileId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserProfile {
    return new UserProfile(
      input.id,
      input.userId,
      DisplayName.rehydrate(input.displayName),
      input.avatarFileId,
      input.createdAt,
      input.updatedAt,
    );
  }

  get displayName(): string {
    return this.name.value;
  }

  get avatarFileId(): string | null {
    return this.avatar;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  rename(displayName: string, now: Date = new Date()): void {
    const next = DisplayName.of(displayName);

    if (next.equals(this.name)) {
      return;
    }

    const previous = this.name.value;
    this.name = next;
    this.updatedAtValue = now;
    this.events.push({
      kind: 'UserProfileRenamed',
      profileId: this.id,
      previous,
      current: next.value,
    });
  }

  changeAvatar(fileId: string | null, now: Date = new Date()): void {
    if (fileId === this.avatar) {
      return;
    }

    this.avatar = fileId;
    this.updatedAtValue = now;
    this.events.push({ kind: 'UserAvatarChanged', profileId: this.id, fileId });
  }

  pullEvents(): readonly UserProfileEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
