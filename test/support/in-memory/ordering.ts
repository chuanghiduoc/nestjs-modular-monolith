import type { DecodedCursor } from '#shared/pagination';

export interface SortKey {
  readonly sortValue: Date;
  readonly id: string;
}

function compareIds(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function comesAfterCursor(cursor: DecodedCursor | null, key: SortKey): boolean {
  if (cursor === null) {
    return true;
  }

  const rowTime = key.sortValue.getTime();
  const cursorTime = cursor.sortValue.getTime();

  return rowTime < cursorTime || (rowTime === cursorTime && compareIds(key.id, cursor.id) < 0);
}

export function byKeyDescending(left: SortKey, right: SortKey): number {
  const delta = right.sortValue.getTime() - left.sortValue.getTime();

  return delta !== 0 ? delta : compareIds(right.id, left.id);
}

export function byKeyAscending(left: SortKey, right: SortKey): number {
  const delta = left.sortValue.getTime() - right.sortValue.getTime();

  return delta !== 0 ? delta : compareIds(left.id, right.id);
}
