import { type DynamicModule, Global, Module } from '@nestjs/common';

import { parseCidrAllowList } from './cidr-allowlist';
import { collectNodeDefaultMetrics } from './metrics';
import { MetricsController } from './metrics.controller';
import { MetricsIpGuard } from './metrics.guard';
import {
  METRICS_ALLOW_LIST,
  METRICS_OPTIONS,
  type MetricsOptions,
  type ObservabilityAsyncOptions,
} from './options';
import { SharedStateMetricsCollector } from './shared-state-metrics';

@Global()
@Module({})
export class ObservabilityMetricsModule {
  static forRootAsync<TDeps extends readonly unknown[]>(
    options: ObservabilityAsyncOptions<MetricsOptions, TDeps>,
  ): DynamicModule {
    collectNodeDefaultMetrics();

    return {
      module: ObservabilityMetricsModule,
      imports: options.imports,
      controllers: [MetricsController],
      providers: [
        {
          provide: METRICS_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        {
          provide: METRICS_ALLOW_LIST,
          useFactory: (metricsOptions: MetricsOptions) =>
            parseCidrAllowList(metricsOptions.allowCidrs),
          inject: [METRICS_OPTIONS],
        },
        MetricsIpGuard,
        SharedStateMetricsCollector,
      ],

      // The health controller guards its dependency probe with the same
      // allow-list. A @Global module only shares what it exports, so the guard
      // and the list it reads have to travel with the collector.
      exports: [SharedStateMetricsCollector, MetricsIpGuard, METRICS_ALLOW_LIST],
    };
  }
}
