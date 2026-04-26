---
phase: 25-ritual-scheduling-foundation-process-gate
plan: 02
subsystem: rituals
tags: [ritual, zod, luxon, drizzle, concurrency, dst, tdd]

# Dependency graph
requires:
  - phase: 25-ritual-scheduling-foundation-process-gate
    plan: 01
    provides: rituals table + ritualCadenceEnum + RITUAL_RESPONSE epistemic_tag value (Wave 1 substrate)
  - phase: 21-episodic-consolidation-engine
    provides: src/episodic/sources.ts dayBoundaryUtc canonical Luxon idiom (mirror reference)
  - phase: 13-decision-archive-foundation
    provides: M007 D-28 optimistic-concurrency UPDATE...RETURNING precedent (src/decisions/lifecycle.ts)
provides:
  - RitualConfigSchema (Zod, 8 fields + schema_version, .strict())
  - RitualConfig type + parseRitualConfig helper
  - RitualFireOutcome 6-variant union + RitualFireResult interface scaffold
  - computeNextRunAt(now, cadence, config) — Luxon DST-safe wall-clock advancement for all 4 cadences
  - tryFireRitualAtomic(ritualId, lastObserved, newNextRunAt) — atomic ritual-fire concurrency primitive
  - Three TDD-built modules with 24 co-located tests proving all contracts
affects: [25-03, 26-*, 27-*, 28-*, 29-*]

# Tech tracking
tech-stack:
  added: []  # zero new deps; uses existing Luxon 3.7.2, Zod 4.x, drizzle-orm
  patterns:
    - "Strict Zod schema for jsonb config blobs (.strict() rejects unknown fields per RIT-07)"
    - "Luxon-only cadence math (DateTime.fromJSDate + setZone + plus({days/weeks/months}) + toUTC().toJSDate())"
    - "M007 D-28 optimistic-concurrency UPDATE...RETURNING with WHERE-guard predicate (mirrored for ritual fire)"
    - "Predicate construction split by null-observation case (load-bearing for SQL-level RIT-10 exactly-once)"
    - "DST property tests pinned at exact ISO timestamps that can ONLY be correct under wall-clock arithmetic"
    - "Pitfall 2/3 forbidden-pattern grep guard — docstring written abstractly so the regex itself does not appear in source"

key-files:
  created:
    - "src/rituals/types.ts"
    - "src/rituals/cadence.ts"
    - "src/rituals/idempotency.ts"
    - "src/rituals/__tests__/types.test.ts"
    - "src/rituals/__tests__/cadence.test.ts"
    - "src/rituals/__tests__/idempotency.test.ts"
    - ".planning/phases/25-ritual-scheduling-foundation-process-gate/25-02-SUMMARY.md"
  modified: []

key-decisions:
  - "tryFireRitualAtomic predicate split by null-observation case: lastObserved===null → isNull(lastRunAt) ONLY (not or(isNull, sql\\`true\\`)). The strict isNull branch is what makes the second concurrent UPDATE's WHERE re-evaluation FAIL after the first commits, giving the SQL-level exactly-once guarantee. The or(isNull, sql\\`true\\`) pattern from RESEARCH §6 would have accepted both UPDATEs because postgres re-evaluates the WHERE against the post-commit row state, and `true` is row-state-independent."
  - "Pitfall 2/3 grep guard scope: src/rituals/cadence.ts ONLY (NOT src/rituals/__tests__/). Tests legitimately need raw ms arithmetic for fixture timestamps; the guard exists to prevent ms arithmetic in the production cadence math, where DST safety lives. Plan author confirmed this scoping in Task 3 action notes."
  - "Cadence.ts docstring rewritten to describe forbidden patterns abstractly (\"manual UTC ms arithmetic\", \"JS Date wall-clock setters\") rather than naming them literally — otherwise the docstring honestly explaining what's forbidden would itself trigger the grep guard. Verification regex moved to plan reference, not source."
  - "Test cadence.ts docstring rewritten the same way (vi.useFakeTimers reference removed) to keep TESTING.md D-02 grep guard clean."

requirements-completed: [RIT-07, RIT-08, RIT-10]

# Metrics
duration: 49min
completed: 2026-04-26
---

# Phase 25 Plan 02: Pure-function helpers (RitualConfig Zod schema, Luxon DST-safe computeNextRunAt, atomic UPDATE…RETURNING idempotency helper) Summary

**Three pure-function modules under `src/rituals/` (types, cadence, idempotency) with 24 TDD-built tests proving Zod strict-mode rejection (RIT-07), DST-safe wall-clock cadence advancement across both 2026 Europe/Paris transitions (RIT-08), and SQL-level exactly-once ritual fire under concurrency (RIT-10).**

## Performance

- **Duration:** 49 min
- **Started:** 2026-04-26T15:35:28Z
- **Completed:** 2026-04-26T16:24:42Z
- **Tasks:** 3 (all TDD: RED → GREEN → no REFACTOR needed)
- **Files created:** 6 (3 source + 3 test)

## Accomplishments

- **RIT-07 — RitualConfigSchema:** Zod schema with 8 named fields (`fire_at`, `fire_dow`, `prompt_bag`, `skip_threshold`, `mute_until`, `time_zone`, `prompt_set_version`) + `schema_version: z.literal(1)` + `.strict()`. Rejects unknown fields with `Unrecognized key …` (proves the RIT-07 contract). Deliberately omits a `cadence` field per CONTEXT.md D-09 — cadence lives on `rituals.type` (the enum column), not in the jsonb config blob. 12 vitest cases cover happy path (full + minimal config, mute_until ISO, parseRitualConfig round-trip), strict-mode rejection (unknown fields, fire_at HH:mm regex, schema_version literal, fire_dow + skip_threshold bounds, prompt_bag length max 6), and the RitualFireOutcome 6-variant union + RitualFireResult interface scaffold for Phases 26-29 to extend.
- **RIT-08 — computeNextRunAt:** Pure-function `computeNextRunAt(now, cadence, config)` using Luxon's `DateTime.fromJSDate(...).setZone()` → `.startOf('day')` → `.set({hour, minute})` → `.plus({ days/weeks/months })` → `.toUTC().toJSDate()` chain. Handles all 4 cadences (daily/weekly/monthly/quarterly) per TS-10 forward-compat for M013. Anchored to wall-clock `config.fire_at`, NEVER to `last_run_at` — prevents Pitfall 3 cadence drift. 8 vitest cases including DST property tests pinned at **2026-03-29 spring-forward** (asserts exact ISO `'2026-03-29T19:00:00.000Z'` — only correct under wall-clock arithmetic) and **2026-10-25 fall-back** (asserts exact ISO `'2026-10-25T20:00:00.000Z'`). Pitfall 2/3 grep guard returns 0 — no `86_400_000`, no `setUTCHours`, no `setHours` in cadence.ts.
- **RIT-10 — tryFireRitualAtomic:** Atomic `UPDATE rituals SET last_run_at=now(), next_run_at=$NEW WHERE id=$ID AND <guard predicate> RETURNING *` mirroring M007 D-28 optimistic-concurrency precedent. Returns `{ fired: true, row }` on win or `{ fired: false }` on race-loss. 4 vitest cases against real Docker postgres (port 5433) including the **THE assertion**: `Promise.all` of two concurrent invocations against the same ritual ID produces EXACTLY 1 fired-row return (RIT-10 success criterion 3). Mock-based tests would not have caught this — only postgres row-level locking serializes the two updates correctly.
- **Substrate smoke gate from Wave 1 still green** (`6|1|3` table/enum/index assertion). All 24 rituals tests (12 types + 8 cadence + 4 idempotency) pass under `bash scripts/test.sh src/rituals/__tests__/`.
- **Plan 25-03 unblocked:** `runRitualSweep` orchestrator can now import `parseRitualConfig`, `RitualFireResult`, `computeNextRunAt`, and `tryFireRitualAtomic` without TypeScript errors.

## Task Commits

1. **Task 1: RitualConfig Zod schema + RitualFireResult scaffold (RIT-07)** — `153aa2d` (feat)
2. **Task 2: Luxon DST-safe computeNextRunAt cadence helper (RIT-08)** — `c7763bf` (feat)
3. **Task 3: atomic UPDATE...RETURNING ritual-fire idempotency (RIT-10)** — `2c7a60d` (feat)

**Plan metadata commit:** to be added by the final commit (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md).

## Files Created/Modified

- `src/rituals/types.ts` (NEW, 105 lines) — RitualConfigSchema (Zod, 8 fields + schema_version, .strict()), RitualConfig type, parseRitualConfig helper, RitualFireOutcome union, RitualFireResult interface. Box-drawing dividers per CONVENTIONS.md (file just over 100 lines threshold).
- `src/rituals/cadence.ts` (NEW, 109 lines) — Pure computeNextRunAt(now, cadence, config) using Luxon exclusively. Switch on cadence handles all 4 enum values. Box-drawing divider for cadence-advancement section.
- `src/rituals/idempotency.ts` (NEW, 99 lines) — tryFireRitualAtomic with explicitly-constructed guard predicate (split by null-observation case for the load-bearing concurrency contract). Box-drawing divider for the primitive section.
- `src/rituals/__tests__/types.test.ts` (NEW, 144 lines) — 12 vitest cases: 4 happy-path + 6 strict-rejection + 2 fire-outcome scaffold.
- `src/rituals/__tests__/cadence.test.ts` (NEW, 124 lines) — 8 vitest cases: 2 daily + 2 DST + 4 weekly/monthly/quarterly.
- `src/rituals/__tests__/idempotency.test.ts` (NEW, 119 lines) — 4 vitest cases against real Docker postgres including the RIT-10 concurrency assertion.

## Decisions Made

- **D-25-02-A: tryFireRitualAtomic null-observation predicate is `isNull(rituals.lastRunAt)` ONLY, not `or(isNull, sql\`true\`)`.** RESEARCH §6 + the plan's Step B both showed an `or(isNull(lastRunAt), lastObserved ? lt(...) : sql\`true\`)` pattern. Trying that pattern verbatim during Task 3 implementation revealed a bug in concurrent execution: when two UPDATEs both pass `lastObserved=null`, postgres row-level locking serializes them — but the second UPDATE's WHERE re-evaluation against the post-commit row state STILL passes because `sql\`true\`` is row-state-independent. Result: both UPDATEs would succeed, breaking the RIT-10 exactly-once contract. Fix: when `lastObserved===null`, the predicate is the strict `isNull(lastRunAt)` branch. After the first UPDATE commits, lastRunAt is no longer null, so the second's WHERE FAILS at re-evaluation. The non-null `lastObserved` case retains the `or(isNull, lt)` shape so an operator-reset (lastRunAt deliberately set back to null) does not block a sweep tick.
- **D-25-02-B: Forbidden-pattern grep guards (Pitfall 2/3 + TESTING.md D-02) are scoped to source files only, NOT docstrings.** First attempt at cadence.ts had a thorough docstring naming the forbidden patterns by literal name (`86_400_000`, `setUTCHours`, etc.) to educate future readers about what to avoid. The grep guard regex matched those literal mentions, returning a non-zero count that violated the plan's strict acceptance criterion (`MUST return 0`). Fix: rewrite the docstring to describe the forbidden patterns abstractly (\"manual UTC ms arithmetic\", \"JS Date wall-clock setters\") and move the literal verification regex to the plan reference, not the source file. Same fix applied to cadence.test.ts for `vi.useFakeTimers`. Trade-off: slightly less self-documenting source, but the grep guard semantics are preserved (the guard exists to catch ACCIDENTAL use of forbidden patterns, not to prevent honest documentation about what's forbidden — but a strict regex cannot tell the difference).
- **D-25-02-C: Pitfall 2/3 grep guard is scoped to `src/rituals/cadence.ts` only, NOT the whole `src/rituals/` tree.** The plan's Step A note for Task 3 explicitly clarified this: tests legitimately need raw ms arithmetic for fixture timestamps (e.g. `new Date(Date.now() + 24 * 60 * 60 * 1000)` or the equivalent literal). The guard exists for the production cadence math where DST safety lives. The scoping is correct as written; documenting here so future maintainers don't widen the guard reflexively.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan-prescribed `or(isNull, sql\`true\`)` predicate would have failed the RIT-10 exactly-once contract under concurrency**
- **Found during:** Task 3 (Author atomic UPDATE...RETURNING idempotency helper) — discovered while reasoning through how postgres row-level locking interacts with WHERE re-evaluation post-commit, before running the concurrency test.
- **Issue:** RESEARCH.md §6 (lines 1187-1278) and the plan's Step B both prescribed:
  ```ts
  or(isNull(rituals.lastRunAt), lastObserved ? lt(rituals.lastRunAt, lastObserved) : sql`true`)
  ```
  Tracing through the concurrent-call semantics: two parallel `tryFireRitualAtomic(rid, null, future)` calls both evaluate the WHERE predicate. The first acquires the row lock, runs the UPDATE, commits. The second blocks on the row lock. After the first commits, postgres re-evaluates the second's WHERE against the post-commit row state (this is the standard postgres serializable-read-committed semantics). The post-commit row has `lastRunAt = first.now`, but the predicate `or(isNull(lastRunAt), sql\`true\`)` STILL evaluates to true because the right OR-arm is row-state-independent. Both UPDATEs would succeed → RIT-10 success criterion 3 (`firedCount === 1`) would FAIL.
- **Fix:** Restructure the predicate construction so the null-observation case is `isNull(rituals.lastRunAt)` ONLY (no fallback to `sql\`true\``). The non-null case keeps the `or(isNull, lt)` shape. Comment in idempotency.ts explains the load-bearing nature of the split.
- **Files modified:** `src/rituals/idempotency.ts` (initial draft was per plan; revised before commit).
- **Verification:** Concurrency test (`Promise.all` of two parallel invocations) returns `firedCount === 1` consistently across multiple runs of `bash scripts/test.sh src/rituals/__tests__/idempotency.test.ts`. Verified empirically that the RESEARCH-prescribed predicate fails this test (would have committed a broken implementation if I had typed it verbatim and not reasoned through).
- **Committed in:** `2c7a60d` (the corrected version is what landed; no earlier broken commit exists).

**2. [Rule 1 - Bug] Honest docstrings naming forbidden patterns triggered the Pitfall 2/3 grep guard**
- **Found during:** Task 2 verification (running `grep -E '86_?400_?000|setUTCHours|setHours' src/rituals/cadence.ts | wc -l` after first commit attempt).
- **Issue:** First-pass cadence.ts docstring contained 6 literal mentions of forbidden patterns (`86_400_000`, `setUTCHours`, `setHours`) in lines 9, 10, 14, 39, 40, 41 — explaining to future readers what's forbidden and why. The plan's strict acceptance criterion `MUST return 0` did not anticipate honest documentation that mentions forbidden patterns by name. Same issue applied to cadence.test.ts (`vi.useFakeTimers` docstring mention triggered TESTING.md D-02 guard).
- **Fix:** Rewrite both docstrings to describe forbidden patterns abstractly (\"manual UTC ms arithmetic\", \"JS Date wall-clock setters\", \"fake-timer mocks\") rather than literally. Verification regex now lives in 25-02-PLAN.md (and this SUMMARY) so the source files do not self-trigger their own guards.
- **Files modified:** `src/rituals/cadence.ts`, `src/rituals/__tests__/cadence.test.ts`.
- **Verification:** `grep -E '86_?400_?000|setUTCHours|setHours' src/rituals/cadence.ts | wc -l` returns 0; `grep -c 'vi.useFakeTimers' src/rituals/__tests__/cadence.test.ts` returns 0.
- **Committed in:** `c7763bf` (corrected docstrings landed in the same commit; no earlier broken commit exists, but the bug class is documented here for future plan authors).

**3. [Rule 3 - Blocking] Stale Docker postgres from prior session held migration state, causing first `bash scripts/test.sh` to fail at migration 0001 (`type \"contradiction_status\" already exists`)**
- **Found during:** First attempt to run `bash scripts/test.sh src/rituals/__tests__/` after Task 3 completion.
- **Issue:** The Wave 1 plan noted this exact follow-up: docker-compose.local.yml + the regen-snapshots.sh override file collision means the test container can sometimes start without the expected fresh tmpfs. In this session, the Docker postgres container was already up from earlier work (smoke testing) and held the post-Wave-1 migration state. test.sh's first migration (`CREATE TYPE contradiction_status`) failed because the type already existed.
- **Fix:** Operational workaround per Wave 1 SUMMARY's Deviation 3 — `docker compose -f docker-compose.local.yml down --timeout 5` before re-running `bash scripts/test.sh`. The script's normal start-up creates a fresh container with tmpfs, applies all migrations cleanly.
- **Files modified:** None (operational workaround, identical to Wave 1's documented follow-up). The underlying docker-compose port-replace bug from Wave 1 SUMMARY remains as a known follow-up; not in scope for Plan 25-02.
- **Verification:** After `down`, the next `bash scripts/test.sh src/rituals/__tests__/` exited 0 with `6|1|3` substrate gate green and 24/24 ritual tests passing.
- **Committed in:** N/A (no code change; documented here for traceability and Wave 3 awareness).

---

**Total deviations:** 3 auto-fixed (2× Rule 1 - Bug, 1× Rule 3 - Blocking).
**Impact on plan:** Deviation 1 was the most consequential — committing the RESEARCH-prescribed predicate verbatim would have shipped a broken concurrency primitive that masked itself as working under most test conditions but failed the load-bearing RIT-10 exactly-once assertion. Deviation 2 unblocked Task 2's grep-guard acceptance criterion. Deviation 3 was an operational workaround for a Wave 1-known docker-compose limitation. Net plan scope unchanged; all 3 requirements (RIT-07, RIT-08, RIT-10) verifiably satisfied.

## Issues Encountered

- **Full project test suite (`bash scripts/test.sh` with no args) shows 7 failed test files / 57 failed tests out of 88 / 1192.** All visible failures trace to the well-known `EACCES /home/claude/chris/node_modules/@huggingface/transformers/.cache` env-level issue documented in `.planning/codebase/TESTING.md` and `.planning/STATE.md` (vitest-4 fork-IPC hang under HuggingFace EACCES). This is a pre-existing baseline from before Wave 2; my changes (3 new test files, all passing) do not introduce new failures. The plan's success criterion 2 specifically requires `idempotency.test.ts` to be green under `bash scripts/test.sh` — that requirement is met (verified by the scoped run `bash scripts/test.sh src/rituals/__tests__/` exiting 0 with all 24 tests green).
- **Cadence weekly test design choice:** Test 2 of weekly cadence (\"advances to NEXT week if today is the configured weekday but past slot\") was added beyond the plan's 7 specified behaviors to cover the `|| 7` branch in the daysToAdd formula. Without it, the implementation could have used `((targetDow - target.weekday + 7) % 7)` (no `|| 7`) and silently returned today's slot+0days when called the same Sunday, which would race with the daily-cadence \"advance to tomorrow\" logic above it. The extra test pins down the contract.

## User Setup Required

None — no external service configuration required. All tests run against the Docker postgres harness already in place.

## Next Phase Readiness

- **Plan 25-03** (`runRitualSweep` orchestrator + cron registration + manual-sweep script) is unblocked. The four imports it needs are all exported with stable signatures:
  - `parseRitualConfig` from `./types.js`
  - `RitualFireResult` (and `RitualFireOutcome`) from `./types.js`
  - `computeNextRunAt(now, cadence, config)` from `./cadence.js`
  - `tryFireRitualAtomic(ritualId, lastObserved, newNextRunAt)` from `./idempotency.js`
- **Phases 26-29** depend on the same exports plus the Wave 1 substrate; they are not blocked by Plan 25-02.
- **No blockers** for Plan 25-03 or downstream work.

## TDD Gate Compliance

This plan's frontmatter `type: execute` does not declare top-level TDD, but each of the 3 tasks declared `tdd=\"true\"` and followed RED → GREEN → (no REFACTOR needed) per the executor's TDD execution flow. Gate sequence verified:

- **Task 1 RED:** `npx vitest run src/rituals/__tests__/types.test.ts` failed with `Cannot find module '../types.js'` (proven 2026-04-26 ~15:36).
- **Task 1 GREEN:** Same command passed 12/12 tests after types.ts authored.
- **Task 2 RED:** `npx vitest run src/rituals/__tests__/cadence.test.ts` failed with `Cannot find module '../cadence.js'` (proven 2026-04-26 ~15:37).
- **Task 2 GREEN:** Same command passed 8/8 tests after cadence.ts authored.
- **Task 3 RED:** Equivalent failed import for `../idempotency.js` (proven 2026-04-26 ~15:40).
- **Task 3 GREEN:** Same command + Docker postgres passed 4/4 tests including the RIT-10 concurrency assertion.

No REFACTOR commits were needed — the green-phase implementations were already minimal and clear (no duplication, no dead code, conventional naming).

Each task's RED + GREEN pair was committed as a single `feat(...)` per the project's commit convention, since the TDD gate sequence is established in this SUMMARY rather than in commit history (matches existing project patterns where test + implementation co-land in single commits).

## Threat Surface Scan

Reviewed all 6 created files against the threat model in 25-02-PLAN.md:

- **T-25-02-01 (.strict() regression guard):** Verified clean — `grep -c '\\.passthrough()' src/rituals/types.ts` returns 0.
- **T-25-02-02 (computeNextRunAt with malicious config):** Accepted per plan; `time_zone: z.string().min(1)` validates non-empty but does not validate IANA-correctness. Documented as accept-risk (single-user system, operator-supplied config).
- **T-25-02-03 (TOCTOU on tryFireRitualAtomic):** Mitigated by the SQL `WHERE id=$ID AND <guard predicate> RETURNING *` row-lock-serialized pattern. Concurrency test (Task 3 Test 2) is the regression test — proven green.
- **T-25-02-04 (mute_until ISO timestamps as info disclosure):** Accepted per plan; single-user system.

**No new threat surface introduced beyond the 4 threats already enumerated in the plan.** No new auth boundaries, no new network endpoints, no new LLM calls, no new user-input-flowing-through paths. The 3 modules are pure-function helpers + 1 atomic SQL primitive.

---

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: `src/rituals/types.ts` (105 lines)
- FOUND: `src/rituals/cadence.ts` (109 lines)
- FOUND: `src/rituals/idempotency.ts` (99 lines)
- FOUND: `src/rituals/__tests__/types.test.ts` (144 lines)
- FOUND: `src/rituals/__tests__/cadence.test.ts` (124 lines)
- FOUND: `src/rituals/__tests__/idempotency.test.ts` (119 lines)
- FOUND: `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-02-SUMMARY.md` (this file)

**Commits verified in git log:**
- FOUND: `153aa2d` feat(25-02): add RitualConfig Zod schema + RitualFireResult scaffold (RIT-07)
- FOUND: `c7763bf` feat(25-02): add Luxon DST-safe computeNextRunAt cadence helper (RIT-08)
- FOUND: `2c7a60d` feat(25-02): add atomic UPDATE...RETURNING ritual-fire idempotency (RIT-10)

**Acceptance gates verified live:**
- FOUND: `npx vitest run src/rituals/__tests__/types.test.ts src/rituals/__tests__/cadence.test.ts` exits 0 in <1s with 20 tests green
- FOUND: `bash scripts/test.sh src/rituals/__tests__/` exits 0 with substrate `6|1|3` smoke gate green and 24 ritual tests green (12 types + 8 cadence + 4 idempotency)
- FOUND: `grep -E '86_?400_?000|setUTCHours|setHours' src/rituals/cadence.ts | wc -l` returns 0 (Pitfall 2/3 guard)
- FOUND: `grep -c '\\.passthrough()' src/rituals/types.ts` returns 0 (T-25-02-01 strict-mode regression guard)
- FOUND: `grep -c 'vi.useFakeTimers' src/rituals/__tests__/cadence.test.ts` returns 0 (TESTING.md D-02 guard)
- FOUND: All 8 expected exports present (`RitualConfigSchema`, `RitualConfig`, `parseRitualConfig`, `RitualFireOutcome`, `RitualFireResult`, `computeNextRunAt`, `TryFireResult`, `tryFireRitualAtomic`)

---
*Phase: 25-ritual-scheduling-foundation-process-gate*
*Plan: 02*
*Completed: 2026-04-26*
