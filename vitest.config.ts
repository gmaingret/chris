import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Phase 24 Plan 02: root was 'src' historically so include patterns
    // resolved under src/. Plan 24-02 adds operator-script tests at
    // scripts/__tests__/ (following the existing scripts/__tests__/ convention
    // for synthesize-delta) that need to be discovered by vitest, so root is
    // widened to the repo root and the existing `src/**/__tests__` discovery
    // is preserved by explicit include.
    root: '.',
    environment: 'node',
    globals: false,
    include: [
      'src/**/__tests__/**/*.test.ts',
      'scripts/**/__tests__/**/*.test.ts',
    ],
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
