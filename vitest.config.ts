import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: 'src',
    environment: 'node',
    globals: false,
    include: ['**/__tests__/**/*.test.ts'],
    // Phase 18 WR-01: run test files serially in a single fork.
    // Multiple suites (synthetic-fixture, live-accountability, vague-validator-live)
    // each delete `pensieve_entries WHERE source='telegram'` as cleanup, and
    // `pensieve_entries` has no chatId column to scope deletes by. Under vitest's
    // default parallel pool, cleanup in one file races and deletes rows written by
    // siblings. singleFork serializes file execution and eliminates the race.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
