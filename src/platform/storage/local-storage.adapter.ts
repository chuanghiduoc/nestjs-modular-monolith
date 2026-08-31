import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { SIGNATURE_SAMPLE_BYTES } from '#shared/util';

import { STORAGE_OPTIONS, type StorageOptions } from './storage.options';
import type {
  PresignedUpload,
  PresignedUploadRequest,
  StoragePort,
  StoredObjectHead,
} from './storage.port';

const CONTENT_TYPE_HEADER = 'content-type';
const CONTENT_LENGTH_HEADER = 'content-length';
const UPLOAD_TOKEN_HEADER = 'x-upload-token';
const MS_PER_SECOND = 1000;

/** Where the local upload route is mounted. */
export const LOCAL_UPLOAD_PREFIX = '/local-storage';

/**
 * Object storage backed by the local filesystem, so `pnpm dev` and the test
 * suite do not need MinIO running to exercise the upload flow.
 *
 * It implements the same port as S3, including the presign step: the URL it
 * hands back points at this application instead of at a bucket, and the upload
 * route writes the bytes. Keeping the shape identical means a client works
 * against either driver without knowing which is configured.
 *
 * Not for production. There is no replication, no lifecycle policy, and the
 * files live on whichever replica happened to serve the request.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly root: string;

  constructor(@Inject(STORAGE_OPTIONS) private readonly options: StorageOptions) {
    this.root = resolve(options.localRoot ?? join(process.cwd(), '.local-storage'));
  }

  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload> {
    return Promise.resolve({
      // Relative on purpose: the browser resolves it against the API origin, so
      // this works on any host and port without another environment variable.
      url: `${LOCAL_UPLOAD_PREFIX}/${this.options.bucket}/${request.key}`,
      method: 'PUT',
      headers: {
        [CONTENT_TYPE_HEADER]: request.contentType,
        [CONTENT_LENGTH_HEADER]: String(request.sizeBytes),
        // Stands in for the signature an S3 presigned URL carries: it proves the
        // caller was handed this exact key by this server, so the upload route
        // is not an open write endpoint for anyone who can guess a path.
        [UPLOAD_TOKEN_HEADER]: this.tokenFor(request.key),
      },
      expiresAt: new Date(Date.now() + request.expiresInSeconds * MS_PER_SECOND),
    });
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    try {
      const stats = await stat(this.pathFor(key));

      return { sizeBytes: stats.size, contentType: null };
    } catch {
      return null;
    }
  }

  async getObjectRange(key: string, bytes: number): Promise<Uint8Array | null> {
    try {
      const contents = await readFile(this.pathFor(key));

      return contents.subarray(0, Math.min(bytes, SIGNATURE_SAMPLE_BYTES));
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Called by the upload route once it has checked the token. */
  async putObject(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  tokenFor(key: string): string {
    return createHash('sha256')
      .update(`${this.options.secretAccessKey}:${key}`)
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * Refuses any key that would escape the storage root. A storage key comes from
   * this application, but treating it as trusted input is how a path traversal
   * turns into an arbitrary file write.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, normalize(key)));

    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error('Storage key resolved outside the storage root.');
    }

    return path;
  }
}
