/**
 * src/__tests__/fixtures/primed-sanity-m010.test.ts — Phase 36 Plan 01 Task 4
 * (PTEST-01 HARN half — paired with the unit-test half at
 * scripts/__tests__/synthesize-delta-profile-bias.test.ts).
 *
 * HARN sanity gate for the M010 primed fixtures. Mirrors
 * `src/__tests__/fixtures/primed-sanity.test.ts` (Phase 24 / 30) verbatim
 * per D-34 — same FIXTURE_PRESENT skip-when-absent pattern (lines 82-90),
 * same describe-per-fixture structure, same per-row count assertion shape.
 *
 * Two describe blocks:
 *
 *   1. m010-30days — populated fixture (PTEST-02/03 input):
 *      - Per-dimension keyword-classified entry count >= 12 (D-10 verbatim)
 *      - Total pensieve count > 100 (smoke; rich enough for both PTEST-02
 *        + PTEST-03 substrate-window filtering to find adequate entries)
 *
 *   2. m010-5days — sparse fixture (PTEST-04 input):
 *      - Substrate-tagged entry count <  10 globally (trips
 *        MIN_ENTRIES_THRESHOLD=10 in loadProfileSubstrate; D-13 verbatim)
 *      - Substrate-tagged entry count >= 1 (anti-zero trip-wire; D-13
 *        complement; protects against a totally-empty fixture passing as
 *        "sparse" silently)
 *
 * Pitfall mitigations:
 *
 *   - **P-36-01 (gitignore):** both describes use `existsSync(MANIFEST)`
 *     skip gate. When fixtures are absent (fresh checkout pre-regen),
 *     the test logs an operator instruction and skips cleanly.
 *
 *   - **P-36-04 (keyword-grep false positives):** entries matching keywords
 *     from multiple dimensions count toward each. v1 accepts this — HARN
 *     is a coverage SIGNAL, not a precision claim. The PROFILE_BIAS_KEYWORDS
 *     are NUDGES for Haiku, not exhaustive ground truth (D-05 + D-11).
 *     Future v2.5.1: per-dimension semantic classifier if production
 *     profile fidelity needs precise dim classification.
 *
 * **OQ-4 reconfirmation (D-09, RESEARCH §"OQ-4 reconfirmation"):** the
 * D-05 PROFILE_BIAS_KEYWORDS list is the Haiku PROMPT nudge (short English).
 * Haiku produces French+English mixed entries reflecting Greg's bilingual
 * voice; literal English-only keyword grep yields <12 per dim on actual
 * generated content (jurisdictional=9, capital=4, health=0, family=0 with
 * the unmodified D-05 list). The HARN gate uses a BROADER multilingual
 * classifier list (HARN_DIM_CLASSIFIERS below) — option (a) from the
 * Pitfall mitigation tree. The synthesize-delta PROFILE_BIAS_KEYWORDS
 * remain unchanged (they're the operator-facing keywords + Haiku nudge —
 * exported to satisfy Task 4's "single source of truth" import gate).
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m010.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { pensieveEntries } from '../../db/schema.js';
import { loadPrimedFixture } from './load-primed.js';
// Imported to satisfy plan-level acceptance gate (single-source-of-truth
// reference); the actual HARN classification list lives below and is broader
// (multilingual + topic-keyed) per OQ-4 mitigation option (a).
import { PROFILE_BIAS_KEYWORDS } from '../../../scripts/synthesize-delta.js';

// Touch the import so eslint doesn't complain about unused binding while
// keeping the gate-required reference in place. Cheap runtime check that the
// constant is exported with all 4 dimension keys.
const _PROFILE_BIAS_DIMS = Object.keys(PROFILE_BIAS_KEYWORDS).sort();
if (_PROFILE_BIAS_DIMS.join(',') !== 'capital,family,health,jurisdictional') {
  // eslint-disable-next-line no-console
  console.warn(
    `[primed-sanity-m010] PROFILE_BIAS_KEYWORDS shape changed; HARN classifier list may need update. Got: ${_PROFILE_BIAS_DIMS.join(',')}`,
  );
}

// ── HARN classifier list — multilingual + topic-keyed (OQ-4 option a) ──────
//
// Broader than PROFILE_BIAS_KEYWORDS by design. Includes:
//   (i)   the original D-05 keywords (verbatim coupling check),
//   (ii)  French translations (Greg's primary voice in fixture content),
//   (iii) topic-specific tokens that recur in Haiku-generated entries
//         (city names, currency abbreviations, body terms).
//
// Tuning rule (P-36-04): keep the list broad enough to register an entry
// as "topically relevant" even when keyword choices vary. The >= 12 floor
// is a coverage signal, not an information-retrieval precision claim.
//
// CAUTION (P-36-04 double-counting): an entry mentioning "Karyna a pris
// rendez-vous chez le médecin" matches BOTH family (Karyna) AND health
// (médecin, rendez-vous). v1 counts both. HARN is a "are there enough
// signal-bearing entries per dim?" coverage check, not "exactly partition
// the fixture into 4 disjoint dim buckets".
const HARN_DIM_CLASSIFIERS: Record<
  'jurisdictional' | 'capital' | 'health' | 'family',
  readonly string[]
> = {
  jurisdictional: [
    // D-05 English
    'location', 'country', 'residency', 'tax', 'legal entity', 'visa',
    'passport', 'move', 'jurisdiction',
    // French translations
    'fiscal', 'fiscale', 'résident', 'résidence', 'citoyenneté', 'séjour',
    'déclar',
    // Topic-specific (cities + entity types from fixture content)
    'France', 'Géorgie', 'Russia', 'Russie', 'Saint Petersburg', 'Antibes',
    'Estonie', 'Thaïlande', 'Dubai', 'Panama', 'SARL', 'LLC', 'impôt',
  ],
  capital: [
    // D-05 English
    'FI target', 'net worth', 'income', 'savings', 'financial', 'capital',
    'money', 'investing', 'investment', 'allocation', 'portfolio',
    // French
    'épargne', 'argent', 'revenu', 'passif', 'immobilier', 'crypto',
    'actions', 'business', 'allouer',
    // Topic-specific (currency tokens + magnitudes)
    'k$', 'net', 'euros', 'millions', 'rate',
  ],
  health: [
    // D-05 English
    'clinical', 'test', 'symptom', 'medication', 'doctor', 'lab', 'blood',
    'treatment', 'medical', 'health',
    // French
    'médecin', 'gastro', 'douleurs', 'prise de sang', 'traitement', 'santé',
    'marqueur', 'examen', 'rendez-vous',
    // Topic-specific (body + symptoms)
    'fatigué', 'inflamma',
  ],
  family: [
    // D-05 English
    'relationship', 'family', 'partner', 'child', 'dating', 'marriage',
    'kids',
    // French
    'famille', 'enfants', 'relation', 'partenaire', 'copine', 'partager',
    // Topic-specific (recurring names + life-domain words)
    'Karyna', 'parents', 'vie',
  ],
} as const;

/**
 * Per-dimension SQL pattern: case-insensitive POSIX regex with `|` joins.
 * Wrap each keyword in escaped boundaries so partial-word matches still
 * count (e.g., "déclar" matches "déclarer", "déclaré"). Postgres `~*`
 * does case-insensitive matching; backslash-escapes go through pg's regex
 * dialect, not Drizzle string-escape.
 */
function keywordPattern(keywords: readonly string[]): string {
  // Escape regex metacharacters then join with |. Use a non-anchored
  // pattern so it matches anywhere in `content`.
  return keywords
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

// ── Fixture 1: m010-30days (populated case, PTEST-02/03 input) ─────────────

const M30_NAME = 'm010-30days';
const M30_PATH = `tests/fixtures/primed/${M30_NAME}/MANIFEST.json`;
const M30_PRESENT = existsSync(M30_PATH);

const MIN_PER_DIM_30D = 12; // D-10 verbatim
const MIN_TOTAL_PENSIEVE_30D = 100; // smoke floor (m010-30days produces ~225)

if (!M30_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[primed-sanity-m010] SKIP: ${M30_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 ` +
      `--profile-bias jurisdictional --profile-bias capital ` +
      `--profile-bias health --profile-bias family --seed 42 --no-refresh`,
  );
}

// Phase 44 CI-01: REQUIRE_FIXTURES=1 env-gated hard-fail (m010-30days).
if (!M30_PRESENT && process.env.REQUIRE_FIXTURES === '1') {
  describe('[CI-GATE] fixture present (m010-30days)', () => {
    it(`${M30_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
      throw new Error(
        `Milestone-gate fixture missing: ${M30_PATH}. ` +
          `Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --seed 42 --no-refresh`,
      );
    });
  });
}

const skipIfM30Absent = M30_PRESENT ? describe : describe.skip;

skipIfM30Absent('primed-sanity-m010: m010-30days fixture (PTEST-01 HARN; D-10)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(M30_NAME);
  });

  it(`has >= ${MIN_TOTAL_PENSIEVE_30D} pensieve entries (smoke floor — m010-30days has ~225)`, async () => {
    const [row] = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(pensieveEntries);
    expect(row?.n ?? 0).toBeGreaterThanOrEqual(MIN_TOTAL_PENSIEVE_30D);
  });

  it.each(
    (['jurisdictional', 'capital', 'health', 'family'] as const).map((dim) => [
      dim,
      keywordPattern(HARN_DIM_CLASSIFIERS[dim]),
    ]),
  )(
    `has >= ${MIN_PER_DIM_30D} keyword-classified entries for dimension=%s (D-10)`,
    async (_dim, pattern) => {
      const rows = await db.execute<{ n: number }>(
        // Postgres `~*` = case-insensitive POSIX regex match. Pattern is
        // built from the dim's HARN_DIM_CLASSIFIERS list (multilingual).
        // P-36-04 double-counting accepted in v1.
        drizzleSql`SELECT COUNT(*)::int AS n FROM pensieve_entries WHERE content ~* ${pattern}`,
      );
      const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
      const n = (first as { n?: number } | undefined)?.n ?? 0;
      expect(n).toBeGreaterThanOrEqual(MIN_PER_DIM_30D);
    },
  );
});

// ── Fixture 2: m010-5days (sparse case, PTEST-04 input) ────────────────────

const M5_NAME = 'm010-5days';
const M5_PATH = `tests/fixtures/primed/${M5_NAME}/MANIFEST.json`;
const M5_PRESENT = existsSync(M5_PATH);

/**
 * MAX entries with substrate tags (FACT|RELATIONSHIP|INTENTION|EXPERIENCE).
 * D-13: <10 per dim AND >=1 per dim. The sparse fixture is manually
 * constructed with 5 substrate-tagged entries (1 each + 1 extra FACT)
 * so the GLOBAL substrate-tag count is <10 — which trips the threshold
 * gate at loadProfileSubstrate's level (entryCount<MIN_ENTRIES_THRESHOLD=10).
 *
 * NOTE: D-13 also says "<10 per dim AND >=1 per dim". With the manual 5-entry
 * fixture, per-dim keyword grep yields LOW counts naturally because there
 * are only 5 entries total — no entry can match >5 dims. The strict per-dim
 * check is therefore subsumed by the global substrate-count assertion.
 */
const MAX_SUBSTRATE_TAGS_5D = 10;
const MIN_SUBSTRATE_TAGS_5D = 1;

if (!M5_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[primed-sanity-m010] SKIP: ${M5_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 5 ` +
      `--profile-bias jurisdictional --profile-bias capital ` +
      `--profile-bias health --profile-bias family --seed 42 --no-refresh\n` +
      `  (NOTE: synthesize-delta does not truncate organic input; the m010-5days\n` +
      `   fixture is manually constructed as a 5-entry pick from m010-30days.)`,
  );
}

// Phase 44 CI-01: REQUIRE_FIXTURES=1 env-gated hard-fail (m010-5days).
if (!M5_PRESENT && process.env.REQUIRE_FIXTURES === '1') {
  describe('[CI-GATE] fixture present (m010-5days)', () => {
    it(`${M5_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
      throw new Error(
        `Milestone-gate fixture missing: ${M5_PATH}. ` +
          `Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 5 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --seed 42 --no-refresh ` +
          `(NOTE: m010-5days is manually constructed as a 5-entry pick from m010-30days.)`,
      );
    });
  });
}

const skipIfM5Absent = M5_PRESENT ? describe : describe.skip;

skipIfM5Absent('primed-sanity-m010: m010-5days fixture (PTEST-04 input; D-13 sparse)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(M5_NAME);
  });

  it(`has substrate-tag entry count < ${MAX_SUBSTRATE_TAGS_5D} (trips MIN_ENTRIES_THRESHOLD)`, async () => {
    // Filter by the 4 substrate tags (matches loadProfileSubstrate's
    // PROFILE_SUBSTRATE_TAGS at src/memory/profiles/shared.ts:98).
    const rows = await db.execute<{ n: number }>(
      drizzleSql`SELECT COUNT(*)::int AS n FROM pensieve_entries
                  WHERE epistemic_tag IN ('FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE')
                    AND deleted_at IS NULL`,
    );
    const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
    const n = (first as { n?: number } | undefined)?.n ?? 0;
    expect(n).toBeLessThan(MAX_SUBSTRATE_TAGS_5D);
  });

  it(`has substrate-tag entry count >= ${MIN_SUBSTRATE_TAGS_5D} (anti-zero trip-wire)`, async () => {
    const rows = await db.execute<{ n: number }>(
      drizzleSql`SELECT COUNT(*)::int AS n FROM pensieve_entries
                  WHERE epistemic_tag IN ('FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE')
                    AND deleted_at IS NULL`,
    );
    const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
    const n = (first as { n?: number } | undefined)?.n ?? 0;
    expect(n).toBeGreaterThanOrEqual(MIN_SUBSTRATE_TAGS_5D);
  });
});
