import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CRON_SCHEDULES,
  EVENT_SUBSCRIBERS,
  QUEUE_DEFINITIONS,
  type QueueName,
  QUEUES,
} from '#platform/queue';

const srcDir = join(process.cwd(), 'src');

const HANDLER_PATTERN = /@JobHandler\(QUEUES\.([A-Z0-9_]+)\)/g;
const ENQUEUE_PATTERN = /\.(?:send|schedule|scheduleEvery)\(\s*QUEUES\.([A-Z0-9_]+)/g;
const CRON_FIELD_COUNT = 5;

function walk(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return entry === 'generated' ? [] : walk(path);
    }

    return path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.integration.ts')
      ? [path]
      : [];
  });
}

function queueNameOfKey(key: string): QueueName | undefined {
  return (QUEUES as Record<string, QueueName>)[key];
}

function queuesMatching(pattern: RegExp): ReadonlySet<QueueName> {
  const names = new Set<QueueName>();

  for (const file of walk(srcDir)) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      const key = match[1];
      const name = key === undefined ? undefined : queueNameOfKey(key);

      if (name !== undefined) {
        names.add(name);
      }
    }
  }

  return names;
}

const handledQueues = queuesMatching(HANDLER_PATTERN);
const enqueuedInCode = queuesMatching(ENQUEUE_PATTERN);
const scheduledQueues = new Set<QueueName>(CRON_SCHEDULES.map((schedule) => schedule.queue));
const fanOutQueues = new Set<QueueName>(Object.values(EVENT_SUBSCRIBERS).flat());

describe('queue wiring', () => {
  it('finds the job handlers by reading src, not by assuming them', () => {
    expect(handledQueues.size).toBeGreaterThan(0);
  });

  it('every declared queue has a definition', () => {
    const defined = new Set<QueueName>(QUEUE_DEFINITIONS.map((definition) => definition.name));
    const missing = Object.values(QUEUES).filter((queue) => !defined.has(queue));

    expect(missing).toEqual([]);
  });

  it('every cron schedule points at a queue that something consumes', () => {
    const orphaned = CRON_SCHEDULES.map((schedule) => schedule.queue).filter(
      (queue) => !handledQueues.has(queue),
    );

    expect(orphaned).toEqual([]);
  });

  it('every consumed queue is reachable — by an event, a cron or a direct send', () => {
    const unreachable = [...handledQueues].filter(
      (queue) =>
        !fanOutQueues.has(queue) && !scheduledQueues.has(queue) && !enqueuedInCode.has(queue),
    );

    expect(unreachable).toEqual([]);
  });

  it('every cron expression has five fields', () => {
    const malformed = CRON_SCHEDULES.filter(
      (schedule) => schedule.cron.trim().split(/\s+/).length !== CRON_FIELD_COUNT,
    );

    expect(malformed).toEqual([]);
  });

  it('schedules no queue twice', () => {
    expect(scheduledQueues.size).toBe(CRON_SCHEDULES.length);
  });
});
