import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { buildPinoHttpOptions, isQuietPath } from './logger';

function logOnce(payload: object): { line: string; entry: Record<string, unknown> } {
  const lines: string[] = [];
  const logger = pino(
    buildPinoHttpOptions({ level: 'info', role: 'test', trustInboundRequestId: false }),
    {
      write: (line: string) => {
        lines.push(line);
      },
    },
  );

  logger.info(payload, 'request completed');

  const line = lines[0] ?? '';

  return { line, entry: JSON.parse(line) as Record<string, unknown> };
}

describe('buildPinoHttpOptions', () => {
  it('takes the level from the options it is given', () => {
    expect(
      buildPinoHttpOptions({ level: 'debug', role: 'test', trustInboundRequestId: false }).level,
    ).toBe('debug');
  });

  it('writes the level as a name and the time as ISO-8601', () => {
    const { entry } = logOnce({ orderId: 'abc' });

    expect(entry.level).toBe('info');
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('redacts secrets at the top level', () => {
    const { line } = logOnce({ password: 'leaked-1', token: 'leaked-2', secret: 'leaked-3' });

    expect(line).not.toContain('leaked');
    expect(line).toContain('[REDACTED]');
  });

  it('redacts request headers, which sit three levels down', () => {
    const { line } = logOnce({
      req: { headers: { authorization: 'Bearer leaked', cookie: 'session=leaked' } },
    });

    expect(line).not.toContain('leaked');
    expect(line).toContain('[REDACTED]');
  });

  it('redacts the session cookie under its dotted name', () => {
    const { line } = logOnce({ cookies: { 'better-auth.session_token': 'leaked' } });

    expect(line).not.toContain('leaked');
  });

  it('redacts a set-cookie header on the response', () => {
    const { line } = logOnce({ res: { headers: { 'set-cookie': 'leaked' } } });

    expect(line).not.toContain('leaked');
  });

  it('redacts s3 credentials wherever they are nested', () => {
    const { line } = logOnce({
      storage: { config: { accessKeyId: 'leaked', secretAccessKey: 'leaked' } },
    });

    expect(line).not.toContain('leaked');
  });

  it('redacts a newPassword arriving on a request body', () => {
    const { line } = logOnce({ req: { body: { newPassword: 'leaked' } } });

    expect(line).not.toContain('leaked');
  });
});

describe('isQuietPath', () => {
  it('drops the completed-request line for a scrape', () => {
    expect(isQuietPath('/metrics', ['/metrics'])).toBe(true);
    expect(isQuietPath('/metrics?debug=1', ['/metrics'])).toBe(true);
  });

  it('keeps every other route, including one that merely starts the same', () => {
    expect(isQuietPath('/metrics-admin', ['/metrics'])).toBe(false);
    expect(isQuietPath('/api/v1/users', ['/metrics'])).toBe(false);
    expect(isQuietPath(undefined, ['/metrics'])).toBe(false);
  });
});
