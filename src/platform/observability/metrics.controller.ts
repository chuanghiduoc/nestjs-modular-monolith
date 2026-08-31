import { Controller, Get, Header, SetMetadata, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';

import { PUBLIC_ROUTE_KEY } from '#shared/http';

import { metricsRegistry } from './metrics';
import { MetricsIpGuard } from './metrics.guard';
import { SharedStateMetricsCollector } from './shared-state-metrics';

export const METRICS_ROUTE = 'metrics';

@SetMetadata(PUBLIC_ROUTE_KEY, true)
@Controller({ path: METRICS_ROUTE, version: VERSION_NEUTRAL })
@UseGuards(MetricsIpGuard)
export class MetricsController {
  constructor(private readonly sharedState: SharedStateMetricsCollector) {}

  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  async scrape(): Promise<string> {
    await this.sharedState.refresh();

    return metricsRegistry.metrics();
  }
}
