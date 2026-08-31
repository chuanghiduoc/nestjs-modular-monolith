import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { httpRequestDuration, httpRequestsInFlight } from '#platform/observability';

const SECONDS_PER_MILLISECOND = 1 / 1000;

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = process.hrtime.bigint();

    httpRequestsInFlight.inc();

    return next.handle().pipe(
      finalize(() => {
        httpRequestsInFlight.dec();

        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        httpRequestDuration.observe(
          {
            method: request.method,
            route: routeTemplate(request),

            status: String(reply.statusCode),
          },
          elapsedMs * SECONDS_PER_MILLISECOND,
        );
      }),
    );
  }
}

function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions.url ?? 'unknown';
}
