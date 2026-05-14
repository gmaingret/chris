/**
 * src/__tests__/fixtures/seed-psych-profile-rows.ts — Phase 40 Plan 01
 * Task 2 (M011 PMT-01..05 test scaffold).
 *
 * Idempotent helper that resets `profile_hexaco`, `profile_schwartz`,
 * `profile_attachment` rows to migration-0013 cold-start state AND scopes
 * the `profile_history` wipe to M011 profile tables only (PRESERVES M010
 * history rows — cross-milestone decoupling).
 *
 * **SIBLING of M010's `seed-profile-rows.ts`, NOT a parameterization.** The
 * M010 helper resets 4 different tables (profile_jurisdictional, capital,
 * health, family) with non-trivial seed values from migration 0012 (HIGH
 * confidence on the operational profiles). The M011 helper resets 3
 * different tables (hexaco, schwartz, attachment) to migration-0013
 * cold-start values (`overall_confidence=0`, `word_count=0`, all dim jsonb
 * columns = `'null'::jsonb`). Trying to parameterize one helper to cover
 * both would create cross-milestone coupling that pitfalls (any change to
 * either milestone's seed shape breaks both) — siblings is the right shape.
 *
 * **Why the SCOPED profile_history wipe (cross-milestone decoupling):**
 *
 * `profile_history` is a polymorphic snapshot table with a
 * `profile_table_name` discriminator column. M010 writes rows tagged
 * 'profile_jurisdictional' / 'capital' / 'health' / 'family'; M011 writes
 * rows tagged 'profile_hexaco' / 'profile_schwartz' / 'profile_attachment'.
 *
 * An UNSCOPED `delete(profileHistory)` would erase M010 history rows that
 * a parallel M010 test fixture relies on (e.g., generators.two-cycle.test.ts
 * loads its baseline from prior cycle's history rows). The
 * `WHERE profile_table_name IN ('profile_hexaco', 'profile_schwartz',
 * 'profile_attachment')` predicate ensures M011 reset does NOT clobber
 * M010 state in a shared DB session.
 *
 * **Why this helper exists (source map):**
 *
 * Body extracted from Phase 38's inline `cleanupAll()` at
 * `src/memory/__tests__/psychological-profile-updater.integration.test.ts:183-226`
 * (Plan 38-02 contract-level three-cycle test). Plan 40-01 DRYs that body
 * into a shared helper consumable by:
 *   - integration-m011-1000words.test.ts (PMT-03)
 *   - integration-m011-30days.test.ts (PMT-04 + PMT-05)
 *
 * Phase 38's inline cleanupAll only reset hexaco + schwartz (attachment
 * wasn't shipped at Phase 38 time per Plan 38-02 D-23). This helper ALSO
 * resets attachment per Phase 37 PSCH-04 which DID ship the table schema
 * (the row exists from migration 0013 cold-start).
 *
 * **Idempotency contract:** calling `seedPsychProfileRows()` twice in a
 * row produces the same end state. Both calls perform identical
 * scoped-DELETE + 3 UPDATEs.
 *
 * Run via Docker harness (consumers):
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-1000words.test.ts
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-30days.test.ts
 */
import type postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  profileHexaco,
  profileSchwartz,
  profileAttachment,
  profileHistory,
} from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

export interface SeedPsychProfileRowsOptions {
  /**
   * Optional postgres.Sql client override. Mirrors the seed-profile-rows.ts
   * dbOverride contract — used by tests that want to route through a
   * specific client (e.g., a transaction wrapper). When omitted, the
   * module-singleton `sql` from `db/connection.js` is used. The current
   * implementation uses Drizzle (`db`) directly; the `dbOverride` is
   * accepted for API symmetry with the M010 sibling and is reserved for
   * future raw-SQL extensions.
   */
  dbOverride?: postgres.Sql;
}

/**
 * Idempotently reset all 3 psychological-profile tables to migration-0013
 * cold-start state and SCOPE-wipe `profile_history` to M011 tables only.
 *
 * Steps:
 *   1. DELETE FROM profile_history WHERE profile_table_name IN
 *      ('profile_hexaco', 'profile_schwartz', 'profile_attachment')
 *      — SCOPED wipe preserves M010 history rows (cross-milestone decoupling)
 *   2. UPDATE profile_hexaco SET <cold-start columns> WHERE name='primary'
 *   3. UPDATE profile_schwartz SET <cold-start columns> WHERE name='primary'
 *   4. UPDATE profile_attachment SET <cold-start columns> WHERE name='primary'
 *
 * Cold-start values per migration 0013 (substrate_hash='',
 * overall_confidence=0, word_count=0, word_count_at_last_run=0, all dim
 * jsonb columns = `'null'::jsonb`, lastUpdated=null). profile_attachment
 * additionally sets relational_word_count=0, activated=false (D-07 / D028
 * activation gate cold-start).
 *
 * Performance note: each call performs 1 scoped DELETE + 3 UPDATEs.
 * Safe to call in every `beforeEach` hook for fixture-driven test suites.
 */
export async function seedPsychProfileRows(
  opts: SeedPsychProfileRowsOptions = {},
): Promise<void> {
  // dbOverride accepted for API symmetry with the M010 sibling; current
  // implementation routes through the Drizzle module singleton. Reserve
  // the option for future raw-SQL extensions.
  void opts.dbOverride;

  // Step 1: SCOPED profile_history wipe — only M011 table rows.
  // Cross-milestone decoupling: an UNSCOPED `db.delete(profileHistory)`
  // would erase M010 history rows that parallel M010 tests rely on.
  await db
    .delete(profileHistory)
    .where(
      inArray(profileHistory.profileTableName, [
        'profile_hexaco',
        'profile_schwartz',
        'profile_attachment',
      ]),
    );

  // Step 2: reset profile_hexaco to migration-0013 cold-start state.
  // All 6 HEXACO dim jsonb columns reset to literal JSON null per Phase
  // 37 D-08 ('null'::jsonb, NOT SQL NULL — the `.notNull()` Drizzle
  // column requires the JSON null literal to round-trip through the Zod
  // v3 reader as `null`).
  await db
    .update(profileHexaco)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      honestyHumility: sql`'null'::jsonb`,
      emotionality: sql`'null'::jsonb`,
      extraversion: sql`'null'::jsonb`,
      agreeableness: sql`'null'::jsonb`,
      conscientiousness: sql`'null'::jsonb`,
      openness: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileHexaco.name, 'primary'));

  // Step 3: reset profile_schwartz to migration-0013 cold-start state.
  // All 10 Schwartz value jsonb columns reset to literal JSON null.
  await db
    .update(profileSchwartz)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      selfDirection: sql`'null'::jsonb`,
      stimulation: sql`'null'::jsonb`,
      hedonism: sql`'null'::jsonb`,
      achievement: sql`'null'::jsonb`,
      power: sql`'null'::jsonb`,
      security: sql`'null'::jsonb`,
      conformity: sql`'null'::jsonb`,
      tradition: sql`'null'::jsonb`,
      benevolence: sql`'null'::jsonb`,
      universalism: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileSchwartz.name, 'primary'));

  // Step 4: reset profile_attachment to migration-0013 cold-start state.
  // PATTERNS.md flags that Phase 38's cleanupAll() only reset hexaco +
  // schwartz because attachment wasn't shipped at Phase 38 time; this
  // helper INCLUDES attachment per Phase 37 PSCH-04. relational_word_count
  // and activated columns reset to cold-start (D-07 D028 activation gate).
  await db
    .update(profileAttachment)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      relationalWordCount: 0,
      activated: false,
      anxious: sql`'null'::jsonb`,
      avoidant: sql`'null'::jsonb`,
      secure: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileAttachment.name, 'primary'));

  // Quiet, non-load-bearing observability — matches the M010 sibling
  // logger.info shape so the test log stream's `fixture.seed_*` namespace
  // is uniformly parseable.
  logger.info(
    { tables: 3, historyWiped: true, scoped: 'm011_only' },
    'fixture.seed_psych_profile_rows.done',
  );

  // Reference pgSql to keep the import alive for future raw-SQL paths.
  void pgSql;
}
