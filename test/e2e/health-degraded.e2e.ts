import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';

import { startTestApi, type TestApi } from '../support/api-app';

interface DependencyCheckBody {
  readonly name: string;
  readonly status: string;
}

describe('health under a dead dependency (e2e)', () => {
  let api: TestApi;
  let server: Server;

  beforeAll(async () => {
    api = await startTestApi();
    server = api.server;
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('reports ready while Postgres is reachable', async () => {
    const response = await request(server).get('/health/ready');

    expect(response.status).toBe(200);
  });

  it('answers 503 problem+json naming the dependency that died', async () => {
    await api.database.stop();

    const response = await request(server).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['retry-after']).toBeDefined();

    expect(response.body).toMatchObject({
      status: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      type: '/errors/service-unavailable',
      title: 'Service unavailable',
    });

    const body = response.body as { readonly checks?: readonly DependencyCheckBody[] };
    const checks = body.checks;

    expect(checks).toBeDefined();
    expect(checks?.find((check) => check.name === 'postgres')?.status).toBe('down');

    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain(api.database.connectionString);
    expect(serialised).not.toContain('ECONNREFUSED');
  });
});
