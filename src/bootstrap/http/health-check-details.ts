import { DEPENDENCY_STATES, type DependencyCheck, type DependencyState } from './problem-details';

const MAX_CHECKS = 20;

export function readDependencyChecks(response: unknown): readonly DependencyCheck[] | undefined {
  const details = asRecord(asRecord(response)?.details);

  if (details === null) {
    return undefined;
  }

  const checks = Object.entries(details)
    .slice(0, MAX_CHECKS)
    .map(([name, value]) => ({ name, status: readState(value) }));

  return checks.length === 0 ? undefined : checks;
}

function readState(value: unknown): DependencyState {
  const status = asRecord(value)?.status;

  return DEPENDENCY_STATES.find((state) => state === status) ?? 'down';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
