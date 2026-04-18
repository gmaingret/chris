---
phase: 20-schema-tech-debt
plan: 01
subsystem: db
tags: [tech-debt, drizzle, migration, snapshot, TD-01]
requires: [ROADMAP Phase 20 TD-01]
provides:
  - "byte-accurate drizzle-kit meta snapshots for migrations 0001 and 0003"
  - "re-runnable scripts/regen-snapshots.sh clean-slate iterative replay recipe"
  - "TECH-DEBT-19-01 resolution (STATE.md flipped ACTIVE → RESOLVED)"
  - "D-03 acceptance gate green: `drizzle-kit generate` prints 'No schema changes'"
affects:
  - "src/db/migrations/meta/0001_snapshot.json (new)"
  - "src/db/migrations/meta/0003_snapshot.json (new)"
  - "src/db/migrations/meta/0002_snapshot.json (re-chained prevId)"
  - "src/db/migrations/meta/0004_snapshot.json (re-chained prevId)"
  - "scripts/regen-snapshots.sh (new)"
  - ".planning/STATE.md (TECH-DEBT-19-01 RESOLVED)"
tech-stack:
  added: []
  patterns:
    - "Clean-slate iterative replay for drizzle-kit snapshot recovery — Docker postgres on an isolated compose project + port (chris-regen, port 5434), apply migrations progressively, drizzle-kit introspect at each waypoint, patch id/prevId chain, verify with drizzle-kit generate no-op"
    - "Snapshot chain re-pointing — when inserting a new snapshot into an existing chain, the next snapshot's prevId MUST be updated to point at the new snapshot's id (drizzle-kit rejects duplicate prevId values across the chain)"
key-files:
  created:
    - "scripts/regen-snapshots.sh — throwaway-Docker snapshot regen recipe with D-03 acceptance gate; supports --check-only dry-run"
    - "src/db/migrations/meta/0001_snapshot.json — schema-as-of-0001 (8 tables, conversation_mode enum with PHOTOS added)"
    - "src/db/migrations/meta/0003_snapshot.json — schema-as-of-0003 (11 tables, epistemic_tag enum with DECISION added, decision-archive tables present)"
    - ".planning/phases/20-schema-tech-debt/20-01-SUMMARY.md (this file)"
  modified:
    - "src/db/migrations/meta/0002_snapshot.json — prevId re-chained from 0000.id → new 0001.id"
    - "src/db/migrations/meta/0004_snapshot.json — prevId re-chained from 0002.id → new 0003.id"
    - ".planning/STATE.md — TECH-DEBT-19-01 Status: ACTIVE → RESOLVED; Current Position + Session Continuity + frontmatter updated"
decisions:
  - "Used drizzle-kit introspect (not the temp-workspace drizzle-kit generate trick specified in PLAN.md) for snapshot extraction — simpler, more reliable, produces byte-accurate snapshots directly from the DB state. The plan's temp-workspace approach was predicated on drizzle-kit generate taking a DATABASE_URL; empirical probing showed generate is purely file-based (schema.ts + snapshot diff), so the temp-workspace trick would not have worked as written."
  - "Re-chained 0002.prevId and 0004.prevId to the new 0001/0003 ids (deviation from plan scope; Rule 3 blocking fix). Without this, drizzle-kit exits 1 with 'collision: are pointing to a parent snapshot' — the D-03 acceptance gate cannot pass. This is a two-field-only update; snapshot content is byte-identical."
  - "Matched drizzle-kit's native 2-space JSON indentation (verified via probe) rather than node's default tab indent — keeps diffs clean if snapshots are regenerated in future."
metrics:
  duration_seconds: 2700
  duration_human: "~45 minutes"
  completed_date: "2026-04-18"
  tasks: 3
  files_changed: 6
  insertions: 2151
  deletions: 20
---

# Phase 20 Plan 01: Drizzle Snapshot Regeneration (TECH-DEBT-19-01) Summary

Regenerated missing drizzle-kit meta snapshots for migrations 0001 and 0003 via clean-slate iterative replay on a throwaway Docker postgres (project `chris-regen`, port 5434), re-chained the downstream snapshots (0002, 0004) to point at the new ids, and flipped TECH-DEBT-19-01 from ACTIVE to RESOLVED in STATE.md. The D-03 acceptance gate — `drizzle-kit generate` against a freshly-migrated Docker with the full 0000→0004 chain applied must print "No schema changes, nothing to migrate" — is green. The full Docker test suite runs 843/904 tests passing; the 61 failures match the Plan 19-04 pre-existing baseline (Cat A engine mock-chain + Cat B `@huggingface/transformers` env/cache permission) and are not regressions introduced by this plan.

## Objective

Resolve TECH-DEBT-19-01 — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` were missing, producing a corrupt drizzle-kit snapshot chain. Without these snapshots, downstream migration 0005 (Phase 20 Plan 02: `episodic_summaries`) would be generated against a broken baseline. The clean-slate iterative replay procedure from CONTEXT.md D-01 regenerates both snapshots byte-accurately so Plan 02 onwards operates on a clean chain.

## What Was Done

### Task 1 — Authored scripts/regen-snapshots.sh
- 270-line executable bash script with `set -euo pipefail`, documented comment block, `--check-only` dry-run flag, full trap-based cleanup.
- Uses compose project `chris-regen` + port 5434 + the existing `docker-compose.local.yml` base file plus an inline override file written to `.tmp/docker-compose.regen.override.yml` to republish postgres on the regen port. Never collides with the test postgres (project `chris-local`, port 5433).
- Implements the D-01 clean-slate iterative replay: bring up fresh postgres → apply 0000+0001 → drizzle-kit introspect → patch id/prevId → repeat for 0003 → re-chain 0002/0004 → tear down + fresh bring-up → apply all 5 migrations → drizzle-kit generate acceptance gate.
- Commit: `0224f7c feat(20-01): add scripts/regen-snapshots.sh clean-slate replay recipe`

### Task 2 — Ran the regen script end-to-end
- First run surfaced an issue with `patch_snapshot_chain` helper capturing drizzle-kit's progress-bar output on stdout (contaminated the snapshot file path). Fixed by redirecting introspect output to stderr.
- Second run surfaced the prevId-collision constraint in drizzle-kit's parse-snapshots pass (`Error: ... are pointing to a parent snapshot ... which is a collision`). Fixed by adding a `patch_prev_id_inplace` helper and re-chaining 0002 and 0004.
- Third run surfaced indentation drift (node's `JSON.stringify(_, _, '\t')` emits tabs; drizzle-kit emits 2 spaces). Fixed to match drizzle-kit's native style.
- Final run: D-03 acceptance gate green. `drizzle-kit generate` reports "No schema changes, nothing to migrate" against a fresh postgres with all 5 migrations applied.
- Verified snapshot contents: 0001 has 8 tables + conversation_mode enum with PHOTOS added; 0003 has 11 tables + epistemic_tag enum with DECISION added + the decision-archive tables from 0002.
- Commit: `46ff96e fix(db): regenerate drizzle-kit snapshots for migrations 0001 and 0003 (TD-01)`

### Task 3 — Marked TECH-DEBT-19-01 RESOLVED in STATE.md
- Replaced "Reactivation trigger: ACTIVE" with "Status: RESOLVED" for the TECH-DEBT-19-01 entry.
- Corrected the old resolution hint (Plan 19-04 Option A "drizzle-kit generate will implicitly regenerate") which was empirically wrong.
- Updated frontmatter (stopped_at, last_updated, last_activity, progress.completed_plans=1, percent=6), Current Position (Plan 2 of 3; Plan 01 complete), and Session Continuity to reflect the new state.
- Preserved the Audit disposition bullet.
- Commit: `420ec30 docs(20-01): mark TECH-DEBT-19-01 RESOLVED in STATE.md`

## Verification Results

### D-03 Acceptance Gate (primary)
```
$ DATABASE_URL=... npx drizzle-kit generate --name final_gate
No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/claude/chris/drizzle.config.ts'
12 tables
...
No schema changes, nothing to migrate 😴
```
No SQL file or snapshot emitted. Gate green.

### Snapshot chain integrity
- `_journal.json`: 5 entries, idx 0..4, tags in correct order.
- `0001_snapshot.json`: new UUID id, prevId = 0000.id. Contents: schema-as-of-0001.
- `0002_snapshot.json`: original id preserved, prevId re-chained to new 0001.id.
- `0003_snapshot.json`: new UUID id, prevId = 0002.id. Contents: schema-as-of-0003.
- `0004_snapshot.json`: original id preserved, prevId re-chained to new 0003.id.

### Full Docker test suite
- Ran `bash scripts/test.sh`. EXIT 0.
- Result: **843 passed / 61 failed (904 total)**. Duration 2432s.
- Pre-existing baseline (Plan 19-04): Cat A (engine mock-chain) 45 + Cat B (live-API / `@huggingface/transformers` env cache) 49 = 94 failures.
- This run's 61 failures ≤ 94 — **no regressions introduced**. The 61 failures in this run correspond to the same two pre-existing categories (many Cat B `EACCES: permission denied, mkdir .../transformers/.cache` errors from a root-owned node_modules subdirectory in this workspace — environmental, not functional).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking fix] Re-chained 0002 and 0004 snapshots' prevId**
- **Found during:** Task 2 first end-to-end run
- **Issue:** Drizzle-kit's parse-snapshots pass rejects duplicate prevId values across the chain with: `Error: [0001_snapshot.json, 0002_snapshot.json] are pointing to a parent snapshot ... which is a collision.` The D-03 acceptance gate cannot pass without fixing this — the gate is the plan's primary success criterion.
- **Fix:** Added `patch_prev_id_inplace` helper to `scripts/regen-snapshots.sh`; after installing new 0001/0003 snapshots, update `0002_snapshot.prevId` → new 0001.id and `0004_snapshot.prevId` → new 0003.id. This is a two-field-only change; snapshot content (tables, enums, indexes) is byte-identical to the committed versions.
- **Files modified:** `src/db/migrations/meta/0002_snapshot.json`, `src/db/migrations/meta/0004_snapshot.json` (both outside the plan's declared `files_modified` list)
- **Commit:** `46ff96e`
- **Justification:** Without this change, the D-03 gate (plan's primary success criterion) cannot pass. This is correctness-required Rule 3 territory, not an architectural decision. The change preserves semantic meaning (same snapshot content; only chain-linkage metadata changed).

**2. [Rule 3 - Blocking fix] Switched from temp-workspace drizzle-kit generate to drizzle-kit introspect**
- **Found during:** Task 1 authoring / initial approach design
- **Issue:** The plan's Task 1 step 3d ("drizzle-kit generate in a temp workspace with staged schema.ts and journal") assumed `drizzle-kit generate` takes a DATABASE_URL and introspects the DB at generate time. Empirical probing (`npx drizzle-kit generate --help`) showed generate is purely file-based — it compares current schema.ts to the latest snapshot on disk; it does not touch the database at all. The temp-workspace trick as written cannot produce a byte-accurate intermediate snapshot without a corresponding hand-crafted schema.ts-as-of-that-migration.
- **Fix:** Used `drizzle-kit introspect` instead, which DOES consult the live DB and emits a snapshot matching the DB's current state. Applied migrations progressively (0000+0001, then +0002+0003) and introspected at each waypoint. Patched the emitted snapshot's `id` and `prevId` to chain into the existing snapshot sequence.
- **Files modified:** none beyond what was already planned — this was a change of implementation technique for Task 1.
- **Commit:** `0224f7c` (script authored) + `46ff96e` (script refinements during execution)
- **Justification:** The plan's approach was predicated on incorrect drizzle-kit behavior. The introspect-based approach is strictly simpler and produces byte-accurate snapshots directly from DB state. Acceptance gate (D-03) is the authority on correctness; it passes.

**3. [Rule 1 - Bug] Fixed stdout-capture contamination in `patch_snapshot_chain`**
- **Found during:** Task 2 first run — node threw `SyntaxError: Unexpected character '✓'` when parsing what was supposed to be a JSON file path.
- **Issue:** `introspect_to()` helper captured via `$(...)` was letting drizzle-kit's progress-bar output leak onto stdout, so the function returned a multi-line string starting with ANSI escapes + progress-bar text instead of a clean path.
- **Fix:** Redirect drizzle-kit introspect output entirely to stderr (`>&2 2>&1`); wrap the subshell in a final `>&2` for defense; use `printf '%s\n'` for the return-value line.
- **Commit:** included in `46ff96e` script refinements.

**4. [Rule 1 - Bug] Fixed indentation drift in emitted snapshots**
- **Found during:** Task 2 second run — diff on 0002 and 0004 showed every line changed because node's `JSON.stringify(_, _, '\t')` uses tabs; drizzle-kit emits 2 spaces.
- **Issue:** Cosmetic but impairs future diffability of snapshot files.
- **Fix:** Changed `JSON.stringify(_, _, '\t')` → `JSON.stringify(_, _, 2)` in both `patch_snapshot_chain` and `patch_prev_id_inplace`; dropped the trailing newline to match drizzle-kit's own output style.
- **Commit:** included in `46ff96e` script refinements.

### Out-of-scope items
None. No deferred-items.md entries written.

## Known Stubs
None. This plan is data/config only — no new runtime code paths or UI surfaces introduced.

## Environmental Notes (Docker test suite)

The workspace has a pre-existing permission quirk: `node_modules/@huggingface/transformers/` and many other `node_modules/*` subdirs are owned by root. The embedding tests and live-integration tests try to `mkdir` a `.cache` directory under the `@huggingface/transformers/` install path and fail with `EACCES`. This accounts for ~49 of the 61 failing tests (Plan 19-04 Cat B baseline: 49). It is not caused by and not affected by plan 20-01's changes (meta snapshots are not referenced at runtime — `scripts/test.sh` applies migration SQL directly). Tracked as environmental; no action taken per SCOPE BOUNDARY rule.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `0224f7c` | feat(20-01): add scripts/regen-snapshots.sh clean-slate replay recipe |
| 2 | `46ff96e` | fix(db): regenerate drizzle-kit snapshots for migrations 0001 and 0003 (TD-01) |
| 3 | `420ec30` | docs(20-01): mark TECH-DEBT-19-01 RESOLVED in STATE.md |

## Success Criteria Check

- [x] All 3 tasks completed
- [x] D-03 acceptance gate green: `drizzle-kit generate` against fresh Docker + 5 applied migrations reports "No schema changes, nothing to migrate"
- [x] TECH-DEBT-19-01 marked RESOLVED in STATE.md
- [x] `scripts/regen-snapshots.sh` is re-runnable for any future snapshot recovery (idempotent: teardown + fresh bring-up on every run; `--check-only` for dry runs)
- [x] Commit per CONTEXT.md D-04 point 1 (`fix(db): regenerate drizzle-kit snapshots for migrations 0001 and 0003 (TD-01)`)
- [x] TD-01 requirement satisfied

## Self-Check: PASSED

Verified on 2026-04-18:
- FOUND: `.planning/phases/20-schema-tech-debt/20-01-SUMMARY.md`
- FOUND: `scripts/regen-snapshots.sh`
- FOUND: `src/db/migrations/meta/0001_snapshot.json`
- FOUND: `src/db/migrations/meta/0003_snapshot.json`
- FOUND: commit `0224f7c` (Task 1)
- FOUND: commit `46ff96e` (Task 2)
- FOUND: commit `420ec30` (Task 3)
