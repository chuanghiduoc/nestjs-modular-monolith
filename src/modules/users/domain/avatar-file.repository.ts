export const AVATAR_FILE_REPOSITORY = Symbol('AVATAR_FILE_REPOSITORY');

/**
 * Answers whether a stored file may be attached as a profile avatar.
 *
 * The users context must not import upload/, so this port keeps the rule
 * here and lets the infrastructure adapter read the other schema directly.
 */
export interface AvatarFileRepository {
  existsUsableForOwner(fileId: string, ownerId: string): Promise<boolean>;
}
