import type { IncomingHttpHeaders } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';

import { PrismaService } from '#platform/prisma';
import { BullMqService, QUEUES } from '#platform/queue';

import { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options';
import { type AuthenticatedSession, toAuthenticatedSession } from './authenticated-session';
import { type BetterAuthInstance, createBetterAuth } from './better-auth.factory';

const AUTH_MAIL_DEDUP_SECONDS = 300;

@Injectable()
export class AuthService {
  readonly auth: BetterAuthInstance;
  constructor(
    prisma: PrismaService,
    @Inject(AUTH_OPTIONS)
    options: AuthModuleOptions,
    queue: BullMqService,
  ) {
    this.auth = createBetterAuth(prisma.db, options, async (payload) => {
      await queue.send(QUEUES.MAIL_SEND_AUTH_EMAIL, payload, {
        // The digest, never the token: a deduplication key is stored as a plain
        // Redis key name and would otherwise expose the credential to SCAN.
        singletonKey: `${payload.kind}:${payload.tokenDigest}`,
        singletonSeconds: AUTH_MAIL_DEDUP_SECONDS,
      });
    });
  }

  async getSession(headers: IncomingHttpHeaders): Promise<AuthenticatedSession | null> {
    const raw = await this.auth.api.getSession({ headers: fromNodeHeaders(headers) });

    return toAuthenticatedSession(raw);
  }

  async handleWebRequest(request: Request): Promise<Response> {
    return this.auth.handler(request);
  }
}
