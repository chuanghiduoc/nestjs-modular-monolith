import { describe, expect, it } from 'vitest';

import { buildListResponse } from './list-response';

interface Row {
  readonly id: string;
}

const cursorOf = (row: Row): string => `cursor-${row.id}`;
const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_value, index) => ({ id: String(index) }));

describe('buildListResponse', () => {
  it('drops the probe row and reports hasMore when limit + 1 rows came back', () => {
    const response = buildListResponse({ url: '/api/v1/users', rows: rows(3), limit: 2, cursorOf });

    expect(response.hasMore).toBe(true);
    expect(response.data).toHaveLength(2);
    expect(response.lastCursor).toBe('cursor-1');
  });

  it('reports hasMore false on a partial page', () => {
    const response = buildListResponse({ url: '/api/v1/users', rows: rows(2), limit: 5, cursorOf });

    expect(response.hasMore).toBe(false);
    expect(response.data).toHaveLength(2);
  });

  it('returns a null cursor for an empty page rather than an undefined key', () => {
    const response = buildListResponse({ url: '/api/v1/users', rows: [], limit: 5, cursorOf });

    expect(response.lastCursor).toBeNull();
    expect(response.data).toHaveLength(0);
  });

  it('omits totalCount entirely when it is unknown — never -1', () => {
    const response = buildListResponse({ url: '/api/v1/users', rows: rows(1), limit: 5, cursorOf });

    expect('totalCount' in response).toBe(false);
  });

  it('includes totalCount when the caller paid for the count', () => {
    const response = buildListResponse({
      url: '/api/v1/users',
      rows: rows(1),
      limit: 5,
      cursorOf,
      totalCount: 42,
    });

    expect(response.totalCount).toBe(42);
  });

  it('always reports object: list and the requested url', () => {
    const response = buildListResponse({
      url: '/api/v1/audit-logs',
      rows: rows(1),
      limit: 5,
      cursorOf,
    });

    expect(response.object).toBe('list');
    expect(response.url).toBe('/api/v1/audit-logs');
  });
});
