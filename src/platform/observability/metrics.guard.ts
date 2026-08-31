import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { type CidrAllowList, isAddressAllowed } from './cidr-allowlist';
import { METRICS_ALLOW_LIST } from './options';

interface RequestWithSocket {
  readonly socket?: { readonly remoteAddress?: string | undefined };
}

@Injectable()
export class MetricsIpGuard implements CanActivate {
  private readonly logger = new Logger(MetricsIpGuard.name);

  constructor(@Inject(METRICS_ALLOW_LIST) private readonly allowList: CidrAllowList) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithSocket>();
    const remoteAddress = request.socket?.remoteAddress;

    if (isAddressAllowed(remoteAddress, this.allowList)) {
      return true;
    }

    this.logger.warn(`/metrics refused for ${remoteAddress ?? 'an unknown address'}`);

    return false;
  }
}
