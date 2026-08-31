import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

/**
 * Two rate limiters guard this API and they do different jobs. `@fastify/rate-limit`
 * runs at the edge, before routing, and buckets by address — it is what absorbs
 * a flood aimed at auth routes. This guard runs after authentication and buckets
 * by session, so one signed-in caller cannot spend everyone else's budget from a
 * pool of addresses, and so a route can tighten its own limit with `@Throttle`.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(ApiThrottlerGuard.name);

  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    const typed = request as unknown as FastifyRequest;
    const sessionId = typed.authSession?.sessionId;
    if (sessionId !== undefined) {
      return Promise.resolve(`session:${sessionId}`);
    }

    return Promise.resolve(`ip:${typed.ip}`);
  }

  /**
   * Losing the rate limiter must not mean losing the API. The storage backend is
   * Redis with `enableOfflineQueue: false`, so a broker outage rejects every
   * command instantly — and an unhandled rejection here would turn a degraded
   * limiter into a 500 on every single request. The edge limiter already fails
   * open for the same reason; this keeps the two consistent.
   */
  protected override async handleRequest(
    requestProps: Parameters<ThrottlerGuard['handleRequest']>[0],
  ): Promise<boolean> {
    try {
      return await super.handleRequest(requestProps);
    } catch (error) {
      if (this.isThrottled(error)) throw error;

      this.logger.warn({
        msg: 'throttler storage is unavailable; allowing the request',
        err: describeError(error),
      });

      return true;
    }
  }

  /**
   * A 429 raised by the base guard is the limiter working, not failing.
   */
  private isThrottled(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof error.getStatus === 'function'
    );
  }
}

function describeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) };
}
