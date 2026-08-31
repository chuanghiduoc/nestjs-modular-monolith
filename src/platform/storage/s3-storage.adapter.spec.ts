import { Readable } from 'node:stream';

import type * as AwsS3 from '@aws-sdk/client-s3';
import { NoSuchKey, NotFound, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGNATURE_SAMPLE_BYTES } from '#shared/util';

import { S3StorageAdapter } from './s3-storage.adapter';
import type { StorageOptions } from './storage.options';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  clientConfig: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof AwsS3>();

  class FakeS3Client {
    constructor(config: unknown) {
      mocks.clientConfig(config);
    }

    readonly send = mocks.send;
    readonly destroy = mocks.destroy;
  }

  return { ...actual, S3Client: FakeS3Client };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.getSignedUrl }));

const OPTIONS: StorageOptions = {
  driver: 's3-presigned',
  bucket: 'app-uploads',
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  forcePathStyle: true,
};

const KEY = 'uploads/019dd1a5-9235-70db-8d57-54ef901d8185';

function notFound(): NotFound {
  return new NotFound({ $metadata: { httpStatusCode: 404 }, message: 'Not Found' });
}

function rangeBody(bytes: Uint8Array): Readable & { transformToByteArray(): Promise<Uint8Array> } {
  const stream = Readable.from([Buffer.from(bytes)]);

  return Object.assign(stream, { transformToByteArray: () => Promise.resolve(bytes) });
}

describe('S3StorageAdapter', () => {
  let adapter: S3StorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSignedUrl.mockResolvedValue('https://storage.test/signed');
    adapter = new S3StorageAdapter(OPTIONS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('client configuration', () => {
    it('passes forcePathStyle and the endpoint through, so MinIO is addressable', () => {
      expect(mocks.clientConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          forcePathStyle: true,
          endpoint: 'http://localhost:9000',
          region: 'us-east-1',
        }),
      );
    });

    it('disables opportunistic checksums, which would hoist a stale CRC into every presign', () => {
      expect(mocks.clientConfig).toHaveBeenCalledWith(
        expect.objectContaining({ requestChecksumCalculation: 'WHEN_REQUIRED' }),
      );
    });

    it('bounds connect and request time explicitly', () => {
      expect(mocks.clientConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
        }),
      );
    });
  });

  describe('createPresignedUpload', () => {
    it('scopes the policy to one key, one type and one exact length', async () => {
      await adapter.createPresignedUpload({
        key: KEY,
        contentType: 'image/png',
        sizeBytes: 2_048,
        expiresInSeconds: 300,
      });

      const command = mocks.getSignedUrl.mock.calls[0]![1] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'app-uploads',
        Key: KEY,
        ContentType: 'image/png',
        ContentLength: 2_048,
      });
    });

    it('signs content-type and content-length, which are not signed by default', async () => {
      await adapter.createPresignedUpload({
        key: KEY,
        contentType: 'image/png',
        sizeBytes: 2_048,
        expiresInSeconds: 300,
      });

      expect(mocks.getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 300,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
    });

    it('returns the headers the client must replay verbatim', async () => {
      const presigned = await adapter.createPresignedUpload({
        key: KEY,
        contentType: 'image/png',
        sizeBytes: 2_048,
        expiresInSeconds: 300,
      });

      expect(presigned.url).toBe('https://storage.test/signed');
      expect(presigned.method).toBe('PUT');
      expect(presigned.headers).toEqual({
        'content-type': 'image/png',
        'content-length': '2048',
      });
    });

    it('derives expiresAt from the same expiry it signed', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-16T10:00:00.000Z'));

      const presigned = await adapter.createPresignedUpload({
        key: KEY,
        contentType: 'image/png',
        sizeBytes: 1,
        expiresInSeconds: 300,
      });

      expect(presigned.expiresAt.toISOString()).toBe('2026-08-16T10:05:00.000Z');
    });

    it('propagates a presigner failure instead of returning an unusable policy', async () => {
      mocks.getSignedUrl.mockRejectedValueOnce(new Error('no credentials'));

      await expect(
        adapter.createPresignedUpload({
          key: KEY,
          contentType: 'image/png',
          sizeBytes: 1,
          expiresInSeconds: 300,
        }),
      ).rejects.toThrow('no credentials');
    });
  });

  describe('headObject', () => {
    it('reports the real size and content type', async () => {
      mocks.send.mockResolvedValueOnce({ ContentLength: 1_234, ContentType: 'image/png' });

      await expect(adapter.headObject(KEY)).resolves.toEqual({
        sizeBytes: 1_234,
        contentType: 'image/png',
      });
    });

    it('answers null for an object that is not there', async () => {
      mocks.send.mockRejectedValueOnce(notFound());

      await expect(adapter.headObject(KEY)).resolves.toBeNull();
    });

    it('rethrows anything that is not a missing object', async () => {
      mocks.send.mockRejectedValueOnce(new Error('connection reset'));

      await expect(adapter.headObject(KEY)).rejects.toThrow('connection reset');
    });

    it('fails loudly when storage answers without a content-length', async () => {
      mocks.send.mockResolvedValueOnce({ ContentType: 'image/png' });

      await expect(adapter.headObject(KEY)).rejects.toThrow(/content-length/);
    });
  });

  describe('getObjectRange', () => {
    it('requests only the signature sample, as an inclusive byte range', async () => {
      mocks.send.mockResolvedValueOnce({ Body: rangeBody(new Uint8Array([1, 2, 3])) });

      await adapter.getObjectRange(KEY, SIGNATURE_SAMPLE_BYTES);

      const command = mocks.send.mock.calls[0]![0] as { input: { Range?: string } };
      expect(command.input.Range).toBe('bytes=0-4099');
    });

    it('returns the sampled bytes', async () => {
      mocks.send.mockResolvedValueOnce({ Body: rangeBody(new Uint8Array([137, 80, 78, 71])) });

      await expect(adapter.getObjectRange(KEY, 4)).resolves.toEqual(
        new Uint8Array([137, 80, 78, 71]),
      );
    });

    it('destroys the stream once it has been read', async () => {
      const body = rangeBody(new Uint8Array([1]));
      mocks.send.mockResolvedValueOnce({ Body: body });

      await adapter.getObjectRange(KEY, 1);

      expect(body.destroyed).toBe(true);
    });

    it('destroys the stream when reading it throws', async () => {
      const body = Object.assign(Readable.from([Buffer.from([1])]), {
        transformToByteArray: () => Promise.reject(new Error('truncated')),
      });
      mocks.send.mockResolvedValueOnce({ Body: body });

      await expect(adapter.getObjectRange(KEY, 1)).rejects.toThrow('truncated');
      expect(body.destroyed).toBe(true);
    });

    it('answers null for an object that is not there', async () => {
      mocks.send.mockRejectedValueOnce(
        new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: 'No such key' }),
      );

      await expect(adapter.getObjectRange(KEY, 16)).resolves.toBeNull();
    });

    it('rejects a range that would not fit in memory', async () => {
      await expect(adapter.getObjectRange(KEY, SIGNATURE_SAMPLE_BYTES + 1)).rejects.toThrow(
        RangeError,
      );
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('rejects a non-positive range', async () => {
      await expect(adapter.getObjectRange(KEY, 0)).rejects.toThrow(RangeError);
    });
  });

  describe('deleteObject', () => {
    it('deletes exactly the key it was given', async () => {
      mocks.send.mockResolvedValueOnce({});

      await adapter.deleteObject(KEY);

      const command = mocks.send.mock.calls[0]![0] as { input: { Bucket: string; Key: string } };
      expect(command.input).toEqual({ Bucket: 'app-uploads', Key: KEY });
    });
  });

  it('destroys the client on shutdown so its sockets do not outlive the process', () => {
    adapter.onModuleDestroy();

    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
