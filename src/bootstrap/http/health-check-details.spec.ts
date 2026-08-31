import { describe, expect, it } from 'vitest';

import { readDependencyChecks } from './health-check-details';

const TERMINUS_503_BODY = {
  status: 'error',
  info: { redis: { status: 'up' } },
  error: { postgres: { status: 'down', message: 'connect ECONNREFUSED 10.0.0.7:5432' } },
  details: {
    postgres: { status: 'down', message: 'connect ECONNREFUSED 10.0.0.7:5432' },
    redis: { status: 'up' },
  },
};

describe('readDependencyChecks', () => {
  it('names the dependency that is down', () => {
    expect(readDependencyChecks(TERMINUS_503_BODY)).toEqual([
      { name: 'postgres', status: 'down' },
      { name: 'redis', status: 'up' },
    ]);
  });

  it('drops the indicator message, which carries hosts and credentials', () => {
    const serialised = JSON.stringify(readDependencyChecks(TERMINUS_503_BODY));

    expect(serialised).not.toContain('ECONNREFUSED');
    expect(serialised).not.toContain('10.0.0.7');
  });

  it('reads an unknown state as down rather than inventing an up', () => {
    const checks = readDependencyChecks({ details: { queue: { status: 'shutting-down' } } });

    expect(checks).toEqual([{ name: 'queue', status: 'down' }]);
  });

  it('returns undefined for a body that is not a terminus result', () => {
    expect(readDependencyChecks({ message: 'Service Unavailable' })).toBeUndefined();
    expect(readDependencyChecks({ details: {} })).toBeUndefined();
    expect(readDependencyChecks('Service Unavailable')).toBeUndefined();
    expect(readDependencyChecks(null)).toBeUndefined();
  });
});
