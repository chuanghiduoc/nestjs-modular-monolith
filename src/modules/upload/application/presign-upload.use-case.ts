import { Inject, Injectable } from '@nestjs/common';

import { FILE_STORAGE, type FileStoragePort } from '../domain/file-storage.port';
import { StoredFile } from '../domain/stored-file.entity';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepository,
} from '../domain/stored-file.repository';
import type { PresignedUploadView } from './dto/upload.dto';
import { UPLOAD_LIMITS, type UploadLimits } from './upload.limits';

export interface PresignUploadInput {
  readonly organizationId: string;
  readonly ownerId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

@Injectable()
export class PresignUploadUseCase {
  constructor(
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(UPLOAD_LIMITS) private readonly limits: UploadLimits,
  ) {}

  async execute(input: PresignUploadInput): Promise<PresignedUploadView> {
    const file = StoredFile.presign({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      maxSizeBytes: this.limits.maxFileBytes,
    });

    await this.files.save(file);
    file.pullEvents();

    const policy = await this.storage.createUploadPolicy({
      key: file.storageKey,
      contentType: file.declaredMimeType,
      sizeBytes: file.declaredSizeBytes,
      expiresInSeconds: this.limits.presignExpirySeconds,
    });

    return {
      fileId: file.id,
      url: policy.url,
      method: policy.method,
      headers: policy.headers,
      expiresAt: policy.expiresAt.toISOString(),
      maxSizeBytes: this.limits.maxFileBytes,
    };
  }
}
