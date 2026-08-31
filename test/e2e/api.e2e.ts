import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';

import { signInAsNewUser, startTestApi, type TestApi } from '../support/api-app';
import { expectProblemShape, fieldErrorsOf } from '../support/problem-details';

const REJECTED_DISPLAY_NAME = `${'A'.repeat(90)}-SUPERSECRET-VALUE`;
const REJECTED_AVATAR_ID = 'not-a-uuid-DEADBEEF';
const NEW_PASSWORD = 'e2e-password-rotated-2026';
const RESET_IDENTIFIER_PREFIX = 'reset-password:';

describe('API (e2e)', () => {
  let api: TestApi;
  let server: Server;
  let sessionCookie: string;

  beforeAll(async () => {
    api = await startTestApi();
    server = api.server;
    sessionCookie = (await signInAsNewUser(api, { role: 'admin' })).cookie;
  });

  afterAll(async () => {
    await api?.stop();
  });

  describe('probes', () => {
    it('answers /health/live without the API prefix or a version', async () => {
      const response = await request(server).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('answers /health/ready once Postgres and Redis are reachable', async () => {
      const response = await request(server).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'ok' });
    });
  });

  describe('authentication', () => {
    it('rejects an unauthenticated request with RFC 9457 problem+json', async () => {
      const response = await request(server).get(`/${api.env.API_PREFIX}/v1/users/me`);

      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expectProblemShape(response.body, {
        status: 401,
        code: ERROR_CODES.UNAUTHENTICATED,
        type: '/errors/unauthenticated',
        title: 'Authentication required',
      });
    });

    it('rewrites an error raised before the Nest pipeline as problem+json too', async () => {
      const response = await request(server).get(`/${api.env.API_PREFIX}/v1/no-such-route`);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expectProblemShape(response.body, {
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        type: '/errors/not-found',
        title: 'Not found',
      });
    });

    it('serves an authenticated route once a session cookie is present', async () => {
      const response = await request(server)
        .get(`/${api.env.API_PREFIX}/v1/users/me`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(404);
      expectProblemShape(response.body, {
        status: 404,
        code: ERROR_CODES.USER_PROFILE_NOT_FOUND,
        type: '/errors/user-profile-not-found',
        title: 'Not found',
      });
    });
  });

  describe('validation', () => {
    it('answers 422 with field errors and never echoes the rejected value', async () => {
      const response = await request(server)
        .patch(`/${api.env.API_PREFIX}/v1/users/me`)
        .set('Cookie', sessionCookie)
        .send({ displayName: REJECTED_DISPLAY_NAME, avatarFileId: REJECTED_AVATAR_ID });

      expect(response.status).toBe(422);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expectProblemShape(response.body, {
        status: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
        type: '/errors/validation-failed',
        title: 'Validation failed',
      });

      const errors = fieldErrorsOf(response.body);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.map((error) => error.path)).toContain('displayName');
      expect(errors.map((error) => error.path)).toContain('avatarFileId');

      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toContain('SUPERSECRET');
      expect(serialised).not.toContain(REJECTED_AVATAR_ID);
    });

    it('rejects an unknown property instead of silently dropping it', async () => {
      const response = await request(server)
        .patch(`/${api.env.API_PREFIX}/v1/users/me`)
        .set('Cookie', sessionCookie)
        .send({ displayName: 'Valid Name', misspelledField: 'ignored-by-a-lesser-pipe' });

      expect(response.status).toBe(422);
      expect(fieldErrorsOf(response.body).map((error) => error.path)).toContain('misspelledField');
      expect(JSON.stringify(response.body)).not.toContain('ignored-by-a-lesser-pipe');
    });

    it('rejects a UUID of the wrong version on a path parameter', async () => {
      const v4Id = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

      const response = await request(server)
        .get(`/${api.env.API_PREFIX}/v1/users/${v4Id}`)
        .set('Cookie', sessionCookie);

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expectProblemShape(response.body, {
        status: 400,
        code: ERROR_CODES.MALFORMED_REQUEST,
        type: '/errors/malformed-request',
        title: 'Malformed request',
      });
    });
  });

  describe('password reset', () => {
    it('revokes every existing session', async () => {
      const victim = await signInAsNewUser(api);
      const authPath = `/${api.env.API_PREFIX}/auth`;
      const meUrl = `/${api.env.API_PREFIX}/v1/users/me`;

      const beforeReset = await request(server).get(meUrl).set('Cookie', victim.cookie);

      expect(beforeReset.status).not.toBe(401);

      const requested = await request(server)
        .post(`${authPath}/request-password-reset`)
        .send({ email: victim.email, redirectTo: api.env.FRONTEND_BASE_URL });

      expect(requested.status).toBe(200);

      const token = await resetTokenFor(victim.userId);

      const reset = await request(server)
        .post(`${authPath}/reset-password`)
        .send({ token, newPassword: NEW_PASSWORD });

      expect(reset.status).toBe(200);

      const afterReset = await request(server).get(meUrl).set('Cookie', victim.cookie);

      expect(afterReset.status).toBe(401);
      expectProblemShape(afterReset.body, {
        status: 401,
        code: ERROR_CODES.UNAUTHENTICATED,
        type: '/errors/unauthenticated',
        title: 'Authentication required',
      });
    });
  });

  async function resetTokenFor(userId: string): Promise<string> {
    const rows = await api.database.cleaner.query<{ identifier: string }>(
      `SELECT identifier
         FROM auth.verification
        WHERE value = $1 AND identifier LIKE '${RESET_IDENTIFIER_PREFIX}%'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );

    const identifier = rows[0]?.identifier;

    if (identifier === undefined) {
      throw new Error(`no reset-password verification row for ${userId}`);
    }

    return identifier.slice(RESET_IDENTIFIER_PREFIX.length);
  }
});
