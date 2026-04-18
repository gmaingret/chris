---
phase: 14-capture-flow
plan: 01
subsystem: database, testing
tags: [drizzle, postgres, migration, haiku, vitest, i18n]

# Dependency graph
requires:
  - phase: 13-schema-lifecycle-primitives
    provides: decisions, decision_events, decision_capture_state tables; transitionDecision chokepoint; decisionCaptureStageEnum; DECISION epistemic tag
provides:
  - decision_trigger_suppressions table + migration 0004 applied by the Docker test harness
  - STAKES_CLASSIFICATION_PROMPT / CAPTURE_EXTRACTION_PROMPT / VAGUE_VALIDATOR_PROMPT / RESOLVE_BY_PARSER_PROMPT Haiku prompt constants
  - EN/FR/RU trigger-phrase fixture with |EN|==|FR|==|RU|==4 parity (D-03) + abort-phrase sets (D-04)
  - Six RED test scaffolds covering CAP-01/02/03/04/05/06, LIFE-05, SWEEP-03
affects: [14-02-triggers, 14-03-suppressions, 14-04-capture, 14-05-engine-capture, 15-deadline-sweep]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Drizzle-kit-generated migration wired into scripts/test.sh via MIGRATION_N_SQL psql block"
    - "Shared i18n fixture as single source of truth for EN/FR/RU parity (|EN|==|FR|==|RU|==4 enforced by triggers.test.ts)"
    - "Haiku prompts end with 'Respond with valid JSON only. No prose, no code fences.' sentinel line"
    - "Wave-0 RED scaffolds importing yet-to-exist modules — @ts-expect-error on the module import + real assertions inside"

key-files:
  created:
    - src/db/migrations/0004_decision_trigger_suppressions.sql
    - src/db/migrations/meta/0004_snapshot.json
    - src/decisions/triggers-fixtures.ts
    - src/decisions/__tests__/triggers.test.ts
    - src/decisions/__tests__/capture.test.ts
    - src/decisions/__tests__/vague-validator.test.ts
    - src/decisions/__tests__/resolve-by.test.ts
    - src/decisions/__tests__/suppressions.test.ts
    - src/decisions/__tests__/engine-capture.test.ts
  modified:
    - src/db/schema.ts
    - src/db/migrations/meta/_journal.json
    - scripts/test.sh
    - src/llm/prompts.ts

key-decisions:
  - "Cleaned drizzle-kit drift re-assertion (sequence_no DEFAULT) out of 0004 so the migration contains only the new table + index. The sequence_no default was already set correctly by migration 0002's handwritten bigserial — re-emitting it would be noise."
  - "Kept the six scaffold tests RED via missing-module imports rather than stub implementations — guarantees Wave 1 creates the target modules before any green signal, and the failure reason is unambiguous ('Cannot find module')."

patterns-established:
  - "Wave 0 RED scaffolds: import from yet-to-exist module via @ts-expect-error; write real assertions; tests fail with 'Cannot find module' until Wave 1 lands implementation"
  - "Haiku prompt naming: <CAPABILITY>_<ROLE>_PROMPT (STAKES_CLASSIFICATION_PROMPT, RESOLVE_BY_PARSER_PROMPT, …); all prompts end with JSON-only sentinel"
  - "Per-chat substring suppression table with unique (chat_id, phrase) constraint; caller normalizes trim+lowercase before insert"

requirements-completed: [CAP-01, CAP-06]

# Metrics
duration: ~20min
completed: 2026-04-15
---

# Phase 14 Plan 01: Wave 0 Foundation Summary

**Decision-trigger-suppression schema + migration 0004 wired into Docker test harness, four Phase-14 Haiku prompt constants, EN/FR/RU trigger fixture with enforced |N|=|N|=|N|=4 parity, and six RED test scaffolds ready for Waves 1–2 to turn GREEN.**

## Performance

- **Duration:** ~20 min (wall clock)
- **Started:** 2026-04-15T19:34Z
- **Completed:** 2026-04-15T19:54Z
- **Tasks:** 3 (all committed atomically)
- **Files modified/created:** 12

## Accomplishments

- Migration 0004 creates `decision_trigger_suppressions` with `(chat_id, phrase) UNIQUE` + `chat_id` btree index; drizzle-kit-generated, applied in order 0000→0004 by `scripts/test.sh` against Docker Postgres.
- Schema `decisionTriggerSuppressions` shipped alongside a clean migration (the stray drizzle-kit `ALTER … DEFAULT nextval` drift was removed to keep the file to actual new DDL).
- Four Haiku prompt constants added to `src/llm/prompts.ts` — each ends with the verbatim sentinel `Respond with valid JSON only. No prose, no code fences.` for parseability.
- `src/decisions/triggers-fixtures.ts` — the load-bearing EN/FR/RU parity fixture (4 positives each) plus negative meta-guards and D-04 abort-phrase sets. Research A2's parity resolution (extend FR+RU with "je dois choisir entre" / "мне нужно выбрать между") implemented verbatim.
- Six Wave-0 RED test scaffolds created with full Docker-Postgres harness (beforeAll DB probe, afterEach table truncation covering decisions/decision_events/decision_capture_state/decision_trigger_suppressions/pensieve_entries).

## Task Commits

1. **Task 1: schema + migration 0004 + scripts/test.sh** — `98829ee` (feat)
2. **Task 2: Haiku prompt constants + triggers fixture** — `131490e` (feat)
3. **Task 3: six RED test scaffolds** — `4e595f2` (test)

## Files Created/Modified

- `src/db/schema.ts` — appended `decisionTriggerSuppressions` table
- `src/db/migrations/0004_decision_trigger_suppressions.sql` — new, clean DDL (CREATE TABLE + CREATE INDEX only)
- `src/db/migrations/meta/_journal.json` — added idx=4 entry
- `src/db/migrations/meta/0004_snapshot.json` — drizzle-kit snapshot
- `scripts/test.sh` — added `MIGRATION_4_SQL=...` declaration + psql apply block (mirrors `MIGRATION_3_SQL` shape)
- `src/llm/prompts.ts` — appended `STAKES_CLASSIFICATION_PROMPT`, `CAPTURE_EXTRACTION_PROMPT`, `VAGUE_VALIDATOR_PROMPT`, `RESOLVE_BY_PARSER_PROMPT`
- `src/decisions/triggers-fixtures.ts` — new: EN/FR/RU positives+negatives + abort phrases
- `src/decisions/__tests__/triggers.test.ts` — new: 10 tests (parity, per-language positives/negatives, classifyStakes fail-closed)
- `src/decisions/__tests__/capture.test.ts` — new: 7 tests (greedy extraction, 3-turn cap placeholders, chokepoint routing, language lock, abort, LIFE-05 contradiction once)
- `src/decisions/__tests__/vague-validator.test.ts` — new: 4 tests (accept/vague, one-pass, second-vague → open-draft)
- `src/decisions/__tests__/resolve-by.test.ts` — new: 4 tests (ISO happy path, null→clarifier, +30d pick, silent default announce)
- `src/decisions/__tests__/suppressions.test.ts` — new: 5 tests (persistence, case-insensitive match, per-chat scope, idempotent adds, survives restart)
- `src/decisions/__tests__/engine-capture.test.ts` — new: 5 tests (PP#0 precedence, PP#1 opens on structural, re-trigger ignored, suppressed skips stakes, trivial falls through)

## Decisions Made

- **Removed drizzle-kit drift from 0004:** drizzle-kit emitted an `ALTER TABLE "decision_events" ALTER COLUMN "sequence_no" SET DEFAULT nextval(...)` line that re-asserts a default migration 0002's handwritten `bigserial` already sets correctly. Kept the migration focused on genuinely new DDL (CREATE TABLE + UNIQUE + INDEX). Documented here so future drizzle-kit regenerations don't re-introduce the noise unexpectedly.
- **Scaffold tests RED via "Cannot find module":** chose this pattern (import from yet-to-exist `../triggers.js`, `../capture.js`, etc. with `@ts-expect-error`) over creating empty stubs that throw, because the failure reason becomes completely unambiguous — Wave 1's job is to create the missing module, not to fix assertion bugs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed drizzle-kit auto-emitted ALTER default drift from migration 0004**

- **Found during:** Task 1 (migration generation)
- **Issue:** `npx drizzle-kit generate` included a stray `ALTER TABLE "decision_events" ALTER COLUMN "sequence_no" SET DEFAULT nextval('decision_events_sequence_no_seq'::regclass)` line that re-asserts the default migration 0002's handwritten `bigserial` already set. This would clutter the migration and risk confusion about what 0004 is actually doing.
- **Fix:** Deleted the stray ALTER line from `src/db/migrations/0004_decision_trigger_suppressions.sql` so the migration contains only genuinely new DDL (CREATE TABLE + UNIQUE constraint + CREATE INDEX).
- **Files modified:** `src/db/migrations/0004_decision_trigger_suppressions.sql`
- **Verification:** Full `scripts/test.sh` applies all 5 migrations in order against Docker Postgres with no errors (NOTICE about existing PSYCHOLOGY enum label is from migration 0001, expected).
- **Committed in:** `98829ee` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cosmetic / hygiene; no behavioral change vs. the plan's intent. No scope creep.

## Issues Encountered

- **Pre-existing live-integration test failures (out of scope):** `npm test` surfaces failures in `src/chris/__tests__/contradiction-false-positive.test.ts` (20 tests), `src/llm/__tests__/models-smoke.test.ts` (3 tests), and one test in `src/chris/__tests__/language.test.ts`. Root cause: `scripts/test.sh` defaults `ANTHROPIC_API_KEY` to the literal string `"test-key"`, so `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` evaluates false → tests fire real Anthropic API calls → 401 invalid-key → timeouts. These failures are independent of Phase 14 Plan 01 — pre-existed on `main` before this plan started — and are logged to `deferred-items.md` per scope-boundary discipline. Phase-13 schema/lifecycle/regenerate/concurrency/capture-state/chokepoint-audit tests remain GREEN against migration 0000→0004 (`bash scripts/test.sh src/decisions/__tests__/schema.test.ts` → 9/9 passed; other Phase-13 suites likewise pass).

## Known RED Tests (by design)

The six newly-created test files are intentionally RED and MUST stay RED until their respective Wave 1/2 plans land the target modules:

| Test File | Missing Module | Plan that turns it GREEN |
|-----------|----------------|--------------------------|
| `triggers.test.ts` | `src/decisions/triggers.ts` | 14-02 |
| `capture.test.ts` | `src/decisions/capture.ts` | 14-04 |
| `vague-validator.test.ts` | `src/decisions/vague-validator.ts` | 14-04 |
| `resolve-by.test.ts` | `src/decisions/resolve-by.ts` | 14-04 |
| `suppressions.test.ts` | `src/decisions/suppressions.ts` | 14-03 |
| `engine-capture.test.ts` | PP#0/PP#1 wiring in `src/chris/engine.ts` | 14-05 |

Downstream: do NOT treat these six files as broken. Failure mode is literally `Cannot find module` — no assertion failures, no syntax errors.

## Next Phase Readiness

- Schema, fixture, and prompts are ready for Wave 1 plans (14-02 triggers, 14-03 suppressions, 14-04 capture/vague-validator/resolve-by) to run in parallel — zero file overlap by design.
- Wave 2 (14-05 engine-capture) has its RED harness pre-staged.
- No blockers. `npm test` boots Docker Postgres with migration 0004 applied.

## Self-Check: PASSED

Verified files exist:
- `src/db/migrations/0004_decision_trigger_suppressions.sql` ✓
- `src/db/migrations/meta/0004_snapshot.json` ✓
- `src/decisions/triggers-fixtures.ts` ✓
- 6 test scaffolds in `src/decisions/__tests__/` ✓

Verified commits exist (git log):
- `98829ee` ✓ (Task 1)
- `131490e` ✓ (Task 2)
- `4e595f2` ✓ (Task 3)

---
*Phase: 14-capture-flow*
*Completed: 2026-04-15*
