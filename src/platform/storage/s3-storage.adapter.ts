import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';

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
const MS_PER_SECOND = 1000;

const DEFAULT_CONNECTION_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const MAX_ATTEMPTS = 3;

const MAX_RANGE_BYTES = SIGNATURE_SAMPLE_BYTES;

interface S3CommandClient {
  send<TOutput extends object>(command: object): Promise<TOutput>;
  destroy(): void;
}

function isObjectMissing(error: unknown): boolean {
  return error instanceof NotFound || error instanceof NoSuchKey;
}

@Injectable()
export class S3StorageAdapter implements StoragePort, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly commandClient: S3CommandClient;

  constructor(@Inject(STORAGE_OPTIONS) private readonly options: StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      // Omitting credentials hands the decision to the SDK's own provider chain,
      // which is how an instance or IRSA role is picked up. Passing empty static
      // keys instead would shadow that role and fail with a signature error.
      ...(options.accessKeyId === '' || options.secretAccessKey === ''
        ? {}
        : {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }),
      maxAttempts: MAX_ATTEMPTS,
      requestHandler: {
        connectionTimeout: options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
        requestTimeout: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      },

      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.commandClient = this.client;
  }

  async createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: request.key,
      ContentType: request.contentType,
      ContentLength: request.sizeBytes,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: request.expiresInSeconds,

      signableHeaders: new Set([CONTENT_TYPE_HEADER, CONTENT_LENGTH_HEADER]),
    });

    return {
      url,
      method: 'PUT',
      headers: {
        [CONTENT_TYPE_HEADER]: request.contentType,
        [CONTENT_LENGTH_HEADER]: String(request.sizeBytes),
      },
      expiresAt: new Date(Date.now() + request.expiresInSeconds * MS_PER_SECOND),
    };
  }

  async headObject(key: string): Promise<StoredObjectHead | null> {
    const response = await this.sendHead(key);
    if (response === null) {
      return null;
    }
    if (response.ContentLength === undefined) {
      throw new Error(`Storage returned no content-length for object "${key}".`);
    }

    return { sizeBytes: response.ContentLength, contentType: response.ContentType ?? null };
  }

  async getObjectRange(key: string, bytes: number): Promise<Uint8Array | null> {
    assertReadableRange(bytes);

    const response = await this.sendRangedGet(key, bytes);
    if (response === null) {
      return null;
    }

    const body = response.Body;
    if (body === undefined) {
      throw new Error(`Storage returned no body for object "${key}".`);
    }

    try {
      return await body.transformToByteArray();
    } finally {
      if (body instanceof Readable) {
        body.destroy();
      }
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.commandClient.send<object>(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }

  onModuleDestroy(): void {
    this.commandClient.destroy();
  }

  private async sendHead(key: string): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.commandClient.send<HeadObjectCommandOutput>(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
    } catch (error: unknown) {
      if (isObjectMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  private async sendRangedGet(key: string, bytes: number): Promise<GetObjectCommandOutput | null> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: key,

      Range: `bytes=0-${String(bytes - 1)}`,
    });

    try {
      return await this.commandClient.send<GetObjectCommandOutput>(command);
    } catch (error: unknown) {
      if (isObjectMissing(error)) {
        return null;
      }
      throw error;
    }
  }
}

function assertReadableRange(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_RANGE_BYTES) {
    throw new RangeError(
      `getObjectRange accepts 1..${String(MAX_RANGE_BYTES)} bytes, received ${String(bytes)}.`,
    );
  }
}
