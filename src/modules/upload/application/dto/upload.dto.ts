export interface PresignedUploadView {
  readonly fileId: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly maxSizeBytes: number;
}

export interface StoredFileView {
  readonly id: string;
  readonly ownerId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}
