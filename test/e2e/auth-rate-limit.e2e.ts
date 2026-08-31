import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { CREDENTIAL_PATHS } from '../../src/bootstrap/fastify';
import { startTestApi, type TestApi } from '../support/api-app';

const ACCOUNT_ATTEMPTS = 3;
const WRONG_PASSWORD = 'definitely-not-the-password';

describe('credential rate limiting (e2e)', () => {
  let api: TestApi;
  let server: Server;
  let authPath: string;

  beforeAll(async () => {
    api = await startTestApi({ authAccountRateLimitMax: ACCOUNT_ATTEMPTS });
    server = api.server;
    authPath = `/${api.env.API_PREFIX}/auth`;
  });

  afterAll(async () => {
    await api?.stop();
  });

  async function signIn(email: string): Promise<request.Response> {
    return request(server)
      .post(`${authPath}/sign-in/email`)
      .send({ email, password: WRONG_PASSWORD });
  }

  it('locks a single account after its budget, and says so in problem+json', async () => {
    const email = `${newId()}@example.com`;

    for (let attempt = 0; attempt < ACCOUNT_ATTEMPTS; attempt++) {
      expect((await signIn(email)).status).toBe(401);
    }

    const blocked = await signIn(email);

    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body).toMatchObject({
      status: 429,
      code: ERROR_CODES.RATE_LIMITED,
      type: '/errors/rate-limited',
    });
  });

  it('does not punish a different account on the same IP', async () => {
    const victim = `${newId()}@example.com`;
    const bystander = `${newId()}@example.com`;

    for (let attempt = 0; attempt <= ACCOUNT_ATTEMPTS; attempt++) {
      await signIn(victim);
    }

    expect((await signIn(victim)).status).toBe(429);
    expect((await signIn(bystander)).status).toBe(401);
  });

  it('counts an account bucket per email, not per credential path', async () => {
    const email = `${newId()}@example.com`;

    for (let attempt = 0; attempt < ACCOUNT_ATTEMPTS; attempt++) {
      await signIn(email);
    }

    const otherPath = await request(server)
      .post(`${authPath}/request-password-reset`)
      .send({ email, redirectTo: api.env.FRONTEND_BASE_URL });

    expect(otherPath.status).toBe(429);
  });

  it('leaves a request without an email body alone', async () => {
    const response = await request(server).get(`${authPath}/get-session`);

    expect(response.status).not.toBe(429);
  });

  it('guards only paths Better Auth actually serves', async () => {
    const missing: string[] = [];

    for (const path of CREDENTIAL_PATHS) {
      const response = await request(server).post(`${authPath}${path}`).send({});

      if (response.status === 404) {
        missing.push(path);
      }
    }

    expect(missing, 'a guarded path that Better Auth no longer serves protects nothing').toEqual(
      [],
    );
  });
});
