import { Inject, Injectable } from '@nestjs/common';

import { STORAGE, type StoragePort } from '#platform/storage';
import { detectMimeTypes, SIGNATURE_SAMPLE_BYTES } from '#shared/util';

import type { FileStoragePort, StoredObjectFacts, UploadPolicy } from '../domain/file-storage.port';

@Injectable()
export class S3FileStorageAdapter implements FileStoragePort {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  async createUploadPolicy(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadPolicy> {
    const presigned = await this.storage.createPresignedUpload({
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: input.expiresInSeconds,
    });

    return {
      url: presigned.url,
      method: presigned.method,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    };
  }

  async inspect(key: string): Promise<StoredObjectFacts | null> {
    const head = await this.storage.headObject(key);

    if (head === null) {
      return null;
    }

    const sample = await this.storage.getObjectRange(key, SIGNATURE_SAMPLE_BYTES);

    if (sample === null) {
      return null;
    }

    const detected = detectMimeTypes(sample);

    return {
      sizeBytes: head.sizeBytes,

      detectedMimeType: detected[0] ?? null,
    };
  }

  async remove(key: string): Promise<void> {
    await this.storage.deleteObject(key);
  }
}
