import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { captureDomainError } from '../../../../test/support/domain-errors';
import {
  InMemoryFileStorage,
  InMemoryStoredFileRepository,
  TestJournal,
} from '../../../../test/support/in-memory';
import { PresignUploadUseCase } from './presign-upload.use-case';
import type { UploadLimits } from './upload.limits';

const OWNER_ID = newId();
const ORGANIZATION_ID = newId();
const PNG = 'image/png';
const LIMITS: UploadLimits = {
  maxFileBytes: 5 * 1024 * 1024,
  presignExpirySeconds: 900,
  pendingTtlMinutes: 60,
};

function createHarness() {
  const journal = new TestJournal();
  const files = new InMemoryStoredFileRepository({ journal });
  const storage = new InMemoryFileStorage({ journal });

  return {
    journal,
    files,
    storage,
    useCase: new PresignUploadUseCase(files, storage, LIMITS),
  };
}

const VALID_INPUT = {
  organizationId: ORGANIZATION_ID,
  ownerId: OWNER_ID,
  filename: 'holiday.png',
  mimeType: PNG,
  sizeBytes: 2048,
};

describe('PresignUploadUseCase', () => {
  it('writes the row BEFORE the policy is handed out', async () => {
    const harness = createHarness();

    const view = await harness.useCase.execute(VALID_INPUT);

    expect(harness.journal.trail()).toEqual(['files:save', 'storage:createUploadPolicy']);
    expect(harness.files.rowOf(view.fileId)?.status).toBe('pending');
  });

  it('derives the storage key from the server, never from the client', async () => {
    const harness = createHarness();

    const view = await harness.useCase.execute({
      ...VALID_INPUT,
      filename: '../../../etc/passwd.png',
    });

    const stored = harness.files.rowOf(view.fileId);
    expect(stored?.storageKey).toBe(`uploads/${ORGANIZATION_ID}/${OWNER_ID}/${view.fileId}`);
    expect(stored?.filename).toBe('passwd.png');
    expect(harness.storage.policies[0]!.key).toBe(stored?.storageKey);
  });

  it('scopes the policy to one content type, one exact length and the configured expiry', async () => {
    const harness = createHarness();

    const view = await harness.useCase.execute(VALID_INPUT);

    expect(harness.storage.policies).toEqual([
      {
        key: `uploads/${ORGANIZATION_ID}/${OWNER_ID}/${view.fileId}`,
        contentType: PNG,
        sizeBytes: 2048,
        expiresInSeconds: LIMITS.presignExpirySeconds,
      },
    ]);
    expect(view.method).toBe('PUT');
    expect(view.maxSizeBytes).toBe(LIMITS.maxFileBytes);
  });

  it('refuses a type that is not on the allow-list, before writing anything', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() =>
      harness.useCase.execute({ ...VALID_INPUT, mimeType: 'application/x-msdownload' }),
    );

    expect(error.kind).toBe('validation');
    expect(error.code).toBe(ERROR_CODES.UPLOAD_MIME_NOT_ALLOWED);
    expect(harness.journal.trail()).toEqual([]);
    expect(harness.files.size).toBe(0);
  });

  it('refuses a size above the ceiling, and a zero-length one', async () => {
    const harness = createHarness();

    const tooLarge = await captureDomainError(() =>
      harness.useCase.execute({ ...VALID_INPUT, sizeBytes: LIMITS.maxFileBytes + 1 }),
    );
    const empty = await captureDomainError(() =>
      harness.useCase.execute({ ...VALID_INPUT, sizeBytes: 0 }),
    );

    expect(tooLarge.code).toBe(ERROR_CODES.UPLOAD_SIZE_EXCEEDED);
    expect(empty.code).toBe(ERROR_CODES.UPLOAD_SIZE_EXCEEDED);
    expect(harness.files.size).toBe(0);
    expect(harness.storage.policies).toEqual([]);
  });

  it('accepts exactly the ceiling — the limit is inclusive', async () => {
    const harness = createHarness();

    const view = await harness.useCase.execute({
      ...VALID_INPUT,
      sizeBytes: LIMITS.maxFileBytes,
    });

    expect(harness.files.rowOf(view.fileId)?.declaredSizeBytes).toBe(LIMITS.maxFileBytes);
  });

  it('refuses a filename that sanitises to nothing', async () => {
    const harness = createHarness();

    const error = await captureDomainError(() =>
      harness.useCase.execute({ ...VALID_INPUT, filename: '../..' }),
    );

    expect(error.code).toBe(ERROR_CODES.UPLOAD_FILENAME_INVALID);
    expect(harness.files.size).toBe(0);
  });

  it('leaves the row pending with no verified facts — the file is not usable yet', async () => {
    const harness = createHarness();

    const view = await harness.useCase.execute(VALID_INPUT);

    const stored = harness.files.rowOf(view.fileId);
    expect(stored?.isUsable).toBe(false);
    expect(stored?.verifiedMimeType).toBeNull();
    expect(stored?.verifiedSizeBytes).toBeNull();
    expect(stored?.confirmedAt).toBeNull();
  });
});
