import type { StoredFile } from '../domain/stored-file.entity';
import type { StoredFileView } from './dto/upload.dto';

export function toStoredFileView(file: StoredFile): StoredFileView {
  return {
    id: file.id,
    ownerId: file.ownerId,
    filename: file.filename,

    mimeType: file.verifiedMimeType ?? file.declaredMimeType,
    sizeBytes: file.verifiedSizeBytes ?? file.declaredSizeBytes,
    status: file.status,
    createdAt: file.createdAt.toISOString(),
    confirmedAt: file.confirmedAt?.toISOString() ?? null,
  };
}
