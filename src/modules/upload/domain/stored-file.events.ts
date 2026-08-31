/** Why an upload ended without becoming a usable file. */
export type DiscardReason = 'content-mismatch' | 'type-not-allowed' | 'never-uploaded';

export interface StoredFileConfirmed {
  readonly kind: 'StoredFileConfirmed';
  readonly fileId: string;
  readonly organizationId: string;
  readonly ownerId: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly confirmedAt: Date;
}

export interface StoredFileDiscarded {
  readonly kind: 'StoredFileDiscarded';
  readonly fileId: string;
  readonly storageKey: string;
  readonly reason: DiscardReason;
  readonly at: Date;
}

export type StoredFileEvent = StoredFileConfirmed | StoredFileDiscarded;
