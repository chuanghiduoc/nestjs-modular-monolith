import { Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common';

import {
  SharedStateMetricsCollector,
  type SharedStateMetricsSource,
  type SharedStateReading,
} from '#platform/observability';

import { OutboxDrainService } from './outbox-drain.service';

@Injectable()
export class OutboxMetricsSource implements SharedStateMetricsSource, OnApplicationBootstrap {
  readonly sourceName = 'outbox';

  constructor(
    private readonly drain: OutboxDrainService,
    @Optional() private readonly collector?: SharedStateMetricsCollector,
  ) {}

  onApplicationBootstrap(): void {
    this.collector?.register(this);
  }

  async collectSharedState(): Promise<readonly SharedStateReading[]> {
    const [undrained, quarantined] = await Promise.all([
      this.drain.countUndrained(),
      this.drain.countQuarantined(),
    ]);

    return [
      { metric: 'outbox_undrained_total', value: undrained },
      { metric: 'outbox_quarantined_total', value: quarantined },
    ];
  }
}
