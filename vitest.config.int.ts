import { defineConfig } from 'vitest/config';

// Integration tests: need Postgres at TEST_DATABASE_URL (see .github/workflows/ci.yml).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallelism: false, // the tests share one database
  },
});
