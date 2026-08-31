import { describe, expect, it } from 'vitest';

import { EnvValidationError, injectDatabasePassword, loadEnv } from './load-env';

const BASE = {
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  BETTER_AUTH_URL: 'http://localhost:3000',
  FRONTEND_BASE_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'app-uploads',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  METRICS_ALLOW_CIDRS: '127.0.0.1/32',
} as const;

function api(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...BASE, ...overrides };
}

describe('injectDatabasePassword', () => {
  it('encodes before the URL setter, which does not escape a literal %', () => {
    const dsn = injectDatabasePassword('postgresql://app@db:5432/app', 'pa%ss');

    expect(dsn).toContain('pa%25ss');
    expect(dsn).not.toContain('pa%ss@');
  });

  it('survives the characters a generated password actually contains', () => {
    const password = 'p@ss:w/rd?#[]&=+$,';
    const dsn = injectDatabasePassword('postgresql://app@db:5432/app', password);

    expect(decodeURIComponent(new URL(dsn).password)).toBe(password);
  });

  it('leaves the rest of the DSN untouched', () => {
    const dsn = injectDatabasePassword('postgresql://app@db:5432/app?sslmode=require', 'x');
    const parsed = new URL(dsn);

    expect(parsed.hostname).toBe('db');
    expect(parsed.port).toBe('5432');
    expect(parsed.pathname).toBe('/app');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
  });
});

describe('loadEnv — api', () => {
  it('applies documented defaults so a minimal .env still boots', () => {
    const env = loadEnv('api', api());

    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.HTTP_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(env.TRUST_INBOUND_REQUEST_ID).toBe(false);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('parses a comma list into trimmed, non-empty entries', () => {
    const env = loadEnv('api', api({ CORS_ORIGINS: 'http://a.test , http://b.test ,' }));

    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('refuses a secret shorter than 32 bytes', () => {
    expect(() => loadEnv('api', api({ BETTER_AUTH_SECRET: 'too-short' }))).toThrow(
      EnvValidationError,
    );
  });

  it('refuses a CORS entry that is not a URL', () => {
    expect(() => loadEnv('api', api({ CORS_ORIGINS: 'not-a-url' }))).toThrow(EnvValidationError);
  });

  it('names the offending key in the message', () => {
    try {
      loadEnv('api', api({ PORT: 'not-a-number' }));
      expect.unreachable('an invalid port should be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      if (error instanceof EnvValidationError) {
        expect(error.issues).toContain('PORT');
        expect(error.role).toBe('api');
      }
    }
  });

  it('reads booleans from the strings a .env file actually holds', () => {
    expect(loadEnv('api', api({ TRUST_PROXY: 'true' })).TRUST_PROXY).toBe(true);
    expect(loadEnv('api', api({ TRUST_PROXY: 'false' })).TRUST_PROXY).toBe(false);
  });
});

describe('loadEnv — production refinements', () => {
  const production = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv =>
    api({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://api.example.com',
      FRONTEND_BASE_URL: 'https://app.example.com',
      CORS_ORIGINS: 'https://app.example.com',
      ...overrides,
    });

  it('refuses an empty metrics allow-list, because empty must fail closed', () => {
    expect(() => loadEnv('api', production({ METRICS_ALLOW_CIDRS: '' }))).toThrow(
      EnvValidationError,
    );
  });

  it('refuses CORS that does not include the frontend origin', () => {
    expect(() => loadEnv('api', production({ CORS_ORIGINS: 'https://somewhere.else' }))).toThrow(
      EnvValidationError,
    );
  });

  it('refuses http where a Secure cookie has to travel', () => {
    expect(() => loadEnv('api', production({ BETTER_AUTH_URL: 'http://api.example.com' }))).toThrow(
      EnvValidationError,
    );
    expect(() =>
      loadEnv(
        'api',
        production({
          FRONTEND_BASE_URL: 'http://app.example.com',
          CORS_ORIGINS: 'http://app.example.com',
        }),
      ),
    ).toThrow(EnvValidationError);
  });

  it('refuses trusting an inbound request id with no trusted proxy in front', () => {
    expect(() =>
      loadEnv('api', production({ TRUST_INBOUND_REQUEST_ID: 'true', TRUST_PROXY: 'false' })),
    ).toThrow(EnvValidationError);

    expect(() =>
      loadEnv(
        'api',
        production({
          TRUST_INBOUND_REQUEST_ID: 'true',
          TRUST_PROXY: 'true',
          DEPLOYMENT_TOPOLOGY: 'behind-proxy',
        }),
      ),
    ).not.toThrow();
  });

  it('refuses a proxy topology that does not trust the proxy in front of it', () => {
    // Every request would arrive with the balancer's address, so the whole
    // deployment would share one rate-limit bucket.
    expect(() =>
      loadEnv('api', production({ DEPLOYMENT_TOPOLOGY: 'behind-proxy', TRUST_PROXY: 'false' })),
    ).toThrow(EnvValidationError);
  });

  it('refuses trusting forwarded headers when clients connect directly', () => {
    expect(() =>
      loadEnv('api', production({ DEPLOYMENT_TOPOLOGY: 'direct', TRUST_PROXY: 'true' })),
    ).toThrow(EnvValidationError);
  });

  it('refuses a placeholder secret however it was padded to length', () => {
    expect(() => loadEnv('api', production({ BETTER_AUTH_SECRET: 'changeme'.repeat(4) }))).toThrow(
      EnvValidationError,
    );
    expect(() =>
      loadEnv('api', production({ BETTER_AUTH_SECRET: 'changeme'.padEnd(40, 'x') })),
    ).toThrow(EnvValidationError);
    expect(() =>
      loadEnv('api', production({ BETTER_AUTH_SECRET: `prod-example-${'z'.repeat(30)}` })),
    ).toThrow(EnvValidationError);

    expect(() =>
      loadEnv('api', production({ BETTER_AUTH_SECRET: 'k7Qz2Rt9Wm4Yb8Nc1Vx6Hj3Lp5Sd0FgT2' })),
    ).not.toThrow();
  });

  it('accepts a correctly configured production API', () => {
    expect(() => loadEnv('api', production())).not.toThrow();
  });

  it('accepts an empty optional secret, the way the env files write "unset"', () => {
    // .env.example, docker compose and the CI smoke env all spell an unset
    // optional value as KEY=. Rejecting that as "too short" takes the whole API
    // down at boot over a setting nobody asked for — BillingModule reads empty
    // as "no verifier configured" and the endpoint answers 503.
    expect(() => loadEnv('api', api({ BILLING_WEBHOOK_SECRET: '' }))).not.toThrow();
    expect(loadEnv('api', api({ BILLING_WEBHOOK_SECRET: '' })).BILLING_WEBHOOK_SECRET).toBe('');

    expect(() => loadEnv('api', api({ BILLING_WEBHOOK_SECRET: 'too-short' }))).toThrow(
      EnvValidationError,
    );
    expect(
      loadEnv('api', api({ BILLING_WEBHOOK_SECRET: 'w'.repeat(40) })).BILLING_WEBHOOK_SECRET,
    ).toBe('w'.repeat(40));
  });

  it('refuses a worker that would send mail to itself', () => {
    const worker = {
      DATABASE_URL: BASE.DATABASE_URL,
      REDIS_URL: BASE.REDIS_URL,
      MAIL_HOST: 'localhost',
      MAIL_FROM: 'no-reply@example.com',
      S3_ENDPOINT: BASE.S3_ENDPOINT,
      S3_BUCKET: BASE.S3_BUCKET,
      S3_ACCESS_KEY_ID: BASE.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: BASE.S3_SECRET_ACCESS_KEY,
      FRONTEND_BASE_URL: BASE.FRONTEND_BASE_URL,
      METRICS_ALLOW_CIDRS: BASE.METRICS_ALLOW_CIDRS,
      NODE_ENV: 'production',
    };

    expect(() => loadEnv('worker', worker)).toThrow(EnvValidationError);
    expect(() => loadEnv('worker', { ...worker, MAIL_HOST: 'smtp.example.com' })).not.toThrow();
  });

  it('refuses a worker with no metrics allow-list, because its queue gauges are the alerts', () => {
    expect(() =>
      loadEnv('worker', {
        DATABASE_URL: BASE.DATABASE_URL,
        REDIS_URL: BASE.REDIS_URL,
        MAIL_HOST: 'smtp.example.com',
        MAIL_FROM: 'no-reply@example.com',
        S3_ENDPOINT: BASE.S3_ENDPOINT,
        S3_BUCKET: BASE.S3_BUCKET,
        S3_ACCESS_KEY_ID: BASE.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: BASE.S3_SECRET_ACCESS_KEY,
        FRONTEND_BASE_URL: BASE.FRONTEND_BASE_URL,
        NODE_ENV: 'production',
      }),
    ).toThrow(EnvValidationError);
  });

  it('refuses a scheduler with no metrics allow-list: the outbox gauges live there', () => {
    expect(() =>
      loadEnv('scheduler', {
        DATABASE_URL: BASE.DATABASE_URL,
        REDIS_URL: BASE.REDIS_URL,
        NODE_ENV: 'production',
      }),
    ).toThrow(EnvValidationError);
  });
});

describe('loadEnv — role isolation', () => {
  it('requires REDIS_URL of a worker because BullMQ is its job broker', () => {
    const env = loadEnv('worker', {
      DATABASE_URL: BASE.DATABASE_URL,
      REDIS_URL: BASE.REDIS_URL,
      MAIL_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
      S3_ENDPOINT: BASE.S3_ENDPOINT,
      S3_BUCKET: BASE.S3_BUCKET,
      S3_ACCESS_KEY_ID: BASE.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: BASE.S3_SECRET_ACCESS_KEY,
    });

    expect(env.QUEUE_CONCURRENCY).toBe(5);
    expect(env.REDIS_URL).toBe(BASE.REDIS_URL);
  });

  it('gives the scheduler a drain interval that can meet the dispatch target', () => {
    const env = loadEnv('scheduler', {
      DATABASE_URL: BASE.DATABASE_URL,
      REDIS_URL: BASE.REDIS_URL,
    });

    expect(env.OUTBOX_DRAIN_INTERVAL_SECONDS).toBe(10);
    expect(env.OUTBOX_DRAIN_BATCH_SIZE).toBe(100);
  });

  it('refuses a scheduler drain interval that would blow the p95 target', () => {
    expect(() =>
      loadEnv('scheduler', {
        DATABASE_URL: BASE.DATABASE_URL,
        NODE_ENV: 'production',
        OUTBOX_DRAIN_INTERVAL_SECONDS: '120',
      }),
    ).toThrow(EnvValidationError);
  });

  it('refuses any role without DATABASE_URL', () => {
    expect(() => loadEnv('api', { ...api(), DATABASE_URL: undefined })).toThrow(EnvValidationError);
  });
});
