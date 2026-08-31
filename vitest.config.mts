import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const AREAS = ['bootstrap', 'composition', 'contracts', 'modules', 'platform', 'shared'] as const;

const alias = AREAS.map((area) => ({
  find: new RegExp(`^#${area}/(.*)$`),
  replacement: `${fileURLToPath(new URL(`./src/${area}/`, import.meta.url))}$1/index.ts`,
}));

/**
 * BullMQ shuts a worker down by dropping the socket under its blocking Redis
 * connection, and ioredis then rejects the command that was still in flight with
 * "Connection is closed." That promise lives inside the library — no application
 * code owns it or can await it — so Vitest counts it as an unhandled error and a
 * run in which every test passed still exits non-zero. It only ever appears once
 * a container-backed suite is tearing down, after the assertions have run.
 *
 * The filter is that exact message from an ioredis frame and nothing else. Any
 * other unhandled rejection, including a different ioredis failure, still fails
 * the run. `dangerouslyIgnoreUnhandledErrors` would have hidden all of them.
 */
function isBullMqShutdownRejection(error: {
  message?: string | undefined;
  stack?: string | undefined;
}): boolean {
  return error.message === 'Connection is closed.' && (error.stack ?? '').includes('ioredis');
}

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: { alias },
  test: {
    globals: false,
    environment: 'node',
    onUnhandledError: (error) => (isBullMqShutdownRejection(error) ? false : undefined),
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/architecture/**/*.spec.ts'],
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.ts', 'test/integration/**/*.integration.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.integration.ts',
        'src/**/index.ts',
        'src/main.*.ts',
        'src/platform/prisma/generated/**',
      ],
      // Measured on a full run: 79.5 lines / 80.3 functions / 68.5 branches /
      // 78.4 statements. The floor sits just under that, so it catches a real
      // regression without failing on noise.
      thresholds: { lines: 75, functions: 75, branches: 65, statements: 75 },
    },
  },
});
