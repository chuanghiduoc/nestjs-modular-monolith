import { SetMetadata } from '@nestjs/common';
import type { Job } from 'bullmq';

import type { QueueName } from './queues';

export const JOB_HANDLER_QUEUE = 'queue:job-handler';

export const JobHandler = (queue: QueueName): ClassDecorator =>
  SetMetadata(JOB_HANDLER_QUEUE, queue);

export interface JobConsumer<TData = unknown> {
  handle(job: Job<TData>): Promise<void>;
}
