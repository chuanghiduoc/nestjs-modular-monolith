import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeoutError, withTimeout } from './with-timeout';

const TIMEOUT_MS = 5_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function settled(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error);
}

describe('withTimeout', () => {
  it('returns the value when the operation settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('pong'), TIMEOUT_MS, 'redis.ping')).resolves.toBe(
      'pong',
    );
  });

  it('does not fire one tick early', async () => {
    const pending = settled(withTimeout(new Promise<string>(() => undefined), TIMEOUT_MS, 'db'));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeInstanceOf(TimeoutError);
  });

  it('rejects with a TimeoutError naming the label and the budget it blew', async () => {
    expect.assertions(4);

    const pending = settled(
      withTimeout(new Promise<string>(() => undefined), TIMEOUT_MS, 'redis.ping'),
    );

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(TimeoutError);
    if (error instanceof TimeoutError) {
      expect(error.label).toBe('redis.ping');
      expect(error.timeoutMs).toBe(TIMEOUT_MS);
      expect(error.message).toContain('redis.ping');
    }
  });

  it('passes the underlying failure through instead of masking it as a timeout', async () => {
    const failure = new Error('ECONNREFUSED');

    const error = await settled(withTimeout(Promise.reject(failure), TIMEOUT_MS, 'db.ping'));

    expect(error).toBe(failure);
    expect(error).not.toBeInstanceOf(TimeoutError);
  });

  it('clears the timer once the operation wins the race', async () => {
    await withTimeout(Promise.resolve('pong'), TIMEOUT_MS, 'redis.ping');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer on the failure path too', async () => {
    await settled(withTimeout(Promise.reject(new Error('ECONNREFUSED')), TIMEOUT_MS, 'db.ping'));

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave an unhandled rejection when the operation fails after losing the race', async () => {
    // The abandoned loser is the whole point: a caller that already saw the
    // TimeoutError must not have the late failure crash the process on top of it.
    vi.useRealTimers();

    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on('unhandledRejection', record);

    let fail: (error: Error) => void = () => undefined;
    const operation = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });

    try {
      expect(await settled(withTimeout(operation, 5, 'redis.ping'))).toBeInstanceOf(TimeoutError);

      fail(new Error('ECONNREFUSED'));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(unhandled).toEqual([]);
  });
});
