import { validate as isUuid, version as uuidVersion } from 'uuid';

import { DomainErrors, ERROR_CODES } from '../errors';

const SEPARATOR = ':';

export interface DecodedCursor {
  readonly sortValue: Date;
  readonly id: string;
}
export function encodeCursor(sortValue: Date, id: string): string {
  return Buffer.from(`${sortValue.toISOString()}${SEPARATOR}${id}`, 'utf8').toString('base64url');
}
export function decodeCursor(raw: string): DecodedCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const boundary = decoded.lastIndexOf(SEPARATOR);
  if (boundary <= 0) {
    throw malformedCursor(raw);
  }
  const timestampPart = decoded.slice(0, boundary);
  const id = decoded.slice(boundary + SEPARATOR.length);
  const sortValue = new Date(timestampPart);
  if (Number.isNaN(sortValue.getTime()) || sortValue.toISOString() !== timestampPart) {
    throw malformedCursor(raw);
  }
  if (!isUuid(id) || uuidVersion(id) !== 7) {
    throw malformedCursor(raw);
  }

  return { sortValue, id };
}
export function decodeOptionalCursor(raw: string | undefined | null): DecodedCursor | null {
  return raw === undefined || raw === null || raw === '' ? null : decodeCursor(raw);
}

function malformedCursor(raw: string): Error {
  void raw;

  return DomainErrors.malformed(
    ERROR_CODES.CURSOR_MALFORMED,
    'The pagination cursor could not be decoded.',
  );
}
