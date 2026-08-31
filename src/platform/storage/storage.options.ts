export const FILE_DRIVERS = ['s3-presigned', 'local'] as const;
export type FileDriver = (typeof FILE_DRIVERS)[number];

export interface StorageOptions {
  /**
   * `local` writes to the filesystem and serves its own upload route, so the
   * development stack does not need object storage running. `s3-presigned` is
   * the production driver.
   */
  readonly driver: FileDriver;

  readonly bucket: string;
  readonly region: string;

  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;

  readonly forcePathStyle: boolean;

  readonly connectionTimeoutMs?: number;

  readonly requestTimeoutMs?: number;

  /** Where the local driver keeps its files. */
  readonly localRoot?: string;
}

export const STORAGE_OPTIONS = Symbol('STORAGE_OPTIONS');
