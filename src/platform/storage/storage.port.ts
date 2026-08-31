export interface PresignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface PresignedUploadRequest {
  readonly key: string;
  readonly contentType: string;

  readonly sizeBytes: number;
  readonly expiresInSeconds: number;
}

export interface StoredObjectHead {
  readonly sizeBytes: number;

  readonly contentType: string | null;
}

export interface StoragePort {
  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload>;

  headObject(key: string): Promise<StoredObjectHead | null>;

  getObjectRange(key: string, bytes: number): Promise<Uint8Array | null>;

  deleteObject(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');
