import { Inject, Injectable } from '@nestjs/common';

import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepository,
} from '../domain/stored-file.repository';

export interface CountUserUploadsInput {
  readonly organizationId: string;
  readonly ownerId: string;
}

/**
 * A total, not a page. Counting the rows of one page reports the page size
 * whenever the owner has more files than the page holds.
 */
@Injectable()
export class CountUserUploadsUseCase {
  constructor(@Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepository) {}

  async execute(input: CountUserUploadsInput): Promise<number> {
    return this.files.countByOwner(input.organizationId, input.ownerId);
  }
}
