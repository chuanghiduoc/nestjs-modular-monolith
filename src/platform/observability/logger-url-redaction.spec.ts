import { PassThrough } from 'node:stream';

import pinoHttp from 'pino-http';
import { describe, expect, it } from 'vitest';

import { buildPinoHttpOptions } from './logger';

const RESET_TOKEN = 'RESET-TOKEN-THAT-TAKES-OVER-THE-ACCOUNT';

interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
}

async function logOneRequest(url: string): Promise<string> {
  const captured = new PassThrough();
  const chunks: string[] = [];

  captured.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));

  const middleware = pinoHttp(
    { ...buildPinoHttpOptions({ level: 'info', role: 'api', trustInboundRequestId: false }) },
    captured,
  );

  const request: FakeRequest = {
    method: 'GET',
    url,
    headers: { host: 'api.example.com' },
    socket: { remoteAddress: '127.0.0.1' },
  };

  const response = new PassThrough() as unknown as Parameters<typeof middleware>[1];

  Object.assign(response, {
    statusCode: 200,
    getHeader: () => undefined,
    setHeader: () => undefined,
  });

  middleware(request as unknown as Parameters<typeof middleware>[0], response);

  (response as unknown as PassThrough).emit('finish');

  await new Promise((resolve) => setImmediate(resolve));

  return chunks.join('');
}

describe('request logging never records a credential from the URL', () => {
  it('redacts a token in the query string', async () => {
    const line = await logOneRequest(`/api/auth/verify-email?token=${RESET_TOKEN}&redirect=/home`);

    expect(line).not.toContain(RESET_TOKEN);
    expect(line).toContain('/api/auth/verify-email');
    expect(line).toContain('redirect');
  });

  it('redacts a token that Better Auth puts in the path', async () => {
    const line = await logOneRequest(`/api/auth/reset-password/${RESET_TOKEN}`);

    expect(line).not.toContain(RESET_TOKEN);
    expect(line).toContain('/api/auth/reset-password');
  });

  it('leaves an ordinary URL readable', async () => {
    const line = await logOneRequest('/api/v1/users/me?limit=20');

    expect(line).toContain('/api/v1/users/me');
    expect(line).toContain('limit');
  });
});
