import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { signInAsNewUser, startTestApi, type TestApi } from '../support/api-app';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const REQUIRED_MEMBERS = ['type', 'title', 'status', 'detail', 'instance'] as const;
const EXTENSION_MEMBERS = ['code', 'requestId', 'timestamp'] as const;

interface ProblemBody {
  readonly type?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly detail?: unknown;
  readonly instance?: unknown;
  readonly code?: unknown;
  readonly requestId?: unknown;
  readonly timestamp?: unknown;
  readonly errors?: unknown;
}

describe('RFC 9457 conformance (e2e)', () => {
  let api: TestApi;
  let server: Server;
  let prefix: string;
  let cookie: string;
  let profiledCookie: string;
  let profiledUserId: string;

  beforeAll(async () => {
    api = await startTestApi();
    server = api.server;
    prefix = `/${api.env.API_PREFIX}/v1`;
    cookie = (await signInAsNewUser(api, { role: 'admin' })).cookie;

    const profiled = await signInAsNewUser(api);
    profiledCookie = profiled.cookie;
    profiledUserId = profiled.userId;
  });

  afterAll(async () => {
    await api?.stop();
  });

  function assertProblem(status: number, headers: Record<string, string>, body: ProblemBody): void {
    expect(headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);

    for (const member of REQUIRED_MEMBERS) {
      expect(body[member], `missing member "${member}"`).toBeDefined();
    }

    for (const member of EXTENSION_MEMBERS) {
      expect(body[member], `missing extension member "${member}"`).toBeDefined();
    }

    expect(body.status).toBe(status);
    expect(typeof body.type).toBe('string');
    expect(typeof body.title).toBe('string');
    expect(typeof body.detail).toBe('string');
    expect(typeof body.instance).toBe('string');
    expect(typeof body.code).toBe('string');

    expect(String(body.type)).toMatch(/^\/errors\/[a-z0-9-]+$/);
    expect(String(body.code)).toMatch(/^[a-z0-9_]+$/);
    expect(String(body.type)).toBe(`/errors/${String(body.code).replaceAll('_', '-')}`);
    expect(String(body.instance).startsWith('/')).toBe(true);
    expect(String(body.instance)).not.toContain('?');
    expect(new Date(String(body.timestamp)).toISOString()).toBe(String(body.timestamp));
  }

  const cases: readonly {
    name: string;
    status: number;
    run: () => Promise<{ status: number; headers: Record<string, string>; body: ProblemBody }>;
  }[] = [
    {
      name: 'a domain 404 raised by a use case',
      status: 404,
      run: () => request(server).get(`${prefix}/users/me`).set('Cookie', cookie),
    },
    {
      name: 'a 401 from the global guard, before any controller',
      status: 401,
      run: () => request(server).get(`${prefix}/users/me`),
    },
    {
      name: 'a 422 from the validation pipe',
      status: 422,
      run: () =>
        request(server).patch(`${prefix}/users/me`).set('Cookie', cookie).send({ displayName: '' }),
    },
    {
      name: 'a 400 from a malformed path parameter',
      status: 400,
      run: () => request(server).get(`${prefix}/users/not-a-uuid`).set('Cookie', cookie),
    },
    {
      name: 'a 404 for a route Fastify never matched',
      status: 404,
      run: () => request(server).get(`${prefix}/no-such-route`).set('Cookie', cookie),
    },
    {
      name: 'a 415 for a media type no parser accepts',
      status: 415,
      run: () =>
        request(server)
          .patch(`${prefix}/users/me`)
          .set('Cookie', cookie)
          .set('Content-Type', 'application/xml')
          .send('<displayName>x</displayName>'),
    },
    {
      name: 'a 400 for a body that is not valid JSON',
      status: 400,
      run: () =>
        request(server)
          .patch(`${prefix}/users/me`)
          .set('Cookie', cookie)
          .set('Content-Type', 'application/json')
          .send('{"displayName":'),
    },
  ];

  for (const testCase of cases) {
    it(`answers ${testCase.name} as problem+json`, async () => {
      const response = await testCase.run();

      expect(response.status).toBe(testCase.status);
      assertProblem(testCase.status, response.headers, response.body);
    });
  }

  it('never echoes the query string into instance', async () => {
    const response = await request(server)
      .get(`${prefix}/users/me`)
      .query({ leaked: 'SECRET-VALUE' })
      .set('Cookie', cookie);

    const body = response.body as ProblemBody;

    expect(body.instance).toBe(`${prefix}/users/me`);
    expect(JSON.stringify(body)).not.toContain('SECRET-VALUE');
  });

  it('repeats the request id in the header and the body', async () => {
    const response = await request(server).get(`${prefix}/users/me`);
    const body = response.body as ProblemBody;

    expect(response.headers['x-request-id']).toBe(body.requestId);
  });

  it('carries errors[] only where a field was actually rejected', async () => {
    const rejected = await request(server)
      .patch(`${prefix}/users/me`)
      .set('Cookie', cookie)
      .send({ displayName: '' });

    const errors = (rejected.body as ProblemBody).errors;

    expect(Array.isArray(errors)).toBe(true);

    for (const entry of errors as { path: string; code: string; message: string }[]) {
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.code).toBe('string');
      expect(typeof entry.message).toBe('string');
    }

    const unauthenticated = await request(server).get(`${prefix}/users/me`);

    expect((unauthenticated.body as ProblemBody).errors).toBeUndefined();
  });

  it('serves documentation at the exact URI every type points to', async () => {
    const failures: string[] = [];

    for (const testCase of cases) {
      const problem = (await testCase.run()).body;
      const type = String(problem.type);
      const documented = await request(server).get(type);

      if (documented.status !== 200) {
        failures.push(`${type} -> ${String(documented.status)}`);
      }
    }

    expect(failures, 'a type URI that 404s is a dead link in every error body').toEqual([]);
  });

  it('documents every code the catalog knows, and refuses one it does not', async () => {
    const index = await request(server).get('/errors');

    expect(index.status).toBe(200);

    const listed = (index.body as { errors: { code: string; type: string }[] }).errors;

    expect(listed.length).toBeGreaterThan(0);

    for (const entry of listed) {
      expect(entry.type).toBe(`/errors/${entry.code.replaceAll('_', '-')}`);
    }

    const unknown = await request(server).get('/errors/no-such-error-type');

    expect(unknown.status).toBe(404);
    expect(unknown.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('returns a bare resource on success — no envelope', async () => {
    await api.database.cleaner.query(
      `INSERT INTO users.user_profile (id, user_id, display_name, created_at, updated_at)
       VALUES ($1, $2, 'Envelope Check', now(), now())
       ON CONFLICT (user_id) DO NOTHING`,
      [newId(), profiledUserId],
    );

    const read = await request(server).get(`${prefix}/users/me`).set('Cookie', profiledCookie);

    expect(read.status).toBe(200);
    expect(read.headers['content-type']).toContain('application/json');
    expect(read.headers['content-type']).not.toContain('problem');

    const keys = Object.keys(read.body as Record<string, unknown>);

    expect(keys).not.toContain('data');
    expect(keys).not.toContain('success');
    expect(keys).toContain('displayName');
  });
});
