---
phase: 43-inference-security-contract
plan: 02
subsystem: memory/profiles + db/migrations
tags: [CONTRACT-01, CONTRACT-02, CONTRACT-03, migration-0014]
requires: ["43-01"]
provides:
  - CONTRACT-01 closure (host-computes-not-emits)
  - CONTRACT-02 closure (M010-03 anti-drift defense)
  - CONTRACT-03 closure (data_consistency persistence + migration 0014)
affects:
  - src/memory/profiles/shared.ts (sanitize import + strip dataConsistency)
  - src/memory/profiles.ts (psychological strip + reader-strip notes)
  - src/memory/profiles/{jurisdictional,capital,health,family}.ts (seed null-return)
  - src/memory/profiles/psychological-shared.ts (upsert wire)
  - src/db/schema.ts (3 psych tables: dataConsistency column + CHECK)
  - src/db/migrations/0014_psychological_data_consistency_column.sql (NEW)
  - src/db/migrations/meta/0014_snapshot.json (NEW)
  - src/db/migrations/meta/_journal.json (idx-14 entry)
  - scripts/test.sh (MIGRATION_14_SQL + apply line)
  - src/memory/__tests__/profiles.test.ts (CONTRACT-01 regression)
  - src/memory/__tests__/profile-prompt.test.ts (CONTRACT-02 regression)
  - src/memory/__tests__/psychological-profile-updater.integration.test.ts (CONTRACT-03 + W-01)
  - src/memory/profiles/__tests__/integration-m010-30days.test.ts (cascade flip)
key_files:
  created:
    - src/db/migrations/0014_psychological_data_consistency_column.sql
    - src/db/migrations/meta/0014_snapshot.json
  modified:
    - src/memory/profiles/shared.ts
    - src/memory/profiles.ts
    - src/memory/profiles/jurisdictional.ts
    - src/memory/profiles/capital.ts
    - src/memory/profiles/health.ts
    - src/memory/profiles/family.ts
    - src/memory/profiles/psychological-shared.ts
    - src/db/schema.ts
    - src/db/migrations/meta/_journal.json
    - scripts/test.sh
    - src/memory/__tests__/profiles.test.ts
    - src/memory/__tests__/profile-prompt.test.ts
    - src/memory/__tests__/psychological-profile-updater.integration.test.ts
    - src/memory/profiles/__tests__/integration-m010-30days.test.ts
decisions:
  - D-09: dataConsistency added to shared.ts strip (prompt path) only; reader strip (Zod parse path) intentionally unchanged
  - D-10: 4 extract<X>PrevState functions return null on substrateHash === '' (Phase 33 D-11 sentinel)
  - D-12: data_consistency real column on profile_hexaco + profile_schwartz + profile_attachment
  - D-14: upsertValues writes Sonnet's data_consistency emission on every fire
  - D-15: migration takes 0014 slot (Phase 45 takes 0015 + 0016)
metrics:
  duration_minutes: ~50
  tasks_completed: 5
  files_created: 2
  files_modified: 12
  tests_added: ~22
  completed_at: "2026-05-15"
---

# Phase 43 Plan 02: CONTRACT-01/02/03 + Migration 0014 Summary

Closes 3 CONTRACT-class defects + persists Sonnet's data_consistency emission to a new psychological-profile column via the HARD CO-LOC migration 0014 bundle.

## Commits

- `e74e795` fix(43-02): CONTRACT-01 — strip dataConsistency from prevState (D-09)
- `bee4bae` fix(43-02): CONTRACT-02 — extract<X>PrevState null on seed-row sentinel (D-10)
- `99e80df` feat(43-02): CONTRACT-03 — migration 0014_psychological_data_consistency_column (D-15)
- `34b3b46` fix(43-02): CONTRACT-03 — persist data_consistency in psychological upsert (D-14)
- `1924813` fix(43-02): cascade fixes from CONTRACT-01 + CONTRACT-02 + CONTRACT-03 (Rule 1/2)

## Per-task outcomes

### Task 1 (e74e795) — CONTRACT-01 stripMetadataColumns

`src/memory/profiles/shared.ts:stripMetadataColumns` discards both `confidence` AND `dataConsistency` from the snake-cased prevState. The corresponding `src/memory/profiles.ts:stripMetadataColumns` was intentionally NOT modified — it feeds the v3 Zod parse path where `data_consistency` is a required top-level field; stripping it would null-route every read.

4 regression tests across all 4 operational dimensions + 1 documentation regression test confirming the reader contract remains intact.

### Task 2 (bee4bae) — CONTRACT-02 extract<X>PrevState null-on-seed

All 4 `extract<X>PrevState` functions (jurisdictional/capital/health/family) now return `null` when `row.substrateHash === ''` (Phase 33 D-11 seed-row sentinel). The misleading inline comments ("Phase 33 seed rows are returned non-null so Sonnet sees 'insufficient data' markers") replaced with accurate D-10 semantics.

16 new CONTRACT-02 tests parametrized over 4 dimensions × 4 cases (seed-null, prompt-omits-anchor, row-null, post-first-fire-non-null). D-11 `.every()` discipline satisfied.

### Task 3 (99e80df) — HARD CO-LOC migration 0014 atomic bundle

Five files committed atomically:
- `src/db/schema.ts` — dataConsistency real NOT NULL DEFAULT 0 + CHECK 0..1 on profileHexaco / profileSchwartz / profileAttachment.
- `src/db/migrations/0014_psychological_data_consistency_column.sql` — 3 ALTER TABLE ADD COLUMN IF NOT EXISTS + 3 ADD CONSTRAINT statements.
- `src/db/migrations/meta/0014_snapshot.json` — drizzle-kit meta snapshot, chained: `prevId` points to 0013's `id` (`e0e8e698-fe65-4ebb-8765-e3ed5d99f7ff`).
- `src/db/migrations/meta/_journal.json` — idx-14 entry with `when: 1778829766609` (strictly greater than 0013's `1778699398922`; monotonicity verified by `validate-journal-monotonic.ts`).
- `scripts/test.sh` — MIGRATION_14_SQL definition + psql apply line after the MIGRATION_13_SQL block.

The 0014 SQL was hand-written; the drizzle meta snapshot was generated by running `npx drizzle-kit generate` (which produced a transient `0014_nifty_nightmare.sql` + `0015_elite_redwing.sql` pair) then surgically renamed: 0015_snapshot.json → 0014_snapshot.json, prevId rewritten to chain from 0013, journal collapsed to a single 0014 entry tagged correctly.

### Task 4 (34b3b46) — CONTRACT-03 upsert persistence + W-01

`src/memory/profiles/psychological-shared.ts:upsertValues` now includes `dataConsistency: sonnetOut.data_consistency`. `sonnetOut.data_consistency` is a typed number from the v4 boundary parse (psychological-schemas.ts:166).

**W-01 plan-check applied**: The integration test extension at `psychological-profile-updater.integration.test.ts:298-310` asserts `dataConsistency` is a number in [0, 1] on BOTH `profileHexaco` AND `profileSchwartz` rows after Cycle 1 — closes the plan-check W-01 gap (the original plan only covered hexaco).

### Task 5 (1924813) — Cascade fixes from Full Docker test gate

Three Rule 1/Rule 2 cascade fixes auto-applied (all directly caused by Plan 43-02 source changes):

1. **`profiles.ts:stripPsychologicalMetadataColumns`** — added `dataConsistency` to destructure-and-discard list. The new column reaches the reader-side strip via Drizzle row reads; the per-dim v3 row schemas (`HexacoProfileSchemaV3.strict()` etc.) reject `data_consistency` as unknown (it lives only on the V3Boundary variants used by the SDK boundary parse). Without this fix, every psychological profile row read post-deploy would null-route through Layer 2 parse_failed.

2. **`profiles.test.ts` CONTRACT-01 fixtures** — rows must have non-empty `substrateHash` for the strip assertion to be meaningful (CONTRACT-02 now short-circuits seed-row reads). `POPULATED_HASH = 'a'.repeat(64)` used as a 64-hex sentinel.

3. **`integration-m010-30days.test.ts` PTEST-03** — assertion flipped from `.toBe(true)` to `.toBe(false)` per the new CONTRACT-02 contract. Seed-row first fire now correctly omits the prevState block.

## W-01 / W-02 / W-03 Plan-Check Warnings

- **W-01** (Plan 43-02 Task 4 schwartz extension): Applied inline. Integration test now asserts dataConsistency persistence on profile_hexaco AND profile_schwartz.
- **W-02** (psychological-schemas.ts v3 boundary): Pre-execution grep at start of Plan 43-01 confirmed `data_consistency` is already declared in both `HexacoProfileSchemaV3Boundary.strict()` and `SchwartzProfileSchemaV3Boundary.strict()`. The next live Sonnet cron fire (Sun 2026-05-17 22:00 Paris) will not fail parse.
- **W-03** (ROADMAP narrative-is-stale): Not modified during Plan 43-02 — CONTEXT decisions D-12/D-13 supersede ROADMAP narrative. ROADMAP cleanup batched with Phase 45.

## Deviations from Plan

### Plan-locked D-09 partially applied (Rule 1)

The plan asked to apply the dataConsistency-strip edit to BOTH stripMetadataColumns sites. The reader-side copy in `src/memory/profiles.ts:stripMetadataColumns` was reverted because the v3 Zod schemas (`JurisdictionalProfileSchemaV3.strict()` etc.) declare `data_consistency` as a required top-level field — stripping it null-routes every read. The CONTRACT-01 *semantic* (no prevState leak to Sonnet) applies only to the prompt-builder path that routes through `shared.ts`. Documented inline at `profiles.ts:215-240`.

## Migration Journal Sanity

```
idx 13: tag=0013_psychological_profiles            when=1778699398922
idx 14: tag=0014_psychological_data_consistency_column when=1778829766609
```

Monotonicity verified by `npx tsx scripts/validate-journal-monotonic.ts` (15 entries, all monotone).

## Full Docker Test Gate Results

`bash scripts/test.sh src/memory/__tests__/`: 9 files, 242 passed, 0 failed.
`bash scripts/test.sh src/memory/`: 26 files, 368 passed, 1 failed (pre-existing PMT-03 baseline failure documented in `deferred-items.md`), 2 skipped.
`bash scripts/test.sh src/rituals/ src/pensieve/ src/episodic/`: 43 files, 427 passed, 1 skipped.

The PMT-03 failure was confirmed baseline-pre-existing by checking out `9f8dadc` source and re-running — same failure. Phase 43 does NOT touch `loadPsychologicalSubstrate` or the threshold logic exercised there.

## Live Verification Path

- Sun 2026-05-17 22:00 Paris: First M010 operational profile cron fire — CONTRACT-01 (no dataConsistency leak in prevState) + CONTRACT-02 (no prevState block on seed-row first fire) live-verified against real production substrate.
- Sun 2026-05-17 22:00 Paris: First M011 psychological profile cron fire (note: this is the M010 phase34 cron per project memory — the M011 monthly cron is 2026-06-01 09:00 Paris). data_consistency column populated by Sonnet's emission; verifiable via `ssh root@192.168.1.50 'docker compose exec postgres psql -U chris -d chris -c "SELECT name, data_consistency FROM profile_hexaco"'`.

## Self-Check: PASSED

- `grep -c "dataConsistency: _dataConsistency" src/memory/profiles/shared.ts` returns 1
- `grep -c "row.substrateHash === ''" src/memory/profiles/jurisdictional.ts src/memory/profiles/capital.ts src/memory/profiles/health.ts src/memory/profiles/family.ts` returns 4
- `grep -c "data_consistency" src/db/migrations/0014_psychological_data_consistency_column.sql` returns 8
- `grep -c "dataConsistency: sonnetOut.data_consistency" src/memory/profiles/psychological-shared.ts` returns 1
- `grep -c "MIGRATION_14_SQL" scripts/test.sh` returns 2
- `npx tsx scripts/validate-journal-monotonic.ts` exits 0
- `bash scripts/test.sh src/memory/__tests__/` exits 0 (242/242 green)
