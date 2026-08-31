import { DomainErrors, ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import type { DiscardReason, StoredFileEvent } from './stored-file.events';

/**
 * Three states, not five.
 *
 * A presigned upload has to be confirmed, because the server never sees the
 * bytes — that is what `pending` and `confirmed` are for. Everything else ends
 * the same way: the row and its object get swept. Whether the upload was
 * abandoned or its content did not match what was declared changes the reason,
 * not the outcome, so both settle as `discarded`.
 */
export type StoredFileStatus = 'pending' | 'confirmed' | 'discarded';

export const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
];

export class StoredFile {
  private readonly events: StoredFileEvent[] = [];

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    readonly ownerId: string,
    readonly storageKey: string,
    readonly filename: string,
    readonly declaredMimeType: string,
    readonly declaredSizeBytes: number,
    private statusValue: StoredFileStatus,
    readonly createdAt: Date,
    private verifiedMime: string | null,
    private verifiedSize: number | null,
    private confirmedAtValue: Date | null,
  ) {}

  static presign(input: {
    organizationId: string;
    ownerId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    maxSizeBytes: number;
    now?: Date;
  }): StoredFile {
    if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
      throw DomainErrors.validation(
        ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED,
        'That file type is not accepted.',
      );
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > input.maxSizeBytes) {
      throw DomainErrors.validation(
        ERROR_CODES.UPLOAD_SIZE_EXCEEDED,
        `File size must be between 1 and ${String(input.maxSizeBytes)} bytes.`,
      );
    }

    const filename = sanitiseFilename(input.filename);
    const id = newId();

    return new StoredFile(
      id,
      input.organizationId,
      input.ownerId,
      `uploads/${input.organizationId}/${input.ownerId}/${id}`,
      filename,
      input.mimeType,
      input.sizeBytes,
      'pending',
      input.now ?? new Date(),
      null,
      null,
      null,
    );
  }

  static rehydrate(input: {
    id: string;
    organizationId: string;
    ownerId: string;
    storageKey: string;
    filename: string;
    declaredMimeType: string;
    declaredSizeBytes: number;
    verifiedMimeType: string | null;
    verifiedSizeBytes: number | null;
    status: StoredFileStatus;
    createdAt: Date;
    confirmedAt: Date | null;
  }): StoredFile {
    return new StoredFile(
      input.id,
      input.organizationId,
      input.ownerId,
      input.storageKey,
      input.filename,
      input.declaredMimeType,
      input.declaredSizeBytes,
      input.status,
      input.createdAt,
      input.verifiedMimeType,
      input.verifiedSizeBytes,
      input.confirmedAt,
    );
  }

  get status(): StoredFileStatus {
    return this.statusValue;
  }

  get verifiedMimeType(): string | null {
    return this.verifiedMime;
  }

  get verifiedSizeBytes(): number | null {
    return this.verifiedSize;
  }

  get confirmedAt(): Date | null {
    return this.confirmedAtValue;
  }

  /** Confirmed means the stored bytes were checked and matched. */
  get isUsable(): boolean {
    return this.statusValue === 'confirmed';
  }

  confirm(actual: { mimeType: string | null; sizeBytes: number }, now: Date = new Date()): void {
    if (this.statusValue === 'confirmed') {
      throw DomainErrors.conflict(
        ERROR_CODES.UPLOAD_ALREADY_CONFIRMED,
        'This upload was already confirmed.',
        true,
      );
    }
    if (this.statusValue !== 'pending') {
      throw DomainErrors.conflict(
        ERROR_CODES.UPLOAD_NOT_FOUND,
        'This upload is no longer awaiting confirmation.',
        true,
      );
    }
    if (actual.sizeBytes !== this.declaredSizeBytes) {
      this.discard('content-mismatch', now);
      throw DomainErrors.validation(
        ERROR_CODES.UPLOAD_CONTENT_MISMATCH,
        'The stored object does not match the declared size.',
      );
    }
    // The declared type is a claim; the leading bytes are the evidence. Without
    // this check a caller can upload script content under an accepted type.
    if (actual.mimeType === null || !ALLOWED_MIME_TYPES.includes(actual.mimeType)) {
      this.discard('type-not-allowed', now);
      throw DomainErrors.validation(
        ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED,
        'The stored bytes are not an accepted file type.',
      );
    }
    // Allowed is not the same as promised. The declared type is what the upload
    // URL was signed for and what the object store will hand these bytes back
    // as, so a PDF stored under an image/png claim is served as an image for the
    // rest of its life. Both types being acceptable on their own does not make
    // the pair acceptable.
    if (actual.mimeType !== this.declaredMimeType) {
      this.discard('content-mismatch', now);
      throw DomainErrors.validation(
        ERROR_CODES.UPLOAD_CONTENT_MISMATCH,
        'The stored object is not the file type that was declared.',
      );
    }

    this.statusValue = 'confirmed';
    this.verifiedMime = actual.mimeType;
    this.verifiedSize = actual.sizeBytes;
    this.confirmedAtValue = now;
    this.events.push({
      kind: 'StoredFileConfirmed',
      fileId: this.id,
      organizationId: this.organizationId,
      ownerId: this.ownerId,
      storageKey: this.storageKey,
      mimeType: actual.mimeType,
      sizeBytes: actual.sizeBytes,
      confirmedAt: now,
    });
  }

  /**
   * Ends the upload's life. Only a pending upload can be discarded — a
   * confirmed file is something a user is relying on, and removing it is a
   * deletion, not a sweep.
   */
  discard(reason: DiscardReason, now: Date = new Date()): void {
    if (this.statusValue !== 'pending') {
      return;
    }

    this.statusValue = 'discarded';
    this.events.push({
      kind: 'StoredFileDiscarded',
      fileId: this.id,
      storageKey: this.storageKey,
      reason,
      at: now,
    });
  }

  pullEvents(): readonly StoredFileEvent[] {
    return this.events.splice(0, this.events.length);
  }
}

function stripUnsafeCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;

      return code >= 32 && code !== 127 && character !== '"';
    })
    .join('');
}

function sanitiseFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'file';
  const cleaned = stripUnsafeCharacters(base).trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw DomainErrors.validation(ERROR_CODES.UPLOAD_FILENAME_INVALID, 'Invalid file name.');
  }

  return cleaned.slice(0, 255);
}
