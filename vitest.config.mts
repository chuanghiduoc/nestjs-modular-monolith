import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const AREAS = ['bootstrap', 'composition', 'contracts', 'modules', 'platform', 'shared'] as const;

const alias = AREAS.map((area) => ({
  find: new RegExp(`^#${area}/(.*)$`),
  replacement: `${fileURLToPath(new URL(`./src/${area}/`, import.meta.url))}$1/index.ts`,
}));

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
