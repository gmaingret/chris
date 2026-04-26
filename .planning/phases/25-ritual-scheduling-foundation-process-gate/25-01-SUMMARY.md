---
phase: 25-ritual-scheduling-foundation-process-gate
plan: 01
subsystem: database
tags: [migration, drizzle, postgres, schema, ritual, wellbeing, partial-index, smoke-gate]

# Dependency graph
requires:
  - phase: 20-episodic-consolidation-data-layer
    provides: episodic_summaries CHECK-constraint pattern + EPI-02 day-one index discipline
  - phase: 13-decision-archive-foundation
    provides: MD-02 idempotency-guard pattern (DO blocks, IF NOT EXISTS, ADD VALUE IF NOT EXISTS) + decision_events.references() snapshot precedent
  - phase: 19-tech-debt-snapshot-lineage
    provides: scripts/regen-snapshots.sh clean-slate iterative-replay machinery (TECH-DEBT-19-01 fix)
provides:
  - migration 0006_rituals_wellbeing.sql (6 tables + RITUAL_RESPONSE enum + 5 FKs + 3 indexes)
  - drizzle-kit meta snapshot 0006_snapshot.json + journal entry (lineage 0..6 intact)
  - scripts/regen-snapshots.sh extended for 7-migration acceptance gate
  - scripts/test.sh post-migration substrate smoke gate (6|1|3 assertion)
  - 6 Drizzle pgTable bridges in src/db/schema.ts (rituals, wellbeingSnapshots, ritualResponses, ritualFireEvents, ritualConfigEvents, ritualPendingResponses)
  - ritualCadenceEnum (daily|weekly|monthly|quarterly)
  - epistemicTagEnum extended to 14 values (RITUAL_RESPONSE added)
  - first use of partial-index `.where(sql\`...\`)` in this codebase
affects: [25-02, 25-03, 26-*, 27-*, 28-*, 29-*]

# Tech tracking
tech-stack:
  added: []  # No new deps; uses existing drizzle-kit, drizzle-orm, postgres pgvector image
  patterns:
    - "Hand-authored SQL + drizzle-kit-generated meta snapshot hybrid (D-08 path for ALTER TYPE migrations)"
    - "Partial index via Drizzle 0.45 `.where(sql\\`...\\`)` API (FIRST USE in codebase)"
    - "Post-migration psql substrate smoke gate (6|1|3 assertion in scripts/test.sh)"
    - "HARD CO-LOCATION CONSTRAINT #7: SQL + meta snapshot + test.sh smoke line ship as ONE atomic plan"

key-files:
  created:
    - "src/db/migrations/0006_rituals_wellbeing.sql"
    - "src/db/migrations/meta/0006_snapshot.json"
    - ".planning/phases/25-ritual-scheduling-foundation-process-gate/25-01-SUMMARY.md"
  modified:
    - "src/db/schema.ts"
    - "src/db/migrations/meta/_journal.json"
    - "src/db/migrations/meta/0001_snapshot.json (regen-snapshots.sh side-effect)"
    - "src/db/migrations/meta/0002_snapshot.json (re-chain prevId)"
    - "src/db/migrations/meta/0003_snapshot.json (regen-snapshots.sh side-effect)"
    - "src/db/migrations/meta/0004_snapshot.json (re-chain prevId)"
    - "scripts/regen-snapshots.sh"
    - "scripts/test.sh"

key-decisions:
  - "Hand-author 0006 SQL with MD-02 idempotency guards (DO blocks, IF NOT EXISTS, ADD VALUE IF NOT EXISTS); use drizzle-kit-generated meta snapshot as source of truth for lineage — net DB shape matches"
  - "Add `.references()` to schema.ts ritual tables (5 FKs) so drizzle-kit's snapshot tracks the FK constraints — aligns with decision_events.decisionId precedent (Task 1 plan instruction text was incorrect about precedent; codebase reality wins)"
  - "Switch regen-snapshots.sh introspect helper from `yes '' | npx drizzle-kit introspect` to `npx drizzle-kit introspect </dev/null` — under bash pipefail the `yes` writer SIGPIPEs (141) once drizzle-kit's stdin closes, causing spurious failure"
  - "Smoke gate runs BEFORE `npx vitest run` in scripts/test.sh — substrate failure aborts the whole test suite (catches lineage breakage early)"

patterns-established:
  - "Pattern 25P-01: Partial index via Drizzle `.where(sql\\`${table.col} = value\\`)` — first codebase use; mirror for future filtered indexes"
  - "Pattern 25P-02: Hand-authored migration with idempotency guards + drizzle-kit-generated snapshot — apply when schema.ts can't express the SQL precisely (e.g., ALTER TYPE ADD VALUE IF NOT EXISTS, DO-block exception handlers)"
  - "Pattern 25P-03: Post-migration substrate smoke gate (`6|1|3` style) inside scripts/test.sh — run BEFORE vitest to short-circuit on lineage breakage"

requirements-completed: [RIT-01, RIT-02, RIT-03, RIT-04, RIT-05, RIT-06]

# Metrics
duration: 23min
completed: 2026-04-26
---

# Phase 25 Plan 01: Migration 0006 + drizzle meta-snapshot + scripts/test.sh psql smoke gate Summary

**6 ritual/wellbeing tables + RITUAL_RESPONSE epistemic_tag value + drizzle meta lineage 0..6 + 6|1|3 substrate smoke gate — landed as ONE atomic plan per HARD CO-LOCATION CONSTRAINT #7.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-04-26T15:18:00Z
- **Completed:** 2026-04-26T15:41:00Z
- **Tasks:** 3 (1 deviated, see below)
- **Files modified:** 10 (2 created + 8 modified)

## Accomplishments

- Migration `0006_rituals_wellbeing.sql` lands 6 new tables (rituals, wellbeing_snapshots, ritual_responses, ritual_fire_events, ritual_config_events, ritual_pending_responses), the `ritual_cadence` enum, the `RITUAL_RESPONSE` epistemic_tag value (14th), 5 FK constraints, 3 indexes (including a partial index `WHERE enabled=true` — first in codebase), and 4 CHECK constraints (energy/mood/anxiety BETWEEN 1 AND 5 + episodic_importance carry-forward).
- `src/db/schema.ts` mirrors the migration via 6 Drizzle pgTable declarations, the new ritualCadenceEnum, the 14-value epistemicTagEnum, and the first use of `.where(sql\`...\`)` partial-index API. `npx drizzle-kit generate` reports "No schema changes" (zero-diff equivalence verified).
- `scripts/regen-snapshots.sh` extended end-to-end (option b per RESEARCH §2) to handle migrations 0005 + 0006 in the acceptance-gate apply sequence; lineage 0000→0006 chain verified intact across the regenerated meta snapshots.
- `scripts/test.sh` extended with migration 0006 apply + post-migration psql smoke gate (`6|1|3` assertion) — substrate failure aborts the test suite BEFORE vitest runs, catching lineage breakage early.
- HARD CO-LOCATION CONSTRAINT #7 satisfied: all three legs (SQL migration, meta snapshot, test.sh smoke line) shipped in this single plan across 4 commits, no splitting.

## Task Commits

1. **Task 1: Author migration 0006 + extend schema.ts** — `dc5fd34` (feat)
2. **Task 1 deviation: align FKs with codebase precedent** — `9f883af` (fix; Rule 1 — see Deviations)
3. **Task 2: Extend regen-snapshots.sh + regenerate meta lineage** — `2aa96e2` (feat)
4. **Task 3: scripts/test.sh migration 0006 apply + smoke gate** — `889da4c` (feat) [BLOCKING gate green]

**Plan metadata:** to be added by final commit (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md)

## Files Created/Modified

- `src/db/migrations/0006_rituals_wellbeing.sql` (NEW, 107 lines) — Hand-authored DDL: 1 enum DO-block, 1 ALTER TYPE ADD VALUE IF NOT EXISTS, 6 CREATE TABLE IF NOT EXISTS, 5 FK DO-blocks, 3 CREATE INDEX IF NOT EXISTS (1 partial). MD-02 idempotency guards throughout per CONTEXT.md D-08.
- `src/db/migrations/meta/0006_snapshot.json` (NEW, 1822 lines) — drizzle-kit-generated snapshot with prevId chaining from 0005.id. Contains 19 tables (12 prior + 6 ritual + episodic_summaries), 6 enums (5 prior + ritual_cadence), 5 ritual FKs, 3 ritual indexes, 4 ritual CHECK constraints.
- `src/db/migrations/meta/_journal.json` (modified) — extended from 6 → 7 entries; new entry idx=6 / tag="0006_rituals_wellbeing".
- `src/db/migrations/meta/{0001,0002,0003,0004}_snapshot.json` (modified) — regen-snapshots.sh side-effect: 0001/0003 get fresh UUIDs each run, 0002/0004 re-chained to point at them. Standard Plan 20-01 deviation pattern.
- `src/db/schema.ts` (modified) — Added `smallint, boolean` imports; appended `RITUAL_RESPONSE` to epistemicTagEnum; added `ritualCadenceEnum`; added 6 pgTable declarations under "Rituals (M009 Phase 25)" box-drawing divider; first use of `.where(sql\`...\`)` partial-index API.
- `scripts/regen-snapshots.sh` (modified) — Added MIGRATION_5/MIGRATION_6 constants; renamed REGEN_PRODUCED_0005→REGEN_PRODUCED_0006; cleanup trap targets 0006/0007 acceptance-check artifacts; acceptance-gate apply sequence extended to 0..6; introspect helper switched from pipe to redirect to avoid SIGPIPE under pipefail.
- `scripts/test.sh` (modified) — New MIGRATION_6_SQL constant + apply line; new substrate smoke-gate block (psql multi-SELECT counting tables/enum/indexes, asserting `6|1|3`, exiting 1 on mismatch BEFORE vitest).

## Decisions Made

- **D-25-01-A: Hand-author SQL + drizzle-generated snapshot hybrid.** Per CONTEXT.md D-08: drizzle-kit cannot auto-generate `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (only `ALTER TYPE ... ADD VALUE` without the guard) or `CREATE TABLE IF NOT EXISTS`. The hand-written SQL has all idempotency guards; the drizzle-kit-generated meta snapshot is the source of truth for lineage. The two are byte-stable in their net DB shape — guards are SQL-syntax only.
- **D-25-01-B: FKs declared via `.references()` in schema.ts AND DO-block in SQL.** The plan instruction text said "Do NOT generate FKs in schema.ts via references()" claiming a decision_events precedent — but inspection of schema.ts:257 and meta/0002_snapshot.json confirmed decision_events DOES use `.references()` AND has the FK in the snapshot. Aligning with codebase precedent is critical for snapshot/schema consistency (otherwise drizzle-kit generate would want to recreate the FKs every run).
- **D-25-01-C: Smoke gate placement before vitest.** The 6|1|3 substrate assertion runs BEFORE `npx vitest run` so a substrate failure exits 1 immediately, blocking the whole test suite. This catches lineage mismatches early rather than producing false-positive type-checked tests against an incomplete DB.
- **D-25-01-D: regen-snapshots.sh option (b) — full end-to-end clean-slate replay.** Per RESEARCH §2: more defensive than option (a) appending. The script now applies 0..6 in a single fresh-DB sequence and verifies "No schema changes" globally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan instruction contradicted codebase precedent on FK declaration**
- **Found during:** Task 1 (Author migration 0006 + extend schema.ts) — discovered immediately after first `drizzle-kit generate` produced 0 FKs in the snapshot.
- **Issue:** Plan said "Do NOT generate FKs in schema.ts via `references()`. Instead, declare bare uuid columns and let the FKs live in SQL only. (This matches how `decision_events.decision_id` references `decisions.id` in 0002 without schema.ts using `references()`.)" Inspection of `src/db/schema.ts:257` showed `decisionId: uuid('decision_id').notNull().references(() => decisions.id),` — the precedent USES `.references()`. And `meta/0002_snapshot.json` has the FK constraint listed under `decision_events.foreignKeys`. Following the plan's instruction would have caused drizzle-kit's snapshot to omit the 5 ritual FKs, leading to perpetual `drizzle-kit generate` diff churn (it would want to add the FKs every run).
- **Fix:** Added `.references(() => rituals.id)` (4 calls) and `.references(() => pensieveEntries.id)` (1 call) to the ritual table column declarations in schema.ts. Hand-written SQL retains the DO-block FK constraints (the actual SQL the migration applies); the drizzle snapshot now correctly tracks all 5 FKs.
- **Files modified:** `src/db/schema.ts`, `src/db/migrations/0006_rituals_wellbeing.sql` (drizzle-aligned formatting).
- **Verification:** `drizzle-kit generate` now reports "No schema changes" (snapshot ↔ schema.ts equivalence verified). FK count in snapshot = 5 (matching SQL).
- **Committed in:** `9f883af` (fix(25-01): add FK references() to ritual schema.ts + drizzle-aligned 0006 SQL).

**2. [Rule 1 - Bug] regen-snapshots.sh introspect helper SIGPIPE under pipefail**
- **Found during:** Task 2 (running `bash scripts/regen-snapshots.sh` for the first time).
- **Issue:** The script ran `yes '' 2>/dev/null | npx drizzle-kit introspect >&2 2>&1` to provide empty stdin to drizzle-kit. Under bash `set -o pipefail`, when drizzle-kit exits 0 successfully, the `yes` writer gets SIGPIPE (141) on the next write attempt, and pipefail propagates 141 as the pipeline exit code. Result: introspect succeeded but the script reported `❌ drizzle-kit introspect failed with exit 141`. Pre-existing latent bug; my run hit it because drizzle-kit's stdin handling closed sooner than the previous version.
- **Fix:** Switched to `npx drizzle-kit introspect >&2 2>&1 </dev/null` — empty-stdin redirect achieves the same goal without the SIGPIPE failure mode. Inline comment documents the rationale for future maintainers.
- **Files modified:** `scripts/regen-snapshots.sh`.
- **Verification:** `bash scripts/regen-snapshots.sh` exits 0 with `✓ Snapshot regeneration acceptance gate: No schema changes`.
- **Committed in:** `2aa96e2` (feat(25-01): extend regen-snapshots.sh + meta-snapshot lineage 0..6).

**3. [Rule 3 - Blocking] Docker port 5433 collision between test postgres and regen postgres**
- **Found during:** Task 2 (first attempt to run regen-snapshots.sh).
- **Issue:** docker-compose.local.yml hardcodes `ports: - "5433:5432"`. The regen script's override file adds `"5434:5432"`, but Docker Compose APPENDS port specs from override files (doesn't replace), so the regen container tries to bind both 5433 and 5434. Since the test postgres was already running on 5433, the regen container failed to start.
- **Fix:** Stopped the test postgres container (`docker compose -f docker-compose.local.yml down`) before running regen-snapshots.sh. The script's own cleanup tears down its container at end; the test postgres can be restarted by the next `bash scripts/test.sh` invocation.
- **Files modified:** None (operational workaround, not a code change). Future improvement: make the override file's port spec REPLACE the base spec via a dedicated `compose-override-replace.yml`, not append. Out of scope for Plan 25-01; logged for follow-up.
- **Verification:** Regen script ran to completion after stopping test postgres.
- **Committed in:** N/A (no code changes; documented here for traceability).

---

**Total deviations:** 3 auto-fixed (2× Rule 1 - Bug, 1× Rule 3 - Blocking)
**Impact on plan:** All auto-fixes required for correctness. Deviation 1 was the most consequential — without it, every future `drizzle-kit generate` would have produced a non-empty diff, breaking the regen-snapshots.sh acceptance gate and silently degrading the lineage discipline this plan exists to establish. Deviation 2 unblocked Task 2's verification gate. Deviation 3 was an operational workaround for a pre-existing docker-compose limitation. Net plan scope unchanged; HARD CO-LOCATION CONSTRAINT #7 honored.

## Issues Encountered

- **Acceptance criterion grep mismatches.** Two of Task 1's strict greps don't match the codebase-aligned output:
  - `grep -c "WHERE \"enabled\" = true"` expects 1; actual SQL produces `WHERE "rituals"."enabled" = true` (drizzle qualifies the column). Functionally equivalent; the acceptance criterion was overly literal vs. drizzle-kit's actual output shape.
  - `grep -c '^--> statement-breakpoint$'` expects ≥14; actual file has 6 standalone markers + 9 inline trailing markers = 15 markers total (one per statement). The codebase analog (0002_decision_archive.sql) follows the same mostly-inline pattern (3 standalone + 6 inline = 9 markers). Functionally correct (every statement separated); acceptance criterion was overly literal.
  - Both deltas accepted — matching codebase convention is more important than satisfying overly-strict literal grep counts. Documented here for plan-author feedback.

## User Setup Required

None — no external service configuration required. Migration applies via raw psql in Docker; smoke gate runs in the same Docker container.

## Next Phase Readiness

- **Plans 25-02 and 25-03** (scheduler + cron-registration + manual-sweep tests/code) are unblocked: ritual tables exist, RITUAL_RESPONSE enum value exists, pgTable bridges in schema.ts are importable.
- **Phases 26-29** (PP#5 detector, callback_query handler, sweep extension, manual ops) all depend on this substrate — all can proceed with imports from `src/db/schema.ts`.
- **No blockers** for downstream work.
- **Open follow-up (out of scope for 25-01):** docker-compose override-port-replace pattern (vs. append) — only matters if operators routinely run regen-snapshots.sh while test postgres is up.

## TDD Gate Compliance

Not a TDD plan (`type: execute`, no `tdd="true"` tasks). No RED/GREEN/REFACTOR sequence required.

## Threat Surface Scan

No NEW security-relevant surface beyond the threat_model captured in `25-01-PLAN.md`. The 6 new tables are pure schema substrate; no auth boundaries, no network endpoints, no LLM calls, no user input flowing through the migration. Threats T-25-01-01 through T-25-01-05 (in plan) all hold; no new flags. Phase 27 owns the wellbeing-snapshot access boundary (single-user constraint, callback_query authorization).

---

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: `src/db/migrations/0006_rituals_wellbeing.sql`
- FOUND: `src/db/migrations/meta/0006_snapshot.json`
- FOUND: `src/db/schema.ts` (modified, 493 lines)
- FOUND: `scripts/regen-snapshots.sh` (modified)
- FOUND: `scripts/test.sh` (modified)
- FOUND: `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-01-SUMMARY.md`

**Commits verified in git log:**
- FOUND: `dc5fd34` feat(25-01): add migration 0006 + schema.ts ritual tables (RIT-01..05)
- FOUND: `9f883af` fix(25-01): add FK references() to ritual schema.ts + drizzle-aligned 0006 SQL
- FOUND: `2aa96e2` feat(25-01): extend regen-snapshots.sh + meta-snapshot lineage 0..6
- FOUND: `889da4c` feat(25-01): add migration 0006 apply + substrate smoke gate to test.sh (RIT-06)

**Acceptance gates verified live:**
- FOUND: `bash scripts/regen-snapshots.sh` exits 0 with "✓ Snapshot regeneration acceptance gate: No schema changes"
- FOUND: `bash scripts/test.sh` exits 0 with "✓ Migration 0006 substrate verified (6 tables + 1 enum value + 3 indexes)" and `/tmp/m009_smoke.txt` containing exactly `6|1|3`
- FOUND: `npx drizzle-kit generate` reports "No schema changes, nothing to migrate"
- FOUND: full lineage chain 0000→0006 verified intact (every snapshot's prevId matches the previous snapshot's id)

---
*Phase: 25-ritual-scheduling-foundation-process-gate*
*Plan: 01*
*Completed: 2026-04-26*
