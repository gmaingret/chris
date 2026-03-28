/**
 * Integration tests for M003 sync pipeline against a real Postgres database.
 * Requires DATABASE_URL pointing to a running pgvector instance with migrations applied.
 *
 * Run: DATABASE_URL=... npx vitest run src/sync/__tests__/integration.test.ts
 *
 * Skipped in unit test runs (no DATABASE_URL).
 */
import { describe, it } from 'vitest';

describe.skip('M003 integration: real DB (requires DATABASE_URL)', () => {
  it('placeholder — run with DATABASE_URL to enable', () => {});
});
