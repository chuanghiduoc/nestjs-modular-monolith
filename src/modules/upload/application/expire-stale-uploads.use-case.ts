import { Inject, Injectable } from '@nestjs/common';

import { FILE_STORAGE, type FileStoragePort } from '../domain/file-storage.port';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepository,
} from '../domain/stored-file.repository';
import { UPLOAD_LIMITS, type UploadLimits } from './upload.limits';

const SWEEP_BATCH_SIZE = 200;
const MINUTE_MS = 60_000;

/**
 * The only thing that removes storage objects nobody will ever use: uploads that
 * were discarded because their bytes did not match, and uploads that were
 * presigned but never finished.
 *
 * Object first, row second. A crash between the two leaves a row whose object is
 * already gone, and the next sweep removes it — the opposite order would leave
 * an object with no row pointing at it, which nothing would ever find again.
 */
@Injectable()
export class ExpireStaleUploadsUseCase {
  constructor(
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
  ) {}

  async execute(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.limits.pendingTtlMinutes * MINUTE_MS);
    const stale = await this.files.findCleanupCandidates(cutoff, SWEEP_BATCH_SIZE);
    let removed = 0;

    for (const file of stale) {
      if (file.status === 'pending') {
        file.discard('never-uploaded', now);

        // Claim it first. A caller confirming this very upload right now would
        // win the compare-and-set, and its file must not be swept away.
        if (!(await this.files.compareAndSave(file, 'pending'))) {
          continue;
        }
        file.pullEvents();
      }

      await this.storage.remove(file.storageKey);
      await this.files.deleteById(file.id);
      removed += 1;
    }

    return removed;
  }
}
