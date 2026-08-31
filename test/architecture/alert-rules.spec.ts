import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  metricsRegistry,
  OUTBOX_QUARANTINED_METRIC,
  OUTBOX_UNDRAINED_METRIC,
} from '#platform/observability';

const rulesPath = join(process.cwd(), 'ops', 'prometheus', 'alert_rules.yml');
const rulesText = readFileSync(rulesPath, 'utf8');

const EXPECTED_ALERT_COUNT = 5;
const HISTOGRAM_SUFFIXES = ['_bucket', '_count', '_sum'];
const METRIC_TOKEN = /\b([a-z][a-z0-9_]{4,})\b/g;

const PROMQL_KEYWORDS = new Set([
  'sum',
  'rate',
  'increase',
  'clamp_min',
  'max',
  'min',
  'avg',
  'count',
  'status',
  'queue',
  'severity',
  'labels',
  'value',
  'summary',
  'annotations',
  'description',
  'alert',
  'expr',
  'groups',
  'rules',
  'name',
  'page',
  'humanizePercentage',
  'humanizeDuration',
]);

function exprLines(): readonly string[] {
  const lines = rulesText.split('\n');
  const collected: string[] = [];
  let inExpr = false;

  for (const line of lines) {
    if (/^\s*expr:/.test(line)) {
      inExpr = true;
      collected.push(line.replace(/^\s*expr:\s*>?-?\s*/, ''));
      continue;
    }

    if (inExpr) {
      if (/^\s*(for|labels|annotations|alert|-)\s*:?/.test(line)) {
        inExpr = false;
        continue;
      }

      collected.push(line);
    }
  }

  return collected;
}

function declaredMetricNames(): ReadonlySet<string> {
  const names = new Set<string>(
    metricsRegistry.getMetricsAsArray().map((metric) => String(metric.name)),
  );

  names.add(OUTBOX_UNDRAINED_METRIC);
  names.add(OUTBOX_QUARANTINED_METRIC);

  return names;
}

function stripHistogramSuffix(token: string): string {
  const suffix = HISTOGRAM_SUFFIXES.find((candidate) => token.endsWith(candidate));

  return suffix === undefined ? token : token.slice(0, -suffix.length);
}

describe('prometheus alert rules', () => {
  const declared = declaredMetricNames();

  it('declares every alert the design commits to', () => {
    expect(rulesText.match(/^\s+- alert:/gm)).toHaveLength(EXPECTED_ALERT_COUNT);
  });

  it('reads real expressions, not an empty file', () => {
    expect(exprLines().join(' ').trim().length).toBeGreaterThan(0);
  });

  it('references only metrics this application actually exports', () => {
    const referenced = new Set<string>();

    for (const line of exprLines()) {
      for (const match of line.matchAll(METRIC_TOKEN)) {
        const token = match[1];

        if (token === undefined || PROMQL_KEYWORDS.has(token)) {
          continue;
        }

        referenced.add(stripHistogramSuffix(token));
      }
    }

    expect(referenced.size).toBeGreaterThan(0);

    const unknown = [...referenced].filter((name) => !declared.has(name));

    expect(unknown).toEqual([]);
  });

  it('gives every alert a severity and a for-window', () => {
    const alertCount = rulesText.match(/^\s+- alert:/gm)?.length ?? 0;

    expect(rulesText.match(/^\s+severity:/gm)).toHaveLength(alertCount);
    expect(rulesText.match(/^\s+for:/gm)).toHaveLength(alertCount);
  });
});
