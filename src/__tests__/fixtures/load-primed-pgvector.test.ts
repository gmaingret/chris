/**
 * src/__tests__/fixtures/load-primed-pgvector.test.ts — Phase 45 FIX-05 (v2.6.1).
 *
 * Regression test for the pgvector(1024) staging-table CAST in load-primed.ts.
 *
 * Before FIX-05, the pensieve_embeddings load path used
 * jsonb_populate_recordset(NULL::pensieve_embeddings, $1::jsonb) which fails
 * with "cannot cast type jsonb to vector" the moment a non-empty embeddings
 * JSONL hits the loader (24-REVIEW.md §BL-06). After FIX-05, the embedding
 * column is staged via a TEMP table where the column type is TEXT, then
 * the final INSERT projects `embedding::vector` to land into vector(1024).
 *
 * Setup mirrors load-primed.test.ts: copy the dedicated smoke fixture at
 *   src/__tests__/fixtures/__fixtures__/pgvector-smoke/
 * into the conventional
 *   tests/fixtures/primed/<test-fixture-name>/
 * location that loadPrimedFixture() resolves against.
 *
 * Asserts on a successful round-trip:
 *   - pensieve_embeddings has 1 row after load (count assertion)
 *   - the embedding column type is `vector` (pg_typeof introspection)
 *   - the row's embedding has dimension 1024 (vector_dims introspection)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile, rm, readFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';

// Silence the loader's info/warn logs.
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { db, sql as pgSql } from '../../db/connection.js';
import {
  contradictions,
  pensieveEmbeddings,
  decisionEvents,
  episodicSummaries,
  decisionCaptureState,
  decisions,
  pensieveEntries,
  proactiveState,
  relationalMemory,
} from '../../db/schema.js';
import { loadPrimedFixture } from './load-primed.js';

const TEST_FIXTURE_NAME = 'pgvector-smoke-test';
const TEST_FIXTURE_DIR = join('tests/fixtures/primed', TEST_FIXTURE_NAME);
const TEST_ORGANIC_STAMP = 'pgvector-smoke-organic';
const TEST_ORGANIC_DIR = join('tests/fixtures/prod-snapshot', TEST_ORGANIC_STAMP);
const SRC_FIXTURE = 'src/__tests__/fixtures/__fixtures__/pgvector-smoke';

async function copyFile(src: string, dst: string): Promise<void> {
  const body = await readFile(src);
  await writeFile(dst, body);
}

async function setupFixture(): Promise<void> {
  await mkdir(TEST_FIXTURE_DIR, { recursive: true });
  await copyFile(
    join(SRC_FIXTURE, 'MANIFEST.json'),
    join(TEST_FIXTURE_DIR, 'MANIFEST.json'),
  );
  await copyFile(
    join(SRC_FIXTURE, 'pensieve_entries.jsonl'),
    join(TEST_FIXTURE_DIR, 'pensieve_entries.jsonl'),
  );
  await copyFile(
    join(SRC_FIXTURE, 'pensieve_embeddings.jsonl'),
    join(TEST_FIXTURE_DIR, 'pensieve_embeddings.jsonl'),
  );
  // Fresh organic snapshot dir (loadPrimedFixture diagnoses staleness; we
  // want the load path itself, not a stale-warn detour).
  await mkdir(TEST_ORGANIC_DIR, { recursive: true });
  const now = new Date();
  await utimes(TEST_ORGANIC_DIR, now, now);
}

async function cleanupAllTables(): Promise<void> {
  await db.delete(contradictions);
  await db.delete(pensieveEmbeddings);
  await db.delete(decisionEvents);
  await db.delete(episodicSummaries);
  await db.delete(decisionCaptureState);
  await db.delete(decisions);
  await db.delete(pensieveEntries);
  await db.delete(proactiveState);
  await db.delete(relationalMemory);
}

async function teardownFixture(): Promise<void> {
  await rm(TEST_FIXTURE_DIR, { recursive: true, force: true });
  await rm(TEST_ORGANIC_DIR, { recursive: true, force: true });
}

describe('load-primed FIX-05: pgvector staging-table CAST', () => {
  beforeAll(async () => {
    await cleanupAllTables();
    await setupFixture();
  });

  afterAll(async () => {
    await cleanupAllTables();
    await teardownFixture();
  });

  it('loads a 1024-dim embedding row via staging-table CAST without coercion error', async () => {
    await loadPrimedFixture(TEST_FIXTURE_NAME);
    const rows = await pgSql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM pensieve_embeddings
      WHERE entry_id = '00000000-0000-4000-8000-000000000001'
    `;
    expect(rows[0]?.count).toBe('1');
  });

  it('the loaded embedding column has vector type (introspectable via pg_typeof)', async () => {
    const rows = await pgSql<{ coltype: string }[]>`
      SELECT pg_typeof(embedding)::text AS coltype FROM pensieve_embeddings
      WHERE entry_id = '00000000-0000-4000-8000-000000000001'
      LIMIT 1
    `;
    expect(rows[0]?.coltype).toBe('vector');
  });

  it('the loaded embedding has dimension 1024', async () => {
    // vector_dims() is the pgvector-native dimension introspection function.
    const rows = await pgSql<{ dim: number }[]>`
      SELECT vector_dims(embedding) AS dim FROM pensieve_embeddings
      WHERE entry_id = '00000000-0000-4000-8000-000000000001'
      LIMIT 1
    `;
    expect(rows[0]?.dim).toBe(1024);
  });
});
