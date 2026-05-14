/**
 * src/__tests__/fixtures/primed-sanity-m011.test.ts — Phase 40 Plan 01
 * Task 4 (PMT-01 HARN half — paired with the unit-test half at
 * scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts;
 * PMT-02 presence verification).
 *
 * HARN sanity gate for the M011 primed fixtures. Mirrors
 * `src/__tests__/fixtures/primed-sanity-m010.test.ts` verbatim per D-33 —
 * same FIXTURE_PRESENT skip-when-absent pattern, same describe-per-fixture
 * structure, same single-source-of-truth bias-constants import.
 *
 * Two independent describe blocks:
 *
 *   1. m011-30days — populated fixture (PMT-04/PMT-05 input):
 *      - Total telegram-source pensieve wordCount > 5000 (D-06 verbatim;
 *        substrate floor — D-10 target ~6,000)
 *      - >=1 OPENNESS_SIGNAL_PHRASES phrase present (D-06 verbatim;
 *        Pitfall §7 / Pitfall 10 LOAD-BEARING signal-retention gate —
 *        Haiku style-transfer can average toward Greg's habitual register
 *        and erase the designed signature; this gate fails LOUD before
 *        the integration tests run)
 *
 *   2. m011-1000words — sparse fixture (PMT-03 input):
 *      - Total telegram-source pensieve wordCount < 5000 (D-13 verbatim;
 *        below floor by design)
 *      - wordCount >= 1 (D-13 verbatim; anti-zero trip-wire — protects
 *        against a totally-empty fixture passing as "sparse" silently)
 *
 * Pitfall mitigations:
 *
 *   - **P-36-01 (gitignore):** both describes use `existsSync(MANIFEST)`
 *     skip gate. When fixtures are absent (sandbox / fresh checkout
 *     pre-regen), the test logs an operator instruction and skips
 *     cleanly.
 *
 *   - **Pitfall §7 / Pitfall 10 PITFALLS.md (synthetic signal erasure)
 *     LOAD-BEARING:** the OPENNESS_SIGNAL_PHRASES presence assertion is
 *     the FAIL-LOUD gate against Haiku averaging away the designed
 *     signature. Without it, PMT-04 would fail not because the inference
 *     engine is broken but because the fixture lacks signal — the
 *     diagnostic loop would be much longer. The HARN gate inverts that:
 *     fixture-quality failures show up here, before the integration
 *     tests run.
 *
 *   - **Single source of truth for bias constants:** PSYCH_PROFILE_BIAS_KEYWORDS
 *     and OPENNESS_SIGNAL_PHRASES are imported from
 *     `scripts/synthesize-delta.ts` (NOT duplicated). RESEARCH Open Q1
 *     reconciliation — constants live in the synthesis pipeline; tests
 *     import from there.
 *
 * **Operator regeneration** (D-09, D-12):
 *   npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 \
 *     --psych-profile-bias --force --seed 42
 *   npx tsx scripts/regenerate-primed.ts --milestone m011-1000words --target-days 5 \
 *     --psych-profile-bias --force --seed 42
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m011.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { loadPrimedFixture } from './load-primed.js';
import {
  PSYCH_PROFILE_BIAS_KEYWORDS,
  OPENNESS_SIGNAL_PHRASES,
} from '../../../scripts/synthesize-delta.js';

// ── Lint trip-wire — PSYCH_PROFILE_BIAS_KEYWORDS shape sanity ──────────────
//
// If the upstream constant shrinks (refactor accidentally trimmed a trait
// category), signal density degrades for fixture generation; emit a warning.
// Soft signal — not a hard fail. The hard signal is the OPENNESS_SIGNAL_PHRASES
// retention check below.
if (PSYCH_PROFILE_BIAS_KEYWORDS.length < 10) {
  // eslint-disable-next-line no-console
  console.warn(
    `[primed-sanity-m011] PSYCH_PROFILE_BIAS_KEYWORDS shrank to ${PSYCH_PROFILE_BIAS_KEYWORDS.length}; signal density may degrade — re-check D-05 6-trait coverage`,
  );
}

// ── Word-count SQL — telegram-source only (Phase 37 substrate filter) ──────
//
// Phase 37 PSCH-07 substrate filters `source='telegram' AND deleted_at IS NULL`;
// non-telegram entries don't count toward the wordCount gate. Match that
// shape exactly here so the HARN check operates on the same population the
// substrate loader will see.
async function totalTelegramWordCount(): Promise<number> {
  const rows = await db.execute<{ word_count: number }>(
    drizzleSql`
      SELECT COALESCE(SUM(array_length(regexp_split_to_array(content, E'\\s+'), 1)), 0)::int AS word_count
      FROM pensieve_entries
      WHERE source = 'telegram' AND deleted_at IS NULL
    `,
  );
  // Drizzle returns Array-like with .rows on some drivers, plain rows array on others
  const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
  return (first as { word_count?: number } | undefined)?.word_count ?? 0;
}

async function concatTelegramContent(): Promise<string> {
  const rows = await db.execute<{ all_content: string }>(
    drizzleSql`
      SELECT COALESCE(string_agg(content, E'\\n'), '') AS all_content
      FROM pensieve_entries
      WHERE source = 'telegram' AND deleted_at IS NULL
    `,
  );
  const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
  return (first as { all_content?: string } | undefined)?.all_content ?? '';
}

// ── Fixture 1: m011-30days (populated case, PMT-04/PMT-05 input) ───────────

const M30_NAME = 'm011-30days';
const M30_PATH = `tests/fixtures/primed/${M30_NAME}/MANIFEST.json`;
const M30_PRESENT = existsSync(M30_PATH);

const MIN_WORDS_30D = 5000; // D-06 verbatim — substrate floor
const MIN_SIGNAL_PHRASES_30D = 1; // D-06 verbatim — Pitfall §7 retention gate

if (!M30_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[primed-sanity-m011] SKIP: ${M30_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 ` +
      `--psych-profile-bias --force --seed 42`,
  );
}

const skipIfM30Absent = M30_PRESENT ? describe : describe.skip;

skipIfM30Absent('primed-sanity-m011: m011-30days fixture (PMT-01 HARN; D-06)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(M30_NAME);
  });

  it(`has total telegram-source pensieve wordCount > ${MIN_WORDS_30D} (D-06 substrate floor)`, async () => {
    const wordCount = await totalTelegramWordCount();
    expect(wordCount).toBeGreaterThan(MIN_WORDS_30D);
  });

  it(`has >= ${MIN_SIGNAL_PHRASES_30D} OPENNESS_SIGNAL_PHRASES phrase present (D-06 Pitfall §7 / Pitfall 10 LOAD-BEARING — Haiku averaging guard)`, async () => {
    const allContent = (await concatTelegramContent()).toLowerCase();
    const presentPhrases = OPENNESS_SIGNAL_PHRASES.filter((p) =>
      allContent.includes(p.toLowerCase()),
    );
    // Custom error message cites Pitfall §7 / Pitfall 10 + recommends regen.
    const errMsg =
      `Pitfall §7 / Pitfall 10 PITFALLS.md (Haiku style-transfer signal erasure): ` +
      `0/${OPENNESS_SIGNAL_PHRASES.length} OPENNESS_SIGNAL_PHRASES retained in synthesized content. ` +
      `Haiku averaged away the designed signature. Recommended actions: ` +
      `(1) inspect tests/fixtures/primed/m011-30days/pensieve_entries.jsonl content; ` +
      `(2) tune PSYCH_PROFILE_BIAS_KEYWORDS in scripts/synthesize-delta.ts to add more explicit Openness phrases; ` +
      `(3) re-run with --force --reseed-vcr.`;
    expect(presentPhrases.length, errMsg).toBeGreaterThanOrEqual(MIN_SIGNAL_PHRASES_30D);
  });
});

// ── Fixture 2: m011-1000words (sparse case, PMT-03 input) ──────────────────

const M1K_NAME = 'm011-1000words';
const M1K_PATH = `tests/fixtures/primed/${M1K_NAME}/MANIFEST.json`;
const M1K_PRESENT = existsSync(M1K_PATH);

const MAX_WORDS_1K = 5000; // D-13 verbatim — below floor by design
const MIN_WORDS_1K = 1; // D-13 verbatim — anti-zero trip-wire

if (!M1K_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[primed-sanity-m011] SKIP: ${M1K_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m011-1000words --target-days 5 ` +
      `--psych-profile-bias --force --seed 42`,
  );
}

const skipIfM1KAbsent = M1K_PRESENT ? describe : describe.skip;

skipIfM1KAbsent('primed-sanity-m011: m011-1000words fixture (PMT-03 input; D-13 sparse)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(M1K_NAME);
  });

  it(`has total telegram-source pensieve wordCount < ${MAX_WORDS_1K} (D-13 — sparse, below substrate floor)`, async () => {
    const wordCount = await totalTelegramWordCount();
    expect(wordCount).toBeLessThan(MAX_WORDS_1K);
  });

  it(`has total telegram-source pensieve wordCount >= ${MIN_WORDS_1K} (D-13 anti-zero trip-wire)`, async () => {
    const wordCount = await totalTelegramWordCount();
    expect(wordCount).toBeGreaterThanOrEqual(MIN_WORDS_1K);
  });
});
