import { describe, expect, it } from 'vitest';

import { isDomainException } from '#shared/errors';
import { isUuidV7 } from '#shared/util';

import { ALLOWED_MIME_TYPES, StoredFile } from './stored-file.entity';

const MAX_BYTES = 10_485_760;

function presign(overrides: Partial<Parameters<typeof StoredFile.presign>[0]> = {}): StoredFile {
  return StoredFile.presign({
    organizationId: '01a00b30-ba56-7798-9b1e-1ae5a6f3ad56',
    ownerId: '01a00b30-ba56-7798-9b1e-1ae5a6f3ad55',
    filename: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    maxSizeBytes: MAX_BYTES,
    ...overrides,
  });
}

function confirmed(): StoredFile {
  const file = presign();
  file.confirm({ mimeType: 'image/png', sizeBytes: 1024 });

  return file;
}

describe('StoredFile.presign', () => {
  it('starts pending, unusable, with a v7 id', () => {
    const file = presign();

    expect(file.status).toBe('pending');
    expect(file.isUsable).toBe(false);
    expect(isUuidV7(file.id)).toBe(true);
  });

  it('derives the storage key from the owner and the id, never from the client', () => {
    const file = presign({ filename: 'anything.png' });

    expect(file.storageKey).toBe(`uploads/${file.organizationId}/${file.ownerId}/${file.id}`);
    expect(file.storageKey).not.toContain('anything');
  });

  it('keeps only the basename of a traversing filename', () => {
    expect(presign({ filename: '../../etc/passwd' }).filename).toBe('passwd');
    expect(presign({ filename: 'C:\\Windows\\system32\\evil.png' }).filename).toBe('evil.png');
  });

  it('strips characters that would steer a Content-Disposition header', () => {
    const file = presign({ filename: `re${String.fromCharCode(13, 10)}port".png` });

    expect(file.filename).not.toContain('"');
    expect(file.filename).not.toContain(String.fromCharCode(13));
    expect(file.filename).not.toContain(String.fromCharCode(10));
  });

  it('rejects a filename that sanitises down to nothing', () => {
    expect(() => presign({ filename: '..' })).toThrowError();
    expect(() => presign({ filename: String.fromCharCode(0, 1, 2) })).toThrowError();
  });

  it('rejects a mime type that is not on the allow-list', () => {
    expect(() => presign({ mimeType: 'application/x-msdownload' })).toThrowError();
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(presign({ mimeType }).declaredMimeType).toBe(mimeType);
    }
  });

  it('rejects a size of zero or above the ceiling, and accepts the boundary', () => {
    expect(() => presign({ sizeBytes: 0 })).toThrowError();
    expect(() => presign({ sizeBytes: MAX_BYTES + 1 })).toThrowError();
    expect(presign({ sizeBytes: MAX_BYTES }).declaredSizeBytes).toBe(MAX_BYTES);
  });

  it('throws a validation DomainException, not a bare Error', () => {
    try {
      presign({ sizeBytes: 0 });
      expect.unreachable('presign should have thrown');
    } catch (error) {
      expect(isDomainException(error)).toBe(true);
      if (isDomainException(error)) {
        expect(error.kind).toBe('validation');
      }
    }
  });
});

describe('StoredFile.confirm', () => {
  it('accepts bytes that match what was declared', () => {
    const file = presign();

    file.confirm({ mimeType: 'image/png', sizeBytes: 1024 });

    expect(file.status).toBe('confirmed');
    expect(file.isUsable).toBe(true);
    expect(file.verifiedMimeType).toBe('image/png');
    expect(file.verifiedSizeBytes).toBe(1024);
    expect(file.confirmedAt).not.toBeNull();
  });

  it('emits exactly one StoredFileConfirmed carrying the facts a consumer needs', () => {
    const file = presign();
    file.confirm({ mimeType: 'image/png', sizeBytes: 1024 });

    const events = file.pullEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'StoredFileConfirmed',
      fileId: file.id,
      ownerId: file.ownerId,
      storageKey: file.storageKey,
      mimeType: 'image/png',
      sizeBytes: 1024,
    });
  });

  it('DISCARDS the file when the stored size differs, then throws', () => {
    const file = presign({ sizeBytes: 1024 });

    expect(() => file.confirm({ mimeType: 'image/png', sizeBytes: 2048 })).toThrowError();
    expect(file.status).toBe('discarded');
    expect(file.isUsable).toBe(false);
  });

  it('DISCARDS the file when the real bytes are not an allowed type', () => {
    const file = presign();

    expect(() =>
      file.confirm({ mimeType: 'application/x-msdownload', sizeBytes: 1024 }),
    ).toThrowError();
    expect(file.status).toBe('discarded');
  });

  it('DISCARDS the file when the bytes are an allowed type, but not the declared one', () => {
    // Both types are on the allow-list; the pair is still a lie, and the object
    // store would keep serving these bytes as the type that was declared.
    const file = presign({ mimeType: 'image/png' });

    expect(() => file.confirm({ mimeType: 'application/pdf', sizeBytes: 1024 })).toThrowError();
    expect(file.status).toBe('discarded');
    expect(file.isUsable).toBe(false);
    expect(file.pullEvents()[0]).toMatchObject({ reason: 'content-mismatch' });
  });

  it('accepts every allowed type when the bytes are the type that was declared', () => {
    for (const mimeType of ALLOWED_MIME_TYPES) {
      const file = presign({ mimeType });

      file.confirm({ mimeType, sizeBytes: 1024 });

      expect(file.status).toBe('confirmed');
      expect(file.verifiedMimeType).toBe(mimeType);
    }
  });

  it('DISCARDS the file when the bytes were not recognised at all', () => {
    const file = presign();

    expect(() => file.confirm({ mimeType: null, sizeBytes: 1024 })).toThrowError();
    expect(file.status).toBe('discarded');
  });

  it('treats a second confirm as a conflict that waiting will not fix', () => {
    const file = confirmed();

    try {
      file.confirm({ mimeType: 'image/png', sizeBytes: 1024 });
      expect.unreachable('a second confirm should conflict');
    } catch (error) {
      expect(isDomainException(error)).toBe(true);
      if (isDomainException(error)) {
        expect(error.kind).toBe('conflict');
        expect(error.permanent).toBe(true);
      }
    }
    expect(file.status).toBe('confirmed');
  });

  it('refuses to confirm a file that was already discarded', () => {
    const discarded = presign();
    discarded.discard('never-uploaded');

    expect(() => discarded.confirm({ mimeType: 'image/png', sizeBytes: 1024 })).toThrowError();
    expect(discarded.status).toBe('discarded');
  });
});

describe('StoredFile.discard', () => {
  it('ends a pending upload once, and records why', () => {
    const file = presign();

    file.discard('never-uploaded');
    const emitted = file.pullEvents();

    expect(file.status).toBe('discarded');
    expect(file.isUsable).toBe(false);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ kind: 'StoredFileDiscarded', reason: 'never-uploaded' });
  });

  it('is idempotent — a repeated sweep must not emit twice', () => {
    const file = presign();

    file.discard('never-uploaded');
    const first = file.pullEvents();
    file.discard('never-uploaded');

    expect(first).toHaveLength(1);
    expect(file.pullEvents()).toHaveLength(0);
  });

  it('refuses to discard a confirmed file — someone is relying on it', () => {
    // Removing a file a user already attached somewhere is a deletion decision,
    // not something a background sweep gets to make.
    const file = confirmed();
    file.pullEvents();

    file.discard('content-mismatch');

    expect(file.status).toBe('confirmed');
    expect(file.isUsable).toBe(true);
    expect(file.pullEvents()).toHaveLength(0);
  });

  it('records the reason the bytes were rejected', () => {
    const tooSmall = presign();

    expect(() => tooSmall.confirm({ mimeType: 'image/png', sizeBytes: 1 })).toThrowError();
    expect(tooSmall.status).toBe('discarded');
    expect(tooSmall.pullEvents()[0]).toMatchObject({ reason: 'content-mismatch' });

    const wrongType = presign();

    expect(() => wrongType.confirm({ mimeType: 'text/html', sizeBytes: 1024 })).toThrowError();
    expect(wrongType.status).toBe('discarded');
    expect(wrongType.pullEvents()[0]).toMatchObject({ reason: 'type-not-allowed' });
  });
});

describe('StoredFile.rehydrate', () => {
  it('restores state without emitting anything — nothing happened', () => {
    const file = StoredFile.rehydrate({
      id: '01a00b30-ba56-7798-9b1e-1ae5a6f3ad55',
      organizationId: '01a00b30-ba56-7798-9b1e-1ae5a6f3ad56',
      ownerId: '01a00b30-ba56-7798-9b1e-1ae5a6f3ad56',
      storageKey: 'uploads/x/y',
      filename: 'photo.png',
      declaredMimeType: 'image/png',
      declaredSizeBytes: 1024,
      verifiedMimeType: 'image/png',
      verifiedSizeBytes: 1024,
      status: 'confirmed',
      createdAt: new Date('2026-08-16T10:00:00.000Z'),
      confirmedAt: new Date('2026-08-16T10:01:00.000Z'),
    });

    expect(file.pullEvents()).toHaveLength(0);
    expect(file.isUsable).toBe(true);
  });

  it('drains events so a second save cannot republish them', () => {
    const file = confirmed();

    expect(file.pullEvents()).toHaveLength(1);
    expect(file.pullEvents()).toHaveLength(0);
  });
});
