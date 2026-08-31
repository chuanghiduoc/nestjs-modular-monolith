import { Inject, Injectable } from '@nestjs/common';

import { decodeOptionalCursor, encodeCursor } from '#shared/pagination';

import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepository,
} from '../domain/stored-file.repository';
import type { StoredFileView } from './dto/upload.dto';
import { toStoredFileView } from './stored-file.mapper';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface ListMyUploadsInput {
  readonly organizationId: string;
  readonly ownerId: string;
  readonly startingAfter?: string;
  readonly limit?: number;
}

export interface StoredFilePage {
  readonly files: readonly StoredFileView[];
  readonly hasMore: boolean;
  readonly lastCursor: string | null;
}

@Injectable()
export class ListMyUploadsUseCase {
  constructor(@Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepository) {}

  async execute(input: ListMyUploadsInput): Promise<StoredFilePage> {
    const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeOptionalCursor(input.startingAfter);

    const rows = await this.files.listByOwner(
      input.organizationId,
      input.ownerId,
      cursor,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      files: page.map(toStoredFileView),
      hasMore,
      lastCursor: last === undefined ? null : encodeCursor(last.createdAt, last.id),
    };
  }
}
