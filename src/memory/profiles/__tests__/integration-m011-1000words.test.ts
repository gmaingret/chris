/**
 * src/memory/profiles/__tests__/integration-m011-1000words.test.ts —
 * Phase 40 Plan 01 Task 5 (PMT-03 sparse-threshold real-DB integration test).
 *
 * Real Docker Postgres + mocked Anthropic SDK + `loadPrimedFixture('m011-1000words')`.
 * Mirrors `integration-m010-5days.test.ts` pattern per D-15 — same vi.hoisted +
 * vi.mock + FIXTURE_PRESENT + beforeAll/beforeEach/afterAll scaffold;
 * adapted to psychological-substrate discriminated-union semantics.
 *
 * ## PMT-03 contract (D-14, D-17, RESEARCH Open Q4 Option A)
 *
 *   - Load m011-1000words fixture: ~1,000 telegram-source words across
 *     5 days — provably below the 5,000-word substrate floor.
 *   - `loadPsychologicalSubstrate('hexaco', NOW).belowThreshold === true`
 *     (Phase 37 PSCH-08 word-count gate fires at substrate-loader level)
 *   - Fire both generators (HEXACO + Schwartz); orchestrator short-circuits
 *     BEFORE any Sonnet call (`runPsychologicalProfileGenerator` Step 1
 *     belowThreshold narrow returns early at psychological-shared.ts:429-440).
 *   - Attachment generator NOT invoked per Phase 38 D-23 (deferred to
 *     v2.6.1 / ATT-POP-01).
 *
 * ## Assertion shape (D-14, D-17)
 *
 *   1. `mockAnthropicParse.toHaveBeenCalledTimes(0)` — D-14 Pitfall §2
 *      structural prevention (sparse-data overconfidence cannot occur if
 *      Sonnet is never invoked).
 *   2. Both outcomes are `'skipped_below_threshold'`.
 *   3. 2 skip-log entries (HEXACO + Schwartz only — attachment not invoked
 *      per D-23).
 *   4. All 3 profile rows preserved at cold-start (`overall_confidence=0`,
 *      `word_count < 5000`).
 *   5. Zero `profile_history` rows written.
 *   6. Attachment row unchanged (D-23).
 *
 * ## OQ-4 reconciliation (RESEARCH Open Questions #4, Option A held)
 *
 * Per RESEARCH §Open Questions #4 — Phase 37/38 below-threshold short-circuit
 * returns BEFORE the row upsert (`runPsychologicalProfileGenerator` at
 * `psychological-shared.ts:429-440` returns early). Therefore
 * `word_count_at_last_run` is NOT updated on the below-threshold path.
 * PMT-03 D-17's "word_count_at_last_run updated to the current wordCount"
 * spec was authored before the Phase 38 implementation was inspected.
 *
 * Reconciled per Option A: assert `wordCountAtLastRun === 0` (matches the
 * actual code path). A v2.6.1 follow-up may add a "write
 * word_count_at_last_run BEFORE short-circuit" code path; if/when that
 * ships, this assertion bumps to `=== currentWordCount`.
 *
 * ## Pitfall mitigations
 *
 *   - **P-36-01 (gitignore):** `existsSync(MANIFEST)` skip-when-absent
 *     pattern. When m011-1000words is absent (sandbox / fresh checkout),
 *     this entire describe block skips cleanly.
 *   - **P-36-02 (loader doesn't seed profile_*):** `seedPsychProfileRows()`
 *     in beforeEach. Without it, a prior test's mutation could leak.
 *   - **Pitfall §2 (sparse-data overconfidence):** the zero-Sonnet-call
 *     assertion structurally prevents this pitfall at the substrate-loader
 *     level — sparse substrate cannot produce overconfident inferences if
 *     Sonnet is never invoked.
 *
 * ## Why we deliberately don't prime mockAnthropicParse
 *
 * Per D-14 / D-17: `expect(mockAnthropicParse).not.toHaveBeenCalled()` is
 * the cost-floor contract. If the orchestrator skips threshold gating and
 * calls Sonnet anyway, `mockAnthropicParse` (a fresh `vi.fn()`) returns
 * undefined, the V4Boundary schema validation throws, and the test FAILS
 * with a clear error class. The negative assertion + throw-on-call work
 * as belt-and-suspenders.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-1000words.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
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

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// Imports AFTER vi.mock
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  profileHexaco,
  profileSchwartz,
  profileAttachment,
  profileHistory,
} from '../../../db/schema.js';
import { loadPsychologicalSubstrate } from '../psychological-shared.js';
import { generateHexacoProfile } from '../hexaco.js';
import { generateSchwartzProfile } from '../schwartz.js';
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedPsychProfileRows } from '../../../__tests__/fixtures/seed-psych-profile-rows.js';

// ── Fixture-presence gate (P-36-01 mitigation) ──────────────────────────────

// FIX-02b (Phase 45 v2.6.1 D-07b): align FIXTURE_NAME with
// synthesize-delta.ts:937 output naming `${milestone}-${targetDays}days`.
// Operator command `--milestone m011-1000words --target-days 5` produces
// `m011-1000words-5days` on disk; the previous constant `m011-1000words`
// (no `-5days`) caused existsSync to return false → entire describe block
// silently skipped including the PMT-03 baseline test. Ref 40-REVIEW.md
// §BL-01 Option-b lines 38-42.
const FIXTURE_NAME = 'm011-1000words-5days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);

if (!FIXTURE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[integration-m011-1000words] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m011-1000words ` +
      `--target-days 5 --psych-profile-bias --force --seed 42`,
  );
}

// Phase 44 CI-02: REQUIRE_FIXTURES=1 env-gated hard-fail.
// FIXTURE_NAME = 'm011-1000words-5days' (Phase 45 FIX-02b alignment with
// synthesize-delta.ts:964 `${milestone}-${targetDays}days` output dir).
if (!FIXTURE_PRESENT && process.env.REQUIRE_FIXTURES === '1') {
  describe('[CI-GATE] fixture present', () => {
    it(`${FIXTURE_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
      throw new Error(
        `Milestone-gate fixture missing: ${FIXTURE_PATH}. ` +
          `Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone m011-1000words --target-days 5 --psych-profile-bias --force --seed 42`,
      );
    });
  });
}

const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;

// ── NOW anchor — within fixture date range ─────────────────────────────────
//
// The m011-1000words fixture spans 5 days following the organic window.
// Phase 37 substrate loader uses the previous-calendar-month window in
// Europe/Paris. Anchor at 2026-05-01 so previous-month = April 2026, which
// captures fixture entries that fall in late April / early-May. (The exact
// anchor isn't load-bearing for PMT-03 — the assertion is "below 5000
// words" which is global to the fixture's pensieve table contents.)

const NOW = new Date('2026-05-01T09:00:00.000Z');

// ── Test suite ──────────────────────────────────────────────────────────────

skipIfAbsent('integration-m011-1000words: PMT-03 sparse threshold enforcement (D-14, D-17)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    await loadPrimedFixture(FIXTURE_NAME);
  });

  beforeEach(async () => {
    // P-36-02 mitigation — reset psych profile rows + scoped history wipe.
    await seedPsychProfileRows();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    // Deliberately NOT priming mockAnthropicParse — any call here is a
    // contract violation; the unprimed mock returns undefined → V4Boundary
    // schema throws → test fails loud.
  });

  afterAll(async () => {
    // Leave clean state for downstream test files.
    await db.delete(profileHistory);
    await seedPsychProfileRows();
  });

  it('PMT-03: 1000 words → both generators trip threshold, zero Sonnet, profiles preserved', async () => {
    // ── Pre-call snapshot (anti-mutation baseline) ─────────────────────────
    const hexacoBefore = await db.select().from(profileHexaco);
    const schwartzBefore = await db.select().from(profileSchwartz);
    const attachmentBefore = await db.select().from(profileAttachment);
    expect(hexacoBefore).toHaveLength(1);
    expect(schwartzBefore).toHaveLength(1);
    expect(attachmentBefore).toHaveLength(1);

    // ── Substrate load — must be belowThreshold for both ──────────────────
    const hexacoSubstrate = await loadPsychologicalSubstrate('hexaco', NOW);
    const schwartzSubstrate = await loadPsychologicalSubstrate('schwartz', NOW);
    expect(hexacoSubstrate.belowThreshold).toBe(true);
    expect(schwartzSubstrate.belowThreshold).toBe(true);

    // ── Fire both generators (HEXACO + Schwartz; attachment not invoked) ──
    // Per Phase 38 D-23, attachment is NOT included in
    // updateAllPsychologicalProfiles. We mirror that by firing only the
    // 2 active generators (matching the orchestrator's behavior).
    const outcomes = await Promise.all([
      generateHexacoProfile({ substrate: hexacoSubstrate }),
      generateSchwartzProfile({ substrate: schwartzSubstrate }),
    ]);

    // ── Assertion 1 (D-14 / D-17 / Pitfall §2 structural prevention) ──────
    // Zero Sonnet calls: sparse substrate cannot produce overconfident
    // inferences if Sonnet is never invoked.
    expect(mockAnthropicParse).not.toHaveBeenCalled();

    // ── Assertion 2: both outcomes are 'skipped_below_threshold' ──────────
    expect(outcomes.every((o) => o.outcome === 'skipped_below_threshold')).toBe(true);

    // ── Assertion 3: 2 skip-log entries (HEXACO + Schwartz; D-23) ─────────
    // Attachment generator NOT invoked (Phase 38 D-23) — exactly 2 log
    // entries, not 3.
    const skipLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) =>
        typeof c[1] === 'string' &&
        c[1].startsWith('chris.psychological.') &&
        c[1].endsWith('.skipped_below_threshold'),
    );
    expect(skipLogCalls).toHaveLength(2);

    // ── Assertion 4: all 3 profile rows preserved at cold-start ───────────
    const hexacoAfter = await db.select().from(profileHexaco);
    const schwartzAfter = await db.select().from(profileSchwartz);
    expect(hexacoAfter[0]!.overallConfidence).toBe(0);
    expect(schwartzAfter[0]!.overallConfidence).toBe(0);
    expect(hexacoAfter[0]!.wordCount).toBeLessThan(5000);
    expect(schwartzAfter[0]!.wordCount).toBeLessThan(5000);

    // ── Assertion 5: zero profile_history rows ─────────────────────────────
    // Short-circuit returns BEFORE the upsert + before any history snapshot.
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(0);

    // ── Assertion 6: attachment row unchanged (Phase 38 D-23) ─────────────
    const attachmentAfter = await db.select().from(profileAttachment);
    expect(attachmentAfter[0]!.overallConfidence).toBe(0);
    expect(attachmentAfter[0]!.activated).toBe(false);

    // ── Assertion 7 (OQ-4 RECONCILIATION — Option A) ──────────────────────
    // Per RESEARCH §Open Questions #4: Phase 37/38 short-circuit returns
    // BEFORE the row upsert (runPsychologicalProfileGenerator Step 1 at
    // psychological-shared.ts:429-440). word_count_at_last_run is NOT
    // updated on the below-threshold path. PMT-03 D-17 spec was authored
    // before Phase 38 implementation was inspected. v2.6.1 follow-up may
    // add a "write word_count_at_last_run BEFORE short-circuit" code
    // path; if/when that ships, this assertion bumps to
    // `=== currentWordCount`.
    expect(
      hexacoAfter[0]!.wordCountAtLastRun,
      'OQ-4 (Option A held): Phase 37/38 short-circuit returns BEFORE upsert; word_count_at_last_run NOT updated on below-threshold path',
    ).toBe(0);
    expect(schwartzAfter[0]!.wordCountAtLastRun).toBe(0);
  });
});
