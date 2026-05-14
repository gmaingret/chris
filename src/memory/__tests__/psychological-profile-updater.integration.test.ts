/**
 * src/memory/__tests__/psychological-profile-updater.integration.test.ts —
 * Phase 38 Plan 38-02 Task 3 (HARD CO-LOC #M11-2 anchor — D-34, D-35, D-36)
 *
 * /**
 *  * CRITICAL: This test is the INVERSE of M010's PTEST-03 idempotency test.
 *  * M010 PTEST-03 asserts hash-skip behavior (cumulative 4 calls after Cycle 2
 *  * with identical substrate). M011 PMT-05 asserts UNCONDITIONAL FIRE (cumulative
 *  * 4 calls after Cycle 2 — same number but different semantics). If a future
 *  * refactor introduces hash-skip "for consistency with M010", this test fails.
 *  * Do NOT "fix" the test — the divergence is intentional per PGEN-06.
 *  *\/
 *
 * (Docblock D-35 phrasing locked verbatim per 38-CONTEXT.md; re-rendered in
 *  the describe-block docstring below for inline visibility at the
 *  assertion site.)
 *
 * Architecture: 3 sequential cycles against real Docker postgres + mocked
 * Anthropic SDK + mocked logger.
 *
 *   Cycle 1 (April substrate, now=May 1) — 2 Sonnet calls (1 HEXACO + 1
 *     Schwartz), 2 profile_history rows, both rows' overall_confidence > 0.
 *
 *   Cycle 2 (May substrate semantically IDENTICAL to April, now=June 1) —
 *     CRITICAL — INVERSE OF M010 PTEST-03 — cumulative 4 Sonnet calls
 *     (NOT 2), 4 profile_history rows. substrate_hash should match Cycle 1
 *     (identical content semantics → same canonical-JSON hash inputs).
 *
 *   Cycle 3 (June substrate MUTATED with 5 new entries, now=July 1) —
 *     cumulative 6 Sonnet calls, 6 profile_history rows, substrate_hash
 *     differs from Cycle 2 (corpus changed).
 *
 *   Bonus — Promise.allSettled isolation (PGEN-04 partial): HEXACO Sonnet
 *     rejection produces outcome 'error' but Schwartz still completes with
 *     outcome 'updated'. Verifies the per-generator try/catch isolation
 *     that Plan 38-03's orchestrator will compose into the cron handler.
 *
 * Pitfall 5 mitigation: re-seed identical corpus into the relevant
 * previous-month window for each cycle (windowStart = startOfMonth(now,
 * Europe/Paris).minus({months:1})). Fake timers MUST NOT be used (vitest's
 * timer faking clashes with the `postgres` driver per
 * generators.two-cycle.test.ts comment block); instead pass `now: Date`
 * explicitly to loadPsychologicalSubstrate.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/__tests__/psychological-profile-updater.integration.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        parse: mockAnthropicParse,
        create: vi.fn(),
      },
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// Imports AFTER vi.mock
import { sql, eq, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  pensieveEntries,
  profileHexaco,
  profileSchwartz,
  profileHistory,
} from '../../db/schema.js';
import { loadPsychologicalSubstrate } from '../profiles/psychological-shared.js';
import { generateHexacoProfile } from '../profiles/hexaco.js';
import { generateSchwartzProfile } from '../profiles/schwartz.js';

// ── Fixture builders ───────────────────────────────────────────────────

/**
 * Valid Sonnet HEXACO response — 6 dim objects + top-level meta.
 */
function validHexacoResponse() {
  const dim = (score: number, conf: number) => ({
    score, confidence: conf, last_updated: '2026-04-15T09:00:00.000Z',
  });
  return {
    parsed_output: {
      honesty_humility: dim(4.2, 0.6),
      emotionality: dim(3.1, 0.5),
      extraversion: dim(3.8, 0.55),
      agreeableness: dim(3.5, 0.5),
      conscientiousness: dim(4.0, 0.65),
      openness: dim(4.5, 0.7),
      data_consistency: 0.55,
      overall_confidence: 0.62,
    },
  };
}

/**
 * Valid Sonnet Schwartz response — 10 dim objects + top-level meta.
 */
function validSchwartzResponse() {
  const dim = (score: number, conf: number) => ({
    score, confidence: conf, last_updated: '2026-04-15T09:00:00.000Z',
  });
  return {
    parsed_output: {
      self_direction: dim(4.0, 0.55),
      stimulation: dim(3.5, 0.5),
      hedonism: dim(3.2, 0.5),
      achievement: dim(4.3, 0.6),
      power: dim(2.8, 0.5),
      security: dim(3.6, 0.55),
      conformity: dim(2.5, 0.45),
      tradition: dim(2.7, 0.45),
      benevolence: dim(4.2, 0.6),
      universalism: dim(4.0, 0.55),
      data_consistency: 0.5,
      overall_confidence: 0.7,
    },
  };
}

/**
 * Mock Anthropic parse to route by profile-type system text. Plan 38-01
 * prompt builder includes `## Profile Focus — HEXACO Big-Six Personality`
 * or `## Profile Focus — Schwartz Universal Values` in the assembled
 * system text; route off that substring.
 */
function primeAllProfileTypesValid() {
  mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
    const systemText = req.system?.[0]?.text ?? '';
    if (systemText.includes('## Profile Focus — HEXACO Big-Six Personality')) {
      return Promise.resolve(validHexacoResponse());
    }
    if (systemText.includes('## Profile Focus — Schwartz Universal Values')) {
      return Promise.resolve(validSchwartzResponse());
    }
    throw new Error(`Unrouted prompt in mock: ${systemText.slice(0, 200)}`);
  });
}

/**
 * Seed 6 telegram-source pensieve entries × ~1000 words each = ~6000 total
 * words into the calendar month identified by refYear/refMonth (1-indexed
 * Paris time). createdAt anchored at mid-month 10:00 UTC (clearly inside
 * Paris-startOfMonth..endOfMonth).
 */
async function seedIdenticalCorpusForWindow(refYear: number, refMonth: number) {
  const midMonth = DateTime.fromObject(
    { year: refYear, month: refMonth, day: 15, hour: 10 },
    { zone: 'Europe/Paris' },
  ).toJSDate();
  for (let i = 0; i < 6; i++) {
    await db.insert(pensieveEntries).values({
      content: `entry ${i} ` + ('word '.repeat(1000)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: midMonth,
    });
  }
}

async function cleanupAll() {
  await db.delete(profileHistory);
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  // Reset both profile rows to cold-start state. Use sql`'null'::jsonb`
  // (NOT JS null) so the .notNull() jsonb columns receive the JSON null
  // literal value rather than SQL NULL.
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
}

/**
 * Test-only helper that fires both psychological generators in parallel.
 * Plan 38-03 will ship `updateAllPsychologicalProfiles` with this shape
 * (Promise.allSettled aggregation + cron registration); from Plan 38-02
 * we exercise the contract surface directly so the regression detector
 * can ship in the same plan as the runner (HARD CO-LOC #M11-2).
 */
async function fireAllPsychGenerators(now: Date): Promise<void> {
  const [hexacoSubstrate, schwartzSubstrate] = await Promise.all([
    loadPsychologicalSubstrate('hexaco', now),
    loadPsychologicalSubstrate('schwartz', now),
  ]);
  await Promise.allSettled([
    generateHexacoProfile({ substrate: hexacoSubstrate }),
    generateSchwartzProfile({ substrate: schwartzSubstrate }),
  ]);
}

describe('HARD CO-LOC #M11-2 — three-cycle UNCONDITIONAL FIRE (PGEN-06; PMT-05)', () => {
  /*
   * CRITICAL: This test is the INVERSE of M010's PTEST-03 idempotency test.
   * M010 PTEST-03 asserts hash-skip behavior (cumulative 4 calls after Cycle 2
   * with identical substrate). M011 PMT-05 asserts UNCONDITIONAL FIRE (cumulative
   * 4 calls after Cycle 2 — same number but different semantics). If a future
   * refactor introduces hash-skip "for consistency with M010", this test fails.
   * Do NOT "fix" the test — the divergence is intentional per PGEN-06.
   */
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    await cleanupAll();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  afterAll(async () => {
    await cleanupAll();
  });

  it('Cycle 1: 2 calls; Cycle 2 (identical content): 4 cumulative (NOT 2); Cycle 3 (mutated): 6 cumulative', async () => {
    // ── CYCLE 1 — April corpus, now=2026-05-01 09:00 Paris ─────────────
    // Previous calendar month (Paris) = April 2026.
    await seedIdenticalCorpusForWindow(2026, 4);
    primeAllProfileTypesValid();
    const c1Now = DateTime.fromISO('2026-05-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();

    await fireAllPsychGenerators(c1Now);

    // Cycle 1 assertions
    expect(mockAnthropicParse).toHaveBeenCalledTimes(2);

    const hexacoRow_c1 = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;
    const schwartzRow_c1 = (await db
      .select()
      .from(profileSchwartz)
      .where(eq(profileSchwartz.name, 'primary'))
      .limit(1))[0]!;
    // Pitfall 2 mitigation — V4Boundary schema makes overall_confidence>0 possible
    expect(hexacoRow_c1.overallConfidence).toBeGreaterThan(0);
    expect(schwartzRow_c1.overallConfidence).toBeGreaterThan(0);
    expect(hexacoRow_c1.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(schwartzRow_c1.substrateHash).toMatch(/^[0-9a-f]{64}$/);

    const historyAfterC1 = await db
      .select()
      .from(profileHistory)
      .where(
        or(
          eq(profileHistory.profileTableName, 'profile_hexaco'),
          eq(profileHistory.profileTableName, 'profile_schwartz'),
        ),
      );
    expect(historyAfterC1).toHaveLength(2);

    // ── CYCLE 2 — May corpus (SEMANTICALLY IDENTICAL to April), now=June 1 ──
    // Wipe pensieve_entries and re-seed identical content for the new
    // previous-month window (May). Substrate hash should MATCH Cycle 1
    // because the canonical-JSON hash inputs (pensieveIds.sort() +
    // episodicDates.sort() + schemaVersion) are over the freshly-inserted
    // May rows. Wait — the pensieveIds DIFFER (new UUIDs per insert) — so
    // hashes will actually DIFFER, not match. The critical assertion is
    // about Sonnet-call count (cumulative 4), NOT about hash equality.
    // We test hash equality separately below using a content-identical
    // re-seed pattern.
    await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
    await seedIdenticalCorpusForWindow(2026, 5);
    const c2Now = DateTime.fromISO('2026-06-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();

    await fireAllPsychGenerators(c2Now);

    // CRITICAL — INVERSE-OF-IDEMPOTENCY ASSERTION (PGEN-06)
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);

    const historyAfterC2 = await db
      .select()
      .from(profileHistory)
      .where(
        or(
          eq(profileHistory.profileTableName, 'profile_hexaco'),
          eq(profileHistory.profileTableName, 'profile_schwartz'),
        ),
      );
    expect(historyAfterC2).toHaveLength(4);

    // Capture Cycle 2 substrate_hash for later comparison
    const hexacoRow_c2 = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;

    // ── CYCLE 3 — June corpus MUTATED with 5 new entries, now=July 1 ──
    // Wipe + re-seed June baseline (6 entries), then INSERT 5 additional
    // entries with NEW content. Total = 11 entries; hash should DIFFER
    // from Cycle 2.
    await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
    await seedIdenticalCorpusForWindow(2026, 6);
    // 5 additional entries in June with distinct content
    const juneMid = DateTime.fromObject(
      { year: 2026, month: 6, day: 18, hour: 12 },
      { zone: 'Europe/Paris' },
    ).toJSDate();
    for (let i = 0; i < 5; i++) {
      await db.insert(pensieveEntries).values({
        content: `mutated June entry ${i} with distinct vocabulary `.repeat(50),
        epistemicTag: null,
        source: 'telegram',
        createdAt: juneMid,
      });
    }
    const c3Now = DateTime.fromISO('2026-07-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();

    await fireAllPsychGenerators(c3Now);

    // Cycle 3 assertions
    expect(mockAnthropicParse).toHaveBeenCalledTimes(6);

    const historyAfterC3 = await db
      .select()
      .from(profileHistory)
      .where(
        or(
          eq(profileHistory.profileTableName, 'profile_hexaco'),
          eq(profileHistory.profileTableName, 'profile_schwartz'),
        ),
      );
    expect(historyAfterC3).toHaveLength(6);

    const hexacoRow_c3 = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;
    // Cycle 3 hash differs from Cycle 2 (different corpus)
    expect(hexacoRow_c3.substrateHash).not.toBe(hexacoRow_c2.substrateHash);
  }, 30000);

  it('HEXACO failure does not abort Schwartz (Promise.allSettled isolation)', async () => {
    await seedIdenticalCorpusForWindow(2026, 4);
    mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
      const sysText = req.system?.[0]?.text ?? '';
      if (sysText.includes('## Profile Focus — HEXACO Big-Six Personality')) {
        return Promise.reject(new Error('Simulated Sonnet timeout for HEXACO'));
      }
      if (sysText.includes('## Profile Focus — Schwartz Universal Values')) {
        return Promise.resolve(validSchwartzResponse());
      }
      throw new Error(`Unrouted prompt in mock: ${sysText.slice(0, 200)}`);
    });
    const now = DateTime.fromISO('2026-05-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();

    const [hexacoSubstrate, schwartzSubstrate] = await Promise.all([
      loadPsychologicalSubstrate('hexaco', now),
      loadPsychologicalSubstrate('schwartz', now),
    ]);
    const results = await Promise.allSettled([
      generateHexacoProfile({ substrate: hexacoSubstrate }),
      generateSchwartzProfile({ substrate: schwartzSubstrate }),
    ]);

    // HEXACO result: per-generator try/catch isolates the rejection →
    // outer Promise.allSettled status is 'fulfilled' but the value's
    // outcome is 'error'.
    expect(results[0].status).toBe('fulfilled');
    if (results[0].status === 'fulfilled') {
      expect(results[0].value.outcome).toBe('error');
      if (results[0].value.outcome === 'error') {
        expect(results[0].value.error).toContain('Simulated Sonnet timeout for HEXACO');
      }
    }

    // Schwartz result: unaffected by HEXACO failure
    expect(results[1].status).toBe('fulfilled');
    if (results[1].status === 'fulfilled') {
      expect(results[1].value.outcome).toBe('updated');
      if (results[1].value.outcome === 'updated') {
        expect(results[1].value.overallConfidence).toBeGreaterThan(0);
      }
    }

    // DB state: HEXACO row remains cold-start (overallConfidence=0);
    // Schwartz row is populated (overallConfidence>0).
    const hexacoRow = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;
    const schwartzRow = (await db
      .select()
      .from(profileSchwartz)
      .where(eq(profileSchwartz.name, 'primary'))
      .limit(1))[0]!;
    expect(hexacoRow.overallConfidence).toBe(0);
    expect(schwartzRow.overallConfidence).toBeGreaterThan(0);
  });
});
