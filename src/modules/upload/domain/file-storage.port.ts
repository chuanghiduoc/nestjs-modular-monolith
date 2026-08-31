export interface UploadPolicy {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface StoredObjectFacts {
  readonly sizeBytes: number;

  readonly detectedMimeType: string | null;
}

export interface FileStoragePort {
  createUploadPolicy(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadPolicy>;

  inspect(key: string): Promise<StoredObjectFacts | null>;

  remove(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
