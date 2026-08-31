import { Inject, Injectable } from '@nestjs/common';

import { FILE_STORAGE, type FileStoragePort } from '../domain/file-storage.port';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepository,
} from '../domain/stored-file.repository';

const PURGE_BATCH_SIZE = 500;

@Injectable()
export class PurgeUserFilesUseCase {
  constructor(
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  /**
   * Batches until the owner has nothing left, because a deletion that stops
   * halfway leaves files nobody will ever come back for — the event that
   * triggered this is delivered once.
   *
   * The guard is progress, not a pass count: if a batch comes back starting at
   * the same file it started at last time, the delete is not taking effect and
   * looping again would spin forever. Failing loudly hands that to the queue's
   * retry and to the logs instead.
   */
  async execute(ownerId: string): Promise<number> {
    let purged = 0;
    let previousHead: string | undefined;

    for (;;) {
      const owned = await this.files.findAllByOwner(ownerId, PURGE_BATCH_SIZE);

      if (owned.length === 0) {
        return purged;
      }

      const head = owned[0]?.id;

      if (head === previousHead) {
        throw new Error(
          `Purging stored files for owner ${ownerId} made no progress at file ${String(head)}.`,
        );
      }
      previousHead = head;

      for (const file of owned) {
        await this.storage.remove(file.storageKey);
        await this.files.deleteById(file.id);
        purged += 1;
      }
    }
  }
}
