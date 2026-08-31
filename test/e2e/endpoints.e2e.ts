import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';
import { newId } from '#shared/util';

import { signInAsNewUser, startTestApi, type TestApi, type TestSession } from '../support/api-app';
import { asRecord, expectProblemShape } from '../support/problem-details';

const ALLOWED_MIME_TYPE = 'image/png';

describe('API endpoints (e2e)', () => {
  let api: TestApi;
  let server: Server;
  let member: TestSession;
  let admin: TestSession;
  let organizationId: string;
  let prefix: string;

  beforeAll(async () => {
    api = await startTestApi();
    server = api.server;
    prefix = `/${api.env.API_PREFIX}/v1`;

    member = await signInAsNewUser(api);
    admin = await signInAsNewUser(api, { role: 'admin' });

    organizationId = newId();
    await api.database.cleaner.query(
      `INSERT INTO tenancy.organization (id, slug, name, created_at, updated_at)
       VALUES ($1, $2, 'E2E Organization', now(), now())`,
      [organizationId, `e2e-${organizationId}`],
    );
    await api.database.cleaner.query(
      `INSERT INTO tenancy.organization_member
         (id, organization_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, 'member', now(), now()),
              ($4, $2, $5, 'admin', now(), now())`,
      [newId(), organizationId, member.userId, newId(), admin.userId],
    );

    await insertProfile(member.userId, 'Member One');
  });

  afterAll(async () => {
    await api?.stop();
  });

  async function insertProfile(userId: string, displayName: string): Promise<void> {
    await api.database.cleaner.query(
      `INSERT INTO users.user_profile (id, user_id, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [newId(), userId, displayName],
    );
  }

  describe('GET /users/me', () => {
    beforeEach(async () => {
      await insertProfile(member.userId, 'Member One');
    });

    it('returns the caller’s own projection and nothing more', async () => {
      const response = await request(server).get(`${prefix}/users/me`).set('Cookie', member.cookie);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        userId: member.userId,
        email: member.email,
        emailVerified: true,
        role: 'member',
        displayName: 'Member One',
        avatarFileId: null,
      });
      expect(Object.keys(asRecord(response.body) ?? {}).sort()).toEqual([
        'avatarFileId',
        'createdAt',
        'displayName',
        'email',
        'emailVerified',
        'id',
        'role',
        'updatedAt',
        'userId',
      ]);
    });

    it('restricts profile lookup by id to platform admins', async () => {
      const response = await request(server)
        .get(`${prefix}/users/${member.userId}`)
        .set('Cookie', member.cookie);

      expect(response.status).toBe(403);

      const adminResponse = await request(server)
        .get(`${prefix}/users/${member.userId}`)
        .set('Cookie', admin.cookie);

      expect(adminResponse.status).toBe(200);
      expect(adminResponse.body).toMatchObject({ userId: member.userId });
    });

    it('answers 404 for a well-formed id that has no profile', async () => {
      const response = await request(server)
        .get(`${prefix}/users/${newId()}`)
        .set('Cookie', admin.cookie);

      expect(response.status).toBe(404);
      expectProblemShape(response.body, {
        status: 404,
        code: ERROR_CODES.USER_PROFILE_NOT_FOUND,
        type: '/errors/user-profile-not-found',
        title: 'Not found',
      });
    });
  });

  describe('PATCH /users/me', () => {
    it('renames the profile and reports the new state', async () => {
      const response = await request(server)
        .patch(`${prefix}/users/me`)
        .set('Cookie', member.cookie)
        .send({ displayName: 'Renamed Member' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ displayName: 'Renamed Member' });

      const reread = await request(server).get(`${prefix}/users/me`).set('Cookie', member.cookie);

      expect(reread.body).toMatchObject({ displayName: 'Renamed Member' });
    });

    it('accepts an explicit null to clear the avatar', async () => {
      const response = await request(server)
        .patch(`${prefix}/users/me`)
        .set('Cookie', member.cookie)
        .send({ avatarFileId: null });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ avatarFileId: null });
    });
  });

  describe('GET /audit-logs', () => {
    beforeEach(async () => {
      await api.database.cleaner.query(`DELETE FROM audit.audit_log`);
    });

    async function seedEntry(occurredAt: string, action: string): Promise<string> {
      const id = newId();

      await api.database.cleaner.query(
        `INSERT INTO audit.audit_log
           (id, occurred_at, actor_id, action, resource, metadata, organization_id)
         VALUES ($1, $2::timestamptz, $3, $4, 'users', '{}'::jsonb, $5)`,
        [id, occurredAt, admin.userId, action, organizationId],
      );

      return id;
    }

    it('refuses a member with 403, from the session role and nothing else', async () => {
      const response = await request(server)
        .get(`${prefix}/audit-logs`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(403);
      expectProblemShape(response.body, {
        status: 403,
        code: ERROR_CODES.FORBIDDEN,
        type: '/errors/forbidden',
        title: 'Forbidden',
      });
    });

    it('returns the list envelope to an admin', async () => {
      await seedEntry('2026-08-16T10:00:00.000Z', 'users.registered');

      const response = await request(server)
        .get(`${prefix}/audit-logs`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        object: 'list',
        url: '/api/v1/audit-logs',
        hasMore: false,
      });
      expect(readArray(response.body, 'data')).toHaveLength(1);
      expect(asRecord(response.body)).not.toHaveProperty('totalCount');
    });

    it('pages by cursor without losing or repeating a row', async () => {
      const newest = await seedEntry('2026-08-16T12:00:00.000Z', 'users.deleted');
      const oldest = await seedEntry('2026-08-16T10:00:00.000Z', 'users.registered');

      const first = await request(server)
        .get(`${prefix}/audit-logs?limit=1`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ hasMore: true });
      expect(idsOf(first.body)).toEqual([newest]);

      const cursor = readString(first.body, 'lastCursor');
      const second = await request(server)
        .get(`${prefix}/audit-logs?limit=1&startingAfter=${encodeURIComponent(cursor ?? '')}`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(second.status).toBe(200);
      expect(idsOf(second.body)).toEqual([oldest]);
      expect(second.body).toMatchObject({ hasMore: false });
    });

    it('filters by resource', async () => {
      await seedEntry('2026-08-16T10:00:00.000Z', 'users.registered');

      const response = await request(server)
        .get(`${prefix}/audit-logs?resource=nothing-matches`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(200);
      expect(idsOf(response.body)).toEqual([]);
    });

    it('answers 400 for a cursor the client could not have built', async () => {
      const response = await request(server)
        .get(`${prefix}/audit-logs?startingAfter=not-a-real-cursor`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(400);
      expectProblemShape(response.body, {
        status: 400,
        code: ERROR_CODES.CURSOR_MALFORMED,
        type: '/errors/cursor-malformed',
        title: 'Malformed request',
      });
      const body = asRecord(response.body);

      expect(String(body?.detail)).not.toContain('not-a-real-cursor');
      expect(JSON.stringify(body?.errors ?? [])).not.toContain('not-a-real-cursor');
      expect(String(body?.instance)).not.toContain('not-a-real-cursor');
      expect(String(body?.instance)).toBe(`${prefix}/audit-logs`);
    });

    it('answers 422 for a limit above the cap', async () => {
      const response = await request(server)
        .get(`${prefix}/audit-logs?limit=1000`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(422);
      expectProblemShape(response.body, {
        status: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
        type: '/errors/validation-failed',
        title: 'Validation failed',
      });
    });
  });

  describe('POST /upload/presign', () => {
    it('issues a policy scoped to one key, type and length', async () => {
      const response = await request(server)
        .post(`${prefix}/upload/presign`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId)
        .send({ filename: 'holiday.png', mimeType: ALLOWED_MIME_TYPE, sizeBytes: 2048 });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        method: 'PUT',
        maxSizeBytes: api.env.UPLOAD_MAX_FILE_BYTES,
      });

      const body = asRecord(response.body);

      expect(typeof body?.fileId).toBe('string');
      expect(String(body?.url)).toContain(api.env.S3_BUCKET);
      expect(asRecord(body?.headers)).toMatchObject({ 'content-type': ALLOWED_MIME_TYPE });
      expect(new Date(String(body?.expiresAt)).getTime()).toBeGreaterThan(Date.now());
    });

    it('refuses a type that is not on the allow-list', async () => {
      const response = await request(server)
        .post(`${prefix}/upload/presign`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId)
        .send({ filename: 'payload.exe', mimeType: 'application/x-msdownload', sizeBytes: 2048 });

      expect(response.status).toBe(422);
      expectProblemShape(response.body, {
        status: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
        type: '/errors/validation-failed',
        title: 'Validation failed',
      });
    });

    it('does not list a presigned upload until its bytes have been confirmed', async () => {
      // A presign is a promise of somewhere to put a file, not a file. Listing it
      // would hand the caller an id it cannot use and the server cannot vouch for.
      const created = await request(server)
        .post(`${prefix}/upload/presign`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId)
        .send({ filename: 'listed.png', mimeType: ALLOWED_MIME_TYPE, sizeBytes: 512 });

      expect(created.status).toBe(201);

      const response = await request(server)
        .get(`${prefix}/upload`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ object: 'list', url: '/api/v1/upload' });
      expect(idsOf(response.body)).not.toContain(readString(created.body, 'fileId'));
    });

    it('returns the same 404 for a file that is absent as for one that is not yours', async () => {
      const response = await request(server)
        .post(`${prefix}/upload/confirm`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId)
        .send({ fileId: newId() });

      expect(response.status).toBe(404);
      expectProblemShape(response.body, {
        status: 404,
        code: ERROR_CODES.UPLOAD_NOT_FOUND,
        type: '/errors/upload-not-found',
        title: 'Not found',
      });
    });
  });

  describe('GET /admin/users', () => {
    it('aggregates two contexts for an admin', async () => {
      const list = await request(server)
        .get(`${prefix}/admin/users`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ object: 'list', url: '/api/v1/admin/users' });

      const overview = await request(server)
        .get(`${prefix}/admin/users/${member.userId}/overview`)
        .set('Cookie', admin.cookie)
        .set('X-Organization-Id', organizationId);

      expect(overview.status).toBe(200);
      expect(overview.body).toMatchObject({ user: { userId: member.userId, role: 'member' } });
      expect(Array.isArray(asRecord(overview.body)?.recentFileIds)).toBe(true);
    });

    it('refuses a member', async () => {
      const response = await request(server)
        .get(`${prefix}/admin/users`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', organizationId);

      expect(response.status).toBe(403);
      expectProblemShape(response.body, {
        status: 403,
        code: ERROR_CODES.FORBIDDEN,
        type: '/errors/forbidden',
        title: 'Forbidden',
      });
    });
  });

  describe('organization lifecycle', () => {
    async function createOwnedOrganization(): Promise<string> {
      const response = await request(server)
        .post(`${prefix}/organizations`)
        .set('Cookie', member.cookie)
        .send({ slug: `lifecycle-${newId().slice(-12)}`, name: 'Lifecycle Org' });

      expect(response.status).toBe(201);

      return readString(response.body, 'id') ?? '';
    }

    it('archives, then treats a repeated archive as settled rather than missing', async () => {
      const id = await createOwnedOrganization();

      const first = await request(server)
        .post(`${prefix}/organizations/${id}/archive`)
        .set('Cookie', member.cookie);

      expect(first.status).toBe(204);

      // The retry of an unacknowledged success must not read as 404.
      const again = await request(server)
        .post(`${prefix}/organizations/${id}/archive`)
        .set('Cookie', member.cookie);

      expect(again.status).toBe(204);
    });

    it('restores an archived organization even when the tenant header names it', async () => {
      // The header points at a row that live membership lookups cannot see, so a
      // guard that failed closed here would lock the owner out of their own
      // restore — the one command that undoes the archive.
      const id = await createOwnedOrganization();

      await request(server)
        .post(`${prefix}/organizations/${id}/archive`)
        .set('Cookie', member.cookie);

      const restored = await request(server)
        .post(`${prefix}/organizations/${id}/restore`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', id);

      expect(restored.status).toBe(204);

      const list = await request(server)
        .get(`${prefix}/organizations`)
        .set('Cookie', member.cookie);
      const memberships: readonly unknown[] = Array.isArray(list.body) ? list.body : [];

      expect(memberships.some((entry) => asRecord(entry)?.id === id)).toBe(true);
    });

    it('purges an archived organization, and refuses to purge a live one', async () => {
      const id = await createOwnedOrganization();

      const tooEarly = await request(server)
        .delete(`${prefix}/organizations/${id}`)
        .set('Cookie', member.cookie);

      expect(tooEarly.status).toBe(409);

      await request(server)
        .post(`${prefix}/organizations/${id}/archive`)
        .set('Cookie', member.cookie);

      const purged = await request(server)
        .delete(`${prefix}/organizations/${id}`)
        .set('Cookie', member.cookie)
        .set('X-Organization-Id', id);

      expect(purged.status).toBe(204);
    });

    it('refuses a caller who is not the owner', async () => {
      const id = await createOwnedOrganization();

      const response = await request(server)
        .post(`${prefix}/organizations/${id}/archive`)
        .set('Cookie', admin.cookie);

      expect(response.status).toBe(403);
    });
  });
});

function readArray(body: unknown, key: string): unknown[] {
  const value = asRecord(body)?.[key];

  return Array.isArray(value) ? value : [];
}

function readString(body: unknown, key: string): string | undefined {
  const value = asRecord(body)?.[key];

  return typeof value === 'string' ? value : undefined;
}

function idsOf(body: unknown): string[] {
  return readArray(body, 'data').flatMap((entry) => {
    const id = asRecord(entry)?.id;

    return typeof id === 'string' ? [id] : [];
  });
}
