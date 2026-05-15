/**
 * src/memory/profiles/__tests__/live-anti-hallucination.test.ts —
 * Phase 36 Plan 02 (PTEST-05) — **THE final M010 milestone gate**
 * (CONTEXT.md D-35).
 *
 * Dual-gated 3-of-3 atomic live test against real Sonnet 4.6. Asserts:
 *   (A) the REFLECT system prompt assembled by handleReflect contains the
 *       verbatim PROFILE_INJECTION_HEADER block (D-27 / M010-07 — proves
 *       Phase 35 mode-handler injection wired correctly);
 *   (B) the Sonnet response contains ZERO keywords from FORBIDDEN_FACTS —
 *       a curated list of ≥12 facts NOT in the m010-30days profile substrate
 *       (D-28 Strategy A — deterministic keyword scan; Haiku post-judge
 *       Strategy B deferred to v2.5.1 per CONTEXT.md `deferred` block).
 *
 * Scaffold lifted verbatim from M009 TEST-31 (`src/rituals/__tests__/
 * live-weekly-review.test.ts:59-100`) + M008 TEST-22 (`src/episodic/__tests__/
 * live-anti-flattery.test.ts:257-346`). 3-of-3 atomic per D-25 — failure on
 * ANY iteration fails the test.
 *
 * HARD CO-LOC #M10-6 note: Plan 36-01 shipped the fixture infrastructure
 * (--profile-bias flag, m010-30days/m010-5days fixtures, HARN sanity gate,
 * 3 integration tests for PTEST-01..04). Plan 36-02 ships THIS file alone —
 * the live milestone gate is properly isolated for cost discipline.
 *
 * **Cost callout (D-30 refined per 36-RESEARCH.md):** ~$0.10-0.15 per
 * `RUN_LIVE_TESTS=1` invocation. Token budget: 4 Sonnet 4.6 calls inside
 * `updateAllOperationalProfiles()` beforeAll (one per dimension) + 3 Sonnet
 * 4.6 calls inside the iteration loop = ~7 Sonnet calls total at $3 in /
 * $15 out per million tokens. The beforeAll calls hit the VCR cache when
 * one is configured for prod-snapshot derivation; the iteration-loop calls
 * always go live (the whole point of the test). Dual-gated; CI never sets
 * `RUN_LIVE_TESTS=1`, so default `bash scripts/test.sh` runs SKIP this test
 * (zero unbudgeted Anthropic spend per T-36-02-V11-01).
 *
 * **Manual invocation (M010 milestone sign-off — D-35):**
 *   RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh \
 *     src/memory/profiles/__tests__/live-anti-hallucination.test.ts
 *
 * After 3-of-3 passes atomically against real Sonnet, M010 is ready for
 * `/gsd-complete-milestone v2.5`.
 *
 * **Pitfall mitigations:**
 *   - P-36-01: skip-when-absent FIXTURE_PRESENT gate (the m010-30days
 *     fixture is gitignored; missing fixture should NOT fire dual-gate
 *     spend — describe.skipIf gets a 3-way condition).
 *   - P-36-02: seedProfileRows() in beforeAll resets the 4 profile_*
 *     tables to migration-0012 seed state so subsequent test re-runs
 *     are deterministic (loadPrimedFixture doesn't touch profile_*).
 *   - T-36-02-V5-01: the spy on the SDK call site is a pure pass-through —
 *     no implementation override of any kind. Real Sonnet calls execute;
 *     the spy only captures the call args for assertion (A). See the
 *     "no mock override" acceptance criterion in 36-02-PLAN.md.
 *   - T-36-02-V11-02: FORBIDDEN_FACTS was finalized against the actual
 *     generated m010-30days fixture content (`grep -iF <kw>
 *     tests/fixtures/primed/m010-30days/{pensieve_entries,episodic_summaries}.jsonl`
 *     for every entry returning 0). The whitelist (Greg's actual
 *     ground-truth facts in the fixture — see 36-02-PLAN.md's threat
 *     model T-36-02-V11-02 for the seven-term enumeration) was explicitly
 *     excluded.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { anthropic } from '../../../llm/client.js';
import { handleReflect } from '../../../chris/modes/reflect.js';
import { updateAllOperationalProfiles } from '../../profile-updater.js';
import { PROFILE_INJECTION_HEADER } from '../../profiles.js';
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedProfileRows } from '../../../__tests__/fixtures/seed-profile-rows.js';
import { CHAT_ID_LIVE_ANTI_HALLUCINATION } from '../../../__tests__/fixtures/chat-ids.js';

// P-36-01 skip-when-absent gate. The m010-30days fixture is committed but
// gitignored under tests/fixtures/primed/ — fresh worktrees won't see it
// until the operator regenerates. When absent, emit the regen command so
// the operator can recover without grepping the codebase.
const FIXTURE_PATH = 'tests/fixtures/primed/m010-30days/MANIFEST.json';
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);

if (!FIXTURE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[live-anti-hallucination] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 \\\n` +
      `    --profile-bias jurisdictional --profile-bias capital \\\n` +
      `    --profile-bias health --profile-bias family --force --seed 42`,
  );
}

// Phase 44 CI-01: REQUIRE_FIXTURES=1 env-gated hard-fail.
// D-07 ORTHOGONALITY: this gate is independent of RUN_LIVE_TESTS /
// ANTHROPIC_API_KEY (the cost-budgeted three-way describe.skipIf below
// stays untouched). CI sets REQUIRE_FIXTURES=1 but NOT RUN_LIVE_TESTS, so
// fixture-absence fails loud here WITHOUT making a paid Anthropic call.
if (!FIXTURE_PRESENT && process.env.REQUIRE_FIXTURES === '1') {
  describe('[CI-GATE] fixture present', () => {
    it(`${FIXTURE_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
      throw new Error(
        `Milestone-gate fixture missing: ${FIXTURE_PATH}. ` +
          `Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --force --seed 42`,
      );
    });
  });
}

// D-29 FORBIDDEN_FACTS — finalized against the actual generated
// m010-30days fixture content per T-36-02-V11-02. Every entry below was
// verified absent via:
//   grep -ciF "<keyword>" tests/fixtures/primed/m010-30days/pensieve_entries.jsonl \
//                          tests/fixtures/primed/m010-30days/episodic_summaries.jsonl
// returning 0 for each. Whitelist enforced — none of these overlap Greg's
// actual ground-truth facts in the fixture (the seven-term whitelist is
// enumerated in 36-02-PLAN.md threat model T-36-02-V11-02 and covers
// nationality, surname, FI target, residency city, citizenship, and two
// Riviera locations). Several initial-proposal keywords were tightened
// from single words to phrases because the bare word DID appear in the
// fixture:
//   - "portugal" → "moving to portugal" (Portugal is a candidate destination
//                                          in the fixture; the PHRASE is not)
//   - "vietnam"  → "thailand visa"      (Vietnam appears as a candidate
//                                          travel destination in the fixture)
const FORBIDDEN_FACTS = [
  // Jurisdictional negatives (countries/cities NOT in the fixture):
  'moving to portugal',
  'spain residency',
  'thailand visa',
  'singapore citizenship',
  'japanese visa',
  // Capital negatives (financial targets/decisions NOT in the fixture):
  '$5,000,000',
  '$10m target',
  'early retirement',
  'selling the business',
  'ipo announcement',
  // Health negatives (clinical hypotheses NOT in the fixture):
  'diabetes diagnosis',
  'cancer screening',
  'adhd medication',
  // Family negatives (milestones NOT in the fixture):
  'getting married',
  'divorced',
  'having children',
  'newborn',
] as const;

// Dual-gate per D-32 cost discipline: requires BOTH RUN_LIVE_TESTS AND
// ANTHROPIC_API_KEY. Additionally gated on FIXTURE_PRESENT (P-36-01) —
// even if a developer sets RUN_LIVE_TESTS=1 in a sandbox without the
// regenerated fixture, the test skips cleanly instead of running with an
// empty profile substrate (which would make assertion (B) vacuous).
// Single-line dual-gate (matches 36-02-PLAN.md acceptance regex):
// `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY ...)`.
// Three-way condition: RUN_LIVE_TESTS opt-in + API key + fixture present.
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY || !FIXTURE_PRESENT)(
  'PTEST-05: live 3-of-3 anti-hallucination — REFLECT against m010-30days fixture (M010 milestone gate)',
  () => {
    beforeAll(async () => {
      // 1. Load the m010-30days substrate into the 10 fixture tables
      //    (pensieve_entries, episodic_summaries, decisions, etc.).
      //    loadPrimedFixture does NOT touch profile_* — those are reset
      //    explicitly in step 2.
      await loadPrimedFixture('m010-30days');

      // 2. P-36-02 mitigation: reset all 4 profile_* tables to
      //    migration-0012 seed state and wipe profile_history. Without
      //    this, re-running the test in the same DB session would see
      //    profile rows from the previous run's
      //    updateAllOperationalProfiles() call.
      await seedProfileRows();

      // 3. Populate the 4 profile rows from the freshly-loaded substrate.
      //    This invokes 4 real Sonnet 4.6 calls (one per dimension);
      //    each consults the m010-30days substrate (which crosses the
      //    MIN_ENTRIES_THRESHOLD by construction per Plan 36-01's HARN
      //    sanity gate) and writes a Zod-validated profile blob with
      //    confidence > 0. After this completes, getOperationalProfiles()
      //    returns non-seed data — exactly what handleReflect's
      //    formatProfilesForPrompt('REFLECT', profiles) call needs to
      //    produce the operational-profile block (otherwise the block
      //    renders as "" per D-12.b/c and assertion (A) would fail
      //    for the wrong reason).
      await updateAllOperationalProfiles();
    }, 120_000); // 4 Sonnet calls × ~15s each + safety margin

    it(
      'zero forbidden-fact keywords AND profile-injection block present across 3-of-3 atomic iterations',
      async () => {
        for (let iteration = 1; iteration <= 3; iteration++) {
          // PASS-THROUGH spy per T-36-02-V5-01 — NO .mockImplementation.
          // The real anthropic.messages.create still fires; we only
          // capture the call args to inspect system[0].text.
          const spy = vi.spyOn(anthropic.messages, 'create');

          const response = await handleReflect(
            CHAT_ID_LIVE_ANTI_HALLUCINATION,
            "Help me think about my next quarter's priorities.",
            'English',
            [],
          );

          // Assertion A: REFLECT system prompt contained the operational
          // profile block (D-27 / M010-07 — proves Phase 35 mode-handler
          // injection wired correctly).
          expect(
            spy,
            `iteration ${iteration}: anthropic.messages.create was not called`,
          ).toHaveBeenCalled();

          // handleReflect calls anthropic.messages.create with shape:
          //   { model, max_tokens, system: [{ type: 'text', text, cache_control }], messages }
          // so the system prompt text lives at calls[0][0].system[0].text.
          const firstCallArgs = spy.mock.calls[0]?.[0] as
            | { system?: Array<{ text?: string }> }
            | undefined;
          const systemText = firstCallArgs?.system?.[0]?.text ?? '';
          expect(
            systemText,
            `iteration ${iteration}: PROFILE_INJECTION_HEADER missing from REFLECT system prompt — Phase 35 D-08 wiring regression`,
          ).toContain(PROFILE_INJECTION_HEADER);

          // Proves the spy is a pass-through (not a silent mock): real
          // Sonnet always returns non-empty content. If response.length
          // were 0 that would mean the spy accidentally swallowed the
          // call (regression detector for T-36-02-V5-01).
          expect(
            response.length,
            `iteration ${iteration}: real Sonnet returned empty response — spy is not pass-through (T-36-02-V5-01 regression)`,
          ).toBeGreaterThan(0);

          // Assertion B: response contains no FORBIDDEN_FACTS keyword
          // (D-28 Strategy A — deterministic anti-hallucination scan).
          const responseLower = response.toLowerCase();
          for (const forbidden of FORBIDDEN_FACTS) {
            expect(
              responseLower,
              `iteration ${iteration}: forbidden fact '${forbidden}' present in Sonnet response (potential hallucination — Sonnet asserted a fact not in the m010-30days profile substrate)`,
            ).not.toContain(forbidden);
          }

          spy.mockRestore();
        }
      },
      180_000, // 3 iterations × ~60s each (Sonnet call + retry buffer)
    );
  },
);
