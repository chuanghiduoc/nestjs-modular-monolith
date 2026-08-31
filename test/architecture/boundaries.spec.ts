import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const fixturesDir = join(repoRoot, 'test', 'architecture-fixtures');
const depcruiseBin = join(
  repoRoot,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruise.mjs',
);

interface CruiseRule {
  readonly name: string;
}

interface CruiseModule {
  readonly rules?: CruiseRule[];
  readonly dependencies?: { readonly rules?: CruiseRule[] }[];
}

interface CruiseResult {
  readonly modules: CruiseModule[];
  readonly summary: { readonly error: number };
}

function cruise(cwd: string, config: string): CruiseResult {
  try {
    const stdout = execFileSync(
      process.execPath,
      [depcruiseBin, '--config', config, '--output-type', 'json', 'src'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    return JSON.parse(stdout) as CruiseResult;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout !== 'string' || stdout === '') {
      throw error;
    }

    return JSON.parse(stdout) as CruiseResult;
  }
}

function firedRules(result: CruiseResult): Set<string> {
  const names = new Set<string>();

  for (const module of result.modules) {
    for (const rule of module.rules ?? []) {
      names.add(rule.name);
    }
    for (const dependency of module.dependencies ?? []) {
      for (const rule of dependency.rules ?? []) {
        names.add(rule.name);
      }
    }
  }

  return names;
}

describe('architecture fitness', () => {
  const loadFromRoot = createRequire(join(repoRoot, 'package.json'));
  const policy = loadFromRoot('./.dependency-cruiser.cjs') as { forbidden: { name: string }[] };
  const declared = policy.forbidden.map((rule) => rule.name);

  it('declares at least the rules the design depends on', () => {
    expect(declared).toEqual(
      expect.arrayContaining([
        'no-cross-context',
        'enter-context-through-barrel',
        'domain-has-no-framework',
        'no-dev-dep-in-runtime',
        'http-goes-through-application',
        'application-has-no-infrastructure',
      ]),
    );
  });

  it('every declared rule actually fires against a fixture', () => {
    const fired = firedRules(cruise(fixturesDir, '.dependency-cruiser.fixtures.cjs'));
    const vacuous = declared.filter((name) => !fired.has(name));

    expect(vacuous).toEqual([]);
  });

  it('src violates nothing', () => {
    const result = cruise(repoRoot, '.dependency-cruiser.cjs');

    expect(result.summary.error).toBe(0);
  });
});
