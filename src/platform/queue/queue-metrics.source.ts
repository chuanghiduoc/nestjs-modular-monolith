import { Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common';

import {
  SharedStateMetricsCollector,
  type SharedStateMetricsSource,
  type SharedStateReading,
} from '#platform/observability';

import { BullMqService } from './bullmq.service';
import { QUEUE_DEFINITIONS, type QueueName } from './queues';

@Injectable()
export class QueueMetricsSource implements SharedStateMetricsSource, OnApplicationBootstrap {
  readonly sourceName = 'bullmq';
  constructor(
    private readonly queue: BullMqService,
    @Optional() private readonly collector?: SharedStateMetricsCollector,
  ) {}

  onApplicationBootstrap(): void {
    this.collector?.register(this);
  }

  /**
   * Every queue is read concurrently. Walking them in sequence meant two Redis
   * round trips per queue one after another, and the collector abandons a source
   * that outruns its one-second budget — which drops the gauges for all of them,
   * not just the slow one.
   */
  async collectSharedState(): Promise<readonly SharedStateReading[]> {
    const perQueue = await Promise.all(
      QUEUE_DEFINITIONS.map((definition) => this.readQueue(definition.name)),
    );

    return perQueue.flat();
  }

  private async readQueue(name: QueueName): Promise<readonly SharedStateReading[]> {
    const queue = this.queue.getQueue(name);
    const [counts, waiting] = await Promise.all([
      queue.getJobCounts('wait', 'delayed', 'active', 'failed'),
      queue.getJobs(['wait', 'delayed'], 0, 0, true),
    ]);
    const oldest = waiting[0];

    return [
      {
        metric: 'queue_depth',
        queue: name,
        value: (counts.wait ?? 0) + (counts.delayed ?? 0),
      },
      {
        metric: 'queue_oldest_job_age_seconds',
        queue: name,
        value:
          oldest?.timestamp === undefined ? 0 : Math.max(0, (Date.now() - oldest.timestamp) / 1000),
      },
      {
        metric: 'queue_deadletter_depth',
        queue: name,
        value: counts.failed ?? 0,
      },
    ];
  }
}
