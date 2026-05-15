/**
 * src/__tests__/fixtures/load-primed.ts — Phase 24 Plan 04 (HARN-01, HARN-02).
 *
 * Consumer-facing loader for primed fixtures produced by Plans 24-02/03.
 *
 * `loadPrimedFixture(name)` clears the target DB in strict reverse-FK order
 * (per D-11, with the corrected `relational_memory` table name — NOT
 * `memories`), bulk-inserts fixture rows in forward-FK order, and
 * diagnoses a stale organic snapshot via Plan 24-01's `isSnapshotStale`
 * (D-09 soft-fail by default; strictFreshness: true throws).
 *
 * Idempotent + collision-safe: repeated calls produce the same end state
 * because cleanup wipes everything before re-insert.
 *
 * The `wellbeing_snapshots` and `conversations` tables are feature-detected
 * via `to_regclass` (D-05): if absent in the current migration set, cleanup
 * and load are silent no-ops for those tables.
 *
 * Schema reconciliation note: REQUIREMENTS.md FETCH-02 and D-11 refer to
 * a `memories` table. The Drizzle schema has NO such table — the M006
 * long-term-memory table is `relational_memory` (schema.ts:134). This
 * loader uses the actual table name; the alias is documented in
 * `.planning/codebase/TESTING.md §Primed-Fixture Pipeline`.
 *
 * Usage:
 *   import { loadPrimedFixture } from 'src/__tests__/fixtures/load-primed.js';
 *
 *   beforeAll(async () => {
 *     await loadPrimedFixture('m008-14days');
 *   });
 */
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type postgres from 'postgres';
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
import { isSnapshotStale } from './freshness.js';
import { logger } from '../../utils/logger.js';
import { ChrisError } from '../../utils/errors.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface LoadPrimedOptions {
  /**
   * Optional postgres.Sql client override. When set, feature-detection
   * probes (to_regclass) and feature-gated DELETEs (conversations,
   * wellbeing_snapshots) route through this client. Bulk-inserts ALSO
   * route through it. The Drizzle `db` delete path cannot be overridden
   * through this option because it is bound to the module-singleton
   * `sql`; this is acceptable in practice because all test suites use
   * the same singleton via `scripts/test.sh`'s DATABASE_URL plumbing.
   */
  dbOverride?: postgres.Sql;
  /**
   * D-09: when true, a stale organic snapshot (> ttlHours old) throws
   * ChrisError('LOAD_PRIMED_STALE_STRICT') instead of warn-logging.
   * Default: false (warn + proceed).
   */
  strictFreshness?: boolean;
  /**
   * TTL in hours for the organic snapshot staleness check. Default: 24
   * (matches Plan 24-01's FRESH-01 baseline).
   */
  ttlHours?: number;
}

interface PrimedManifest {
  organic_stamp: string;
  seed: number;
  target_days: number;
  milestone: string;
  synthetic_date_range: [string, string] | null;
  generated_at: string;
  schema_note?: string;
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function loadJsonl<T>(path: string): Promise<T[]> {
  const exists = await stat(path)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const out: T[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

async function tableExists(
  client: postgres.Sql,
  tableName: string,
): Promise<boolean> {
  const qualified = `public.${tableName}`;
  const result = await client`SELECT to_regclass(${qualified}) AS reg`;
  return result[0]?.reg != null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load a primed fixture (organic + synthetic, produced by Plans 24-02/03)
 * into the Docker Postgres test DB.
 *
 * Contract:
 * 1. Resolve fixture at `tests/fixtures/primed/<name>/`. Throw
 *    ChrisError('LOAD_PRIMED_MISSING_DIR') if absent.
 * 2. Read MANIFEST.json. Diagnose stale organic snapshot per D-09:
 *    - Default: warn-log `'load.primed.organic.stale'` and proceed.
 *    - `{ strictFreshness: true }`: throw ChrisError('LOAD_PRIMED_STALE_STRICT').
 *    If the organic snapshot directory is absent (operator cleared it),
 *    log info-level `'load.primed.organic.absent'` and proceed.
 * 3. Clear target tables in STRICT REVERSE-FK order (D-11, corrected for
 *    schema drift — `relational_memory` NOT `memories`):
 *      conversations (if table exists, D-11 feature-detect)
 *      → contradictions
 *      → pensieve_embeddings
 *      → decision_events
 *      → episodic_summaries
 *      → decision_capture_state
 *      → decisions
 *      → pensieve_entries
 *      → proactive_state
 *      → relational_memory
 *      → wellbeing_snapshots (if table exists, D-05 feature-detect)
 * 4. Bulk-insert in FORWARD-FK order (parents → children):
 *      relational_memory
 *      → wellbeing_snapshots (if table exists)
 *      → proactive_state
 *      → pensieve_entries
 *      → decisions
 *      → decision_capture_state
 *      → decision_events
 *      → pensieve_embeddings
 *      → contradictions
 *      → episodic_summaries
 *      → conversations (if table exists)
 *    Inserts use `jsonb_populate_recordset` (same pattern as Plan 24-03's
 *    `loadFixtureIntoDb`) but WITHOUT ON CONFLICT DO NOTHING: cleanup
 *    just ran, so any conflict indicates fixture internal duplicates — a
 *    bug worth surfacing.
 *
 * Idempotent: repeated calls produce identical end state.
 * Collision-safe: cleanup precedes insert, so pre-seeded rows with
 * fixture UUIDs are wiped before the fixture's rows land.
 */
export async function loadPrimedFixture(
  name: string,
  opts: LoadPrimedOptions = {},
): Promise<void> {
  const fixtureDir = join('tests/fixtures/primed', name);
  const manifestPath = join(fixtureDir, 'MANIFEST.json');

  // 1. Fixture resolution
  const manifestExists = await stat(manifestPath)
    .then(() => true)
    .catch(() => false);
  if (!manifestExists) {
    throw new ChrisError(
      `loadPrimedFixture('${name}'): fixture directory or MANIFEST.json missing at ${manifestPath}`,
      'LOAD_PRIMED_MISSING_DIR',
    );
  }
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as PrimedManifest;

  // 2. Freshness diagnostic (D-09)
  const organicStampPath = join(
    'tests/fixtures/prod-snapshot',
    manifest.organic_stamp,
  );
  const organicExists = await stat(organicStampPath)
    .then(() => true)
    .catch(() => false);
  if (!organicExists) {
    logger.info(
      { name, organic_stamp: manifest.organic_stamp },
      'load.primed.organic.absent',
    );
  } else {
    const ttlHours = opts.ttlHours ?? 24;
    const stale = await isSnapshotStale(organicStampPath, ttlHours);
    if (stale) {
      if (opts.strictFreshness) {
        throw new ChrisError(
          `loadPrimedFixture('${name}'): organic snapshot '${manifest.organic_stamp}' is stale (> ${ttlHours}h); run \`npx tsx scripts/regenerate-primed.ts --milestone ${manifest.milestone} --force\``,
          'LOAD_PRIMED_STALE_STRICT',
        );
      }
      logger.warn(
        { name, organic_stamp: manifest.organic_stamp, ttlHours },
        'load.primed.organic.stale',
      );
    }
  }

  const client: postgres.Sql = opts.dbOverride ?? pgSql;

  // Feature detection (D-05 wellbeing, D-11 conversations).
  const hasConversations = await tableExists(client, 'conversations');
  const hasWellbeing = await tableExists(client, 'wellbeing_snapshots');

  // 3. FK-safe cleanup — strict reverse-FK order (D-11, corrected).
  //    conversations → contradictions → pensieve_embeddings → decision_events
  //    → episodic_summaries → decision_capture_state → decisions
  //    → pensieve_entries → proactive_state → relational_memory
  //    → wellbeing_snapshots
  if (hasConversations) {
    await client`DELETE FROM conversations`;
  }
  await db.delete(contradictions);
  await db.delete(pensieveEmbeddings);
  await db.delete(decisionEvents);
  await db.delete(episodicSummaries);
  await db.delete(decisionCaptureState);
  await db.delete(decisions);
  await db.delete(pensieveEntries);
  await db.delete(proactiveState);
  await db.delete(relationalMemory);
  if (hasWellbeing) {
    await client`DELETE FROM wellbeing_snapshots`;
  }

  // 4. Bulk-insert in forward-FK order (parents → children)
  const counts: Record<string, number> = {};

  async function insertTable(
    jsonlName: string,
    tableName: string,
  ): Promise<void> {
    const rows = await loadJsonl<Record<string, unknown>>(
      join(fixtureDir, jsonlName),
    );
    counts[tableName] = rows.length;
    if (rows.length === 0) return;
    // jsonb_populate_recordset — mirrors scripts/synthesize-episodic.ts.
    // No ON CONFLICT: the cleanup above just emptied every table, so any
    // duplicate-key error here surfaces a genuine fixture bug (internal
    // duplicates) rather than a tolerable collision.
    await client.unsafe(
      `INSERT INTO ${tableName} SELECT * FROM jsonb_populate_recordset(NULL::${tableName}, $1::jsonb)`,
      [JSON.stringify(rows)],
    );
  }

  // FIX-05 (Phase 45 v2.6.1 D-11 + 24-REVIEW.md §BL-06 line 63):
  // pensieve_embeddings.embedding is vector(1024). The straight
  // jsonb_populate_recordset path used by insertTable() cannot coerce a
  // JSONB array into vector — Postgres raises "cannot cast type jsonb to
  // vector" on first non-empty embeddings JSONL regen. Solution: stage
  // into a TEMP table where the embedding column is TEXT, then explicit
  // ::vector CAST in the final INSERT projection. Local helper keeps the
  // surface area minimal (CONTEXT D-12 "Claude's discretion").
  async function insertPensieveEmbeddings(): Promise<void> {
    const rows = await loadJsonl<Record<string, unknown>>(
      join(fixtureDir, 'pensieve_embeddings.jsonl'),
    );
    counts['pensieve_embeddings'] = rows.length;
    if (rows.length === 0) return;

    // Stage into a TEMP table modeled on pensieve_embeddings — INCLUDING
    // DEFAULTS pulls the column DEFAULTs across so we don't have to
    // hand-specify gen_random_uuid(), but we explicitly EXCLUDE INDEXES
    // and CONSTRAINTS: the hnsw `vector_cosine_ops` index on the embedding
    // column requires vector type, but we're about to retype the column
    // to TEXT for the bulk load. Carrying the index over would trip
    // `operator class vector_cosine_ops does not accept data type text`
    // on the subsequent ALTER COLUMN (Rule 1 bug surfaced during FIX-05
    // smoke test development).
    await client.unsafe(
      `CREATE TEMP TABLE IF NOT EXISTS pensieve_embeddings_staging (LIKE pensieve_embeddings INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING INDEXES)`,
    );
    // Override the embedding column type to TEXT in the staging table so
    // jsonb_populate_recordset can land the JSONB-array value verbatim.
    await client.unsafe(
      `ALTER TABLE pensieve_embeddings_staging ALTER COLUMN embedding TYPE text USING embedding::text`,
    );
    // Bulk-load JSONL into staging — embedding column is TEXT here.
    await client.unsafe(
      `INSERT INTO pensieve_embeddings_staging SELECT * FROM jsonb_populate_recordset(NULL::pensieve_embeddings_staging, $1::jsonb)`,
      [JSON.stringify(rows)],
    );
    // Final INSERT with explicit ::vector cast in the projection.
    // Column list must be explicit (NOT SELECT *) because the staging
    // embedding column type is TEXT but the destination is vector(1024).
    await client.unsafe(
      `INSERT INTO pensieve_embeddings (id, entry_id, chunk_index, embedding, model, created_at)
       SELECT id, entry_id, chunk_index, embedding::vector AS embedding, model, created_at
       FROM pensieve_embeddings_staging`,
    );
    // Cleanup — TEMP tables auto-drop at session end, but explicit DROP
    // keeps the staging name available for repeated loadPrimedFixture
    // invocations within the same test session.
    await client.unsafe(`DROP TABLE pensieve_embeddings_staging`);
  }

  await insertTable('relational_memory.jsonl', 'relational_memory');
  if (hasWellbeing) {
    await insertTable('wellbeing_snapshots.jsonl', 'wellbeing_snapshots');
  }
  await insertTable('proactive_state.jsonl', 'proactive_state');
  await insertTable('pensieve_entries.jsonl', 'pensieve_entries');
  await insertTable('decisions.jsonl', 'decisions');
  await insertTable('decision_capture_state.jsonl', 'decision_capture_state');
  await insertTable('decision_events.jsonl', 'decision_events');
  await insertPensieveEmbeddings();
  await insertTable('contradictions.jsonl', 'contradictions');
  await insertTable('episodic_summaries.jsonl', 'episodic_summaries');
  if (hasConversations) {
    await insertTable('conversations.jsonl', 'conversations');
  }

  logger.info({ name, counts }, 'load.primed.done');
}
