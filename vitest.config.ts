import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    environment: 'node',
    globals: false,
    include: ['**/__tests__/**/*.test.ts'],
    // Phase 18 WR-01: run test files serially (no parallel file execution).
    // Multiple suites (synthetic-fixture, live-accountability, vague-validator-live)
    // each delete `pensieve_entries WHERE source='telegram'` as cleanup, and
    // `pensieve_entries` has no chatId column to scope deletes by. Under vitest's
    // default parallel pool, cleanup in one file races and deletes rows written by
    // siblings. `fileParallelism: false` serializes file execution and eliminates
    // the race (Vitest 4 top-level option — replaces the old `poolOptions.forks.singleFork`).
    fileParallelism: false,
  },
});
