/**
 * Phase 37 Plan 37-02 Task 7 (PSCH-09 coverage)
 *
 * Mixed unit + integration tests for getPsychologicalProfiles. Verifies the
 * never-throw contract and the 3-layer Zod v3 parse defense with distinct
 * log event namespace `chris.psychological.profile.read.*`.
 *
 * Coverage:
 *   - Happy path (real DB seed rows from migration 0013): all 3 profiles
 *     parse successfully under cold-start (all dim jsonb 'null', no
 *     last_updated), confidence === 0, schemaVersion === 1.
 *   - Layer 1 (schema_mismatch): row with schema_version=999 → null + warn
 *     `chris.psychological.profile.read.schema_mismatch`; sibling profiles
 *     still parse (per-profile isolation).
 *   - Layer 2 (parse_failed): row with corrupted jsonb on one dim (score
 *     as string) → null + warn `chris.psychological.profile.read.parse_failed`;
 *     sibling profiles still parse.
 *   - Layer 3 (unknown_error): db.select stubbed to throw → all 3 results
 *     null + warn `chris.psychological.profile.read.unknown_error` exactly
 *     3 times (one per profile read attempt).
 *   - Never-throws contract: every invocation wrapped in try/catch with
 *     expect.fail on throw — confirms the contract holds across all layers.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/psychological-profiles.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import * as connectionModule from '../../../db/connection.js';
import { db, sql as pgSql } from '../../../db/connection.js';
import { logger } from '../../../utils/logger.js';
import { getPsychologicalProfiles } from '../../profiles.js';

// ── Setup helpers ───────────────────────────────────────────────────────

/**
 * Reset all 3 psychological-profile tables to the migration-0013 cold-start
 * state. Idempotent — safe to run before each test. We TRUNCATE rather than
 * DELETE so an autovacuum-related row visibility quirk can't survive across
 * tests, then re-INSERT the seed rows verbatim.
 */
async function resetToColdStart() {
  await db.execute(sql`TRUNCATE TABLE profile_hexaco CASCADE`);
  await db.execute(sql`TRUNCATE TABLE profile_schwartz CASCADE`);
  await db.execute(sql`TRUNCATE TABLE profile_attachment CASCADE`);

  await db.execute(sql`
    INSERT INTO profile_hexaco
      (name, schema_version, substrate_hash, overall_confidence,
       word_count, word_count_at_last_run)
    VALUES ('primary', 1, '', 0, 0, 0)
  `);
  await db.execute(sql`
    INSERT INTO profile_schwartz
      (name, schema_version, substrate_hash, overall_confidence,
       word_count, word_count_at_last_run)
    VALUES ('primary', 1, '', 0, 0, 0)
  `);
  await db.execute(sql`
    INSERT INTO profile_attachment
      (name, schema_version, substrate_hash, overall_confidence,
       word_count, word_count_at_last_run,
       relational_word_count, activated)
    VALUES ('primary', 1, '', 0, 0, 0, 0, false)
  `);
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  await pgSql`SELECT 1 as ok`;
});

beforeEach(async () => {
  await resetToColdStart();
  warnSpy = vi.spyOn(logger, 'warn');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetToColdStart();
});

// ── Happy path: real-DB cold-start parse ────────────────────────────────

describe('getPsychologicalProfiles — happy path (real DB seed rows from migration 0013)', () => {
  it('returns 3 non-null profiles with cold-start dim:null values', async () => {
    let result;
    try {
      result = await getPsychologicalProfiles();
    } catch (e) {
      expect.fail('getPsychologicalProfiles threw: ' + String(e));
      return;
    }

    // HEXACO
    expect(result.hexaco).not.toBeNull();
    expect(result.hexaco!.schemaVersion).toBe(1);
    expect(result.hexaco!.confidence).toBe(0);
    // All 6 HEXACO dims should be null (cold-start jsonb 'null')
    expect(result.hexaco!.data.honesty_humility).toBeNull();
    expect(result.hexaco!.data.emotionality).toBeNull();
    expect(result.hexaco!.data.openness).toBeNull();

    // Schwartz
    expect(result.schwartz).not.toBeNull();
    expect(result.schwartz!.schemaVersion).toBe(1);
    expect(result.schwartz!.confidence).toBe(0);
    expect(result.schwartz!.data.self_direction).toBeNull();
    expect(result.schwartz!.data.universalism).toBeNull();

    // Attachment
    expect(result.attachment).not.toBeNull();
    expect(result.attachment!.schemaVersion).toBe(1);
    expect(result.attachment!.confidence).toBe(0);
    expect(result.attachment!.data.anxious).toBeNull();
    expect(result.attachment!.data.avoidant).toBeNull();
    expect(result.attachment!.data.secure).toBeNull();
  });

  it('cold-start last_updated coalesces to epoch (D-22)', async () => {
    const result = await getPsychologicalProfiles();
    // Seed rows have last_updated=NULL; reader coalesces to new Date(0).
    expect(result.hexaco!.lastUpdated.getTime()).toBe(0);
    expect(result.schwartz!.lastUpdated.getTime()).toBe(0);
    expect(result.attachment!.lastUpdated.getTime()).toBe(0);
  });
});

// ── Layer 1: schema_mismatch ────────────────────────────────────────────

describe('getPsychologicalProfiles — Layer 1 schema_version mismatch', () => {
  it('hexaco schema_version=999 → null + warn schema_mismatch; siblings still parse', async () => {
    await db.execute(sql`
      UPDATE profile_hexaco SET schema_version = 999 WHERE name = 'primary'
    `);

    let result;
    try {
      result = await getPsychologicalProfiles();
    } catch (e) {
      expect.fail('getPsychologicalProfiles threw: ' + String(e));
      return;
    }

    expect(result.hexaco).toBeNull();
    expect(result.schwartz).not.toBeNull();
    expect(result.attachment).not.toBeNull();

    // Verify warn was called with the schema_mismatch event name and payload.
    const schemaMismatchCall = warnSpy.mock.calls.find(
      (c) => c[1] === 'chris.psychological.profile.read.schema_mismatch',
    );
    expect(schemaMismatchCall).toBeDefined();
    expect(schemaMismatchCall![0]).toMatchObject({
      profileType: 'hexaco',
      schemaVersion: 999,
    });
  });
});

// ── Layer 2: parse_failed ───────────────────────────────────────────────

describe('getPsychologicalProfiles — Layer 2 safeParse failure on corrupted jsonb', () => {
  it('hexaco honesty_humility score-as-string → null + warn parse_failed; siblings still parse', async () => {
    // The Zod v3 schema requires score: number 1-5. score: "not-a-number" is
    // a type mismatch → safeParse fails → Layer 2 fires.
    await db.execute(sql`
      UPDATE profile_hexaco
      SET honesty_humility = '{"score": "not-a-number", "confidence": 0.5, "last_updated": "2026-06-01T00:00:00.000Z"}'::jsonb
      WHERE name = 'primary'
    `);

    let result;
    try {
      result = await getPsychologicalProfiles();
    } catch (e) {
      expect.fail('getPsychologicalProfiles threw: ' + String(e));
      return;
    }

    expect(result.hexaco).toBeNull();
    expect(result.schwartz).not.toBeNull();
    expect(result.attachment).not.toBeNull();

    const parseFailedCall = warnSpy.mock.calls.find(
      (c) => c[1] === 'chris.psychological.profile.read.parse_failed',
    );
    expect(parseFailedCall).toBeDefined();
    expect(parseFailedCall![0]).toMatchObject({ profileType: 'hexaco' });
  });
});

// ── Layer 3: unknown_error via stubbed db.select throw ──────────────────

describe('getPsychologicalProfiles — Layer 3 unknown throw (mocked DB failure)', () => {
  it('db.select throws → all 3 results null + warn unknown_error 3 times', async () => {
    // Stub db.select to throw synchronously when invoked. Each of the 3
    // parallel readOnePsychologicalProfile calls catches the throw and
    // emits its own warn — exactly 3 warns expected.
    const selectSpy = vi.spyOn(connectionModule.db, 'select').mockImplementation(() => {
      throw new Error('connection refused');
    });

    let result;
    try {
      result = await getPsychologicalProfiles();
    } catch (e) {
      expect.fail('getPsychologicalProfiles threw: ' + String(e));
      return;
    }

    // All 3 null — never-throw aggregate
    expect(result.hexaco).toBeNull();
    expect(result.schwartz).toBeNull();
    expect(result.attachment).toBeNull();

    // 3 distinct unknown_error warns (one per profile)
    const unknownErrorCalls = warnSpy.mock.calls.filter(
      (c) => c[1] === 'chris.psychological.profile.read.unknown_error',
    );
    expect(unknownErrorCalls).toHaveLength(3);

    // Each warn should include the connection-refused error message
    for (const call of unknownErrorCalls) {
      expect(call[0]).toMatchObject({ error: 'connection refused' });
    }

    // Each warn should have a unique profileType
    const types = unknownErrorCalls.map((c) => (c[0] as { profileType: string }).profileType).sort();
    expect(types).toEqual(['attachment', 'hexaco', 'schwartz']);

    selectSpy.mockRestore();
  });
});

// ── Never-throws contract (explicit) ────────────────────────────────────

describe('getPsychologicalProfiles — never throws', () => {
  it('contract holds across cold-start happy path', async () => {
    try {
      await getPsychologicalProfiles();
    } catch (e) {
      expect.fail('getPsychologicalProfiles threw on cold-start: ' + String(e));
    }
  });

  it('contract holds even when ALL rows are deleted (no seed rows present)', async () => {
    await db.execute(sql`DELETE FROM profile_hexaco`);
    await db.execute(sql`DELETE FROM profile_schwartz`);
    await db.execute(sql`DELETE FROM profile_attachment`);

    let result;
    try {
      result = await getPsychologicalProfiles();
    } catch (e) {
      expect.fail('getPsychologicalProfiles threw with empty tables: ' + String(e));
      return;
    }

    // Empty table → readOne returns null per the rows.length === 0 branch.
    expect(result.hexaco).toBeNull();
    expect(result.schwartz).toBeNull();
    expect(result.attachment).toBeNull();
  });
});
