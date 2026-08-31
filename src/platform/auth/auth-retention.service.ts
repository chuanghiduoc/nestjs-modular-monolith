import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '#platform/prisma';

import { AUTH_RETENTION_OPTIONS, type AuthRetentionOptions } from './auth-retention.options';

export interface AuthPruneResult {
  readonly sessions: number;
  readonly verifications: number;
}

/**
 * How many bounded batches one scheduled run will delete before yielding. The
 * cap keeps a nightly run from holding the tables indefinitely; without the
 * repetition, a deployment that expires more rows per day than one batch holds
 * would never catch up and auth.session would grow without bound.
 */
const MAX_PRUNE_PASSES = 20;

@Injectable()
export class AuthRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_RETENTION_OPTIONS) private readonly options: AuthRetentionOptions,
  ) {}

  async pruneExpired(now: Date = new Date()): Promise<AuthPruneResult> {
    const sessionCutoff = new Date(now.getTime() - this.options.expiredSessionGraceHours * HOUR_MS);

    const sessions = await this.prisma.db.$executeRaw`
      DELETE FROM auth.session
       WHERE id IN (
         SELECT id FROM auth.session
          WHERE expires_at < ${sessionCutoff}
          ORDER BY expires_at
          LIMIT ${this.options.batchSize}
       )`;

    const verifications = await this.prisma.db.$executeRaw`
      DELETE FROM auth.verification
       WHERE id IN (
         SELECT id FROM auth.verification
          WHERE expires_at < ${now}
          ORDER BY expires_at
          LIMIT ${this.options.batchSize}
       )`;

    return { sessions, verifications };
  }

  /**
   * Prunes in bounded batches until both tables are clear or the pass budget
   * runs out. The cutoff is computed once, so a long run cannot widen its own
   * window while it works.
   */
  async pruneUntilIdle(now: Date = new Date()): Promise<AuthPruneResult> {
    let sessions = 0;
    let verifications = 0;

    for (let pass = 0; pass < MAX_PRUNE_PASSES; pass += 1) {
      const removed = await this.pruneExpired(now);
      sessions += removed.sessions;
      verifications += removed.verifications;

      const bothDrained =
        removed.sessions < this.options.batchSize && removed.verifications < this.options.batchSize;

      if (bothDrained) break;
    }

    return { sessions, verifications };
  }
}

const HOUR_MS = 3_600_000;
