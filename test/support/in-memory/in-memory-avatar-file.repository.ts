import type { AvatarFileRepository } from '../../../src/modules/users/domain/avatar-file.repository';

export class InMemoryAvatarFileRepository implements AvatarFileRepository {
  private readonly usableFiles = new Set<string>();

  seedUsableFile(fileId: string): void {
    this.usableFiles.add(fileId);
  }

  existsUsableForOwner(fileId: string, _ownerId: string): Promise<boolean> {
    return Promise.resolve(this.usableFiles.has(fileId));
  }
}
