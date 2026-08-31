import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId } from '#shared/util';

import { startTestApi, type TestApi } from '../support/api-app';
import { startTestMailpit, type TestMailpit } from '../support/mailpit';
import { startTestWorker, type TestWorker } from '../support/worker-app';

const PASSWORD = 'e2e-password-2026';
const VERIFY_SUBJECT = 'Confirm your email address';
const SETTLE_MS = 1_000;

describe('auth email delivery (e2e)', () => {
  let api: TestApi;
  let worker: TestWorker;
  let mailpit: TestMailpit;
  let server: Server;
  let authPath: string;

  beforeAll(async () => {
    api = await startTestApi();
    mailpit = await startTestMailpit();
    worker = await startTestWorker({
      databaseUrl: api.database.connectionString,
      redisUrl: api.env.REDIS_URL,
      mailHost: mailpit.host,
      mailPort: mailpit.smtpPort,
      frontendBaseUrl: api.env.FRONTEND_BASE_URL,
    });

    server = api.server;
    authPath = `/${api.env.API_PREFIX}/auth`;
  });

  afterAll(async () => {
    await worker?.stop();
    await mailpit?.stop();
    await api?.stop();
  });

  it('carries a sign-up through SMTP to a token that verifies the account', async () => {
    const email = `${newId()}@example.com`;

    const signUp = await request(server)
      .post(`${authPath}/sign-up/email`)
      .send({ email, password: PASSWORD, name: 'Mail E2E' });

    expect(signUp.status).toBe(200);

    const blockedBeforeVerification = await request(server)
      .post(`${authPath}/sign-in/email`)
      .send({ email, password: PASSWORD });

    expect(blockedBeforeVerification.status).not.toBe(200);

    const message = await mailpit.waitForSubjectTo(email, VERIFY_SUBJECT);

    expect(message.from).toBe(worker.env.MAIL_FROM);
    expect(message.to).toContain(email);

    const token = verificationTokenIn(message.text || message.html);

    const verified = await request(server).get(`${authPath}/verify-email`).query({ token });

    expect([200, 302]).toContain(verified.status);

    const signIn = await request(server)
      .post(`${authPath}/sign-in/email`)
      .send({ email, password: PASSWORD });

    expect(signIn.status).toBe(200);

    const rows = await api.database.cleaner.query<{ email_verified: boolean }>(
      'SELECT email_verified FROM auth."user" WHERE email = $1',
      [email],
    );

    expect(rows[0]?.email_verified).toBe(true);
  });

  it('sends the verification email once, however many times the job is delivered', async () => {
    const email = `${newId()}@example.com`;

    const signUp = await request(server)
      .post(`${authPath}/sign-up/email`)
      .send({ email, password: PASSWORD, name: 'Dedup E2E' });

    expect(signUp.status).toBe(200);

    await mailpit.waitForSubjectTo(email, VERIFY_SUBJECT);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const subjects = await mailpit.subjectsTo(email);

    expect(subjects.filter((subject) => subject === VERIFY_SUBJECT)).toHaveLength(1);
  });

  it('leaves the welcome email to the outbox, which no role here drains', async () => {
    const email = `${newId()}@example.com`;

    await request(server)
      .post(`${authPath}/sign-up/email`)
      .send({ email, password: PASSWORD, name: 'Outbox E2E' });

    await mailpit.waitForSubjectTo(email, VERIFY_SUBJECT);

    const undrained = await api.database.cleaner.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM messaging.outbox_events
        WHERE drained_at IS NULL AND event_name = 'users.registered'`,
    );

    expect(Number(undrained[0]?.count)).toBeGreaterThan(0);
    expect(await mailpit.subjectsTo(email)).not.toContain('Welcome');
  });

  function verificationTokenIn(body: string): string {
    const match = /[?&]token=([^\s"'&<>]+)/.exec(body);
    const token = match?.[1];

    if (token === undefined) {
      throw new Error(`no token in the delivered email body: ${body.slice(0, 400)}`);
    }

    return decodeURIComponent(token);
  }
});
