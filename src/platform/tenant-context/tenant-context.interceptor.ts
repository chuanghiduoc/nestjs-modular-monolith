import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

import { runWithTenant } from './tenant-context';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const tenant = request.tenantContext;

    if (tenant === undefined) return next.handle();

    return new Observable<unknown>((subscriber) =>
      runWithTenant(tenant, () =>
        next.handle().subscribe({
          next: (value: unknown) => subscriber.next(value),
          error: (error: unknown) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      ),
    );
  }
}
