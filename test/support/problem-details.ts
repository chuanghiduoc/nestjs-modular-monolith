import { expect } from 'vitest';

export interface ExpectedProblem {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly title: string;
}

export interface FieldErrorBody {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export function expectProblemShape(body: unknown, expected: ExpectedProblem): void {
  expect(body).toMatchObject({
    type: expected.type,
    title: expected.title,
    status: expected.status,
    code: expected.code,
  });

  const problem = asRecord(body);

  expect(typeof problem?.detail).toBe('string');
  expect(typeof problem?.instance).toBe('string');
  expect(typeof problem?.requestId).toBe('string');
  expect(typeof problem?.timestamp).toBe('string');
  expect(new Date(String(problem?.timestamp)).toString()).not.toBe('Invalid Date');
}

export function fieldErrorsOf(body: unknown): FieldErrorBody[] {
  const errors = asRecord(body)?.errors;

  if (!Array.isArray(errors)) {
    return [];
  }

  return errors.filter((entry): entry is FieldErrorBody => {
    const candidate = asRecord(entry);

    return typeof candidate?.path === 'string' && typeof candidate.message === 'string';
  });
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
