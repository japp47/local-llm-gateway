import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallelism: false, // integration tests share one database
  },
});