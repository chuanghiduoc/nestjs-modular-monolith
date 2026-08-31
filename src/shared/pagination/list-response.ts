export interface ListResponse<T> {
  readonly object: 'list';
  readonly url: string;
  readonly data: readonly T[];
  readonly hasMore: boolean;
  readonly lastCursor: string | null;
  readonly totalCount?: number;
}

export interface BuildListResponseInput<T> {
  readonly url: string;

  readonly rows: readonly T[];
  readonly limit: number;
  readonly cursorOf: (row: T) => string;
  readonly totalCount?: number;
}

export function buildListResponse<T>({
  url,
  rows,
  limit,
  cursorOf,
  totalCount,
}: BuildListResponseInput<T>): ListResponse<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    object: 'list',
    url,
    data,
    hasMore,
    lastCursor: last === undefined ? null : cursorOf(last),
    ...(totalCount === undefined ? {} : { totalCount }),
  };
}
