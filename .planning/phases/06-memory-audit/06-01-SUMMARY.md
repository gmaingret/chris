---
phase: 06-memory-audit
plan: "01"
subsystem: pensieve
tags: [ground-truth, seed-data, audit, memory-audit, tdd]
dependency_graph:
  requires: []
  provides:
    - src/pensieve/ground-truth.ts (GROUND_TRUTH, GROUND_TRUTH_MAP — Phase 8 structured fact injection + Phase 10 live tests)
    - src/scripts/seed-audit-data.ts (local DB seed for Plan 02 audit script)
  affects:
    - Phase 8 (structured fact injection imports ground-truth.ts)
    - Phase 10 (live integration tests import ground-truth.ts)
    - Plan 02 (audit-pensieve.ts uses SEED_ENTRIES as test data)
tech_stack:
  added: []
  patterns:
    - TDD (RED→GREEN for both tasks)
    - Direct Drizzle insert with synchronous epistemicTag (bypasses storePensieveEntry limitation)
    - ESM isMainModule guard pattern for scripts importable as modules
key_files:
  created:
    - src/pensieve/ground-truth.ts
    - src/pensieve/__tests__/ground-truth.test.ts
    - src/scripts/seed-audit-data.ts
    - src/scripts/__tests__/seed-audit-data.test.ts
  modified: []
decisions:
  - "Implemented D-03: ground-truth as typed TypeScript const (FactCategory, GroundTruthEntry, GROUND_TRUTH array, GROUND_TRUTH_MAP Record)"
  - "Applied ESM isMainModule guard on seed script to allow import by tests without triggering main()"
  - "Used chained Drizzle .insert().values() formatting (multi-line) per project style"
metrics:
  duration_minutes: 7
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
requirements-completed: [RETR-03]
---

# Phase 6 Plan 1: Ground-Truth Module and Seed Script Summary

**One-liner:** Typed ground-truth TypeScript module (13 M006 facts, 5 categories) + seed script inserting 12 realistic Pensieve entries (10 correct + 2 known error patterns) with synchronous embeddings and localhost safety guard.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ground-truth module with tests | eb801db (feat), 7de50fa (test) | src/pensieve/ground-truth.ts, src/pensieve/__tests__/ground-truth.test.ts |
| 2 | Create seed script with tests | 18ebc81 (feat), 5070039 (test) | src/scripts/seed-audit-data.ts, src/scripts/__tests__/seed-audit-data.test.ts |

## Verification

- `npm test -- src/pensieve/__tests__/ground-truth.test.ts` — 7/7 tests pass
- `npm test -- src/scripts/__tests__/seed-audit-data.test.ts` — 5/5 tests pass
- Both test files together: 12/12 tests pass

## Key Outputs

### src/pensieve/ground-truth.ts

Exports:
- `FactCategory` — `'identity' | 'location_history' | 'property' | 'business' | 'financial'`
- `GroundTruthEntry` — `{ key: string; value: string; category: FactCategory }`
- `GROUND_TRUTH` — 13-entry array (identity: 3, location_history: 4, property: 2, business: 3, financial: 1)
- `GROUND_TRUTH_MAP` — `Record<string, string>` for O(1) key lookups

Key facts encoded: birth date (1979-06-15), birth place (Cagnes-sur-Mer), nationality (French), rental property (Golfe-Juan — **not** Cagnes-sur-Mer), Citya management, MAINGRET LLC, Georgian IE, Panama residency, FI target ($1,500,000), full location sequence (Saint Petersburg → Batumi → Antibes → Batumi permanent).

### src/scripts/seed-audit-data.ts

- 12 `SEED_ENTRIES` covering all 5 ground-truth categories
- **Error 1:** "My apartment in Cagnes-sur-Mer is rented out through Citya." (correct: Golfe-Juan)
- **Error 2:** "I'm planning to move from Georgia to Saint Petersburg next month." (correct: Saint Petersburg → Georgia)
- Direct `db.insert(pensieveEntries)` with `epistemicTag` set synchronously (bypasses `storePensieveEntry()` limitation)
- `await embedAndStore()` called per entry (not fire-and-forget)
- Localhost safety guard: refuses `DATABASE_URL` not containing `localhost` or `127.0.0.1`
- `Loading bge-m3 embedding model...` log before first embed

Run command:
```bash
DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx tsx src/scripts/seed-audit-data.ts
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESM isMainModule guard on seed script**
- **Found during:** Task 2 GREEN phase
- **Issue:** `main().catch(...)` at module level caused `process.exit(1)` when imported by vitest tests (safety guard fired because DATABASE_URL in test env doesn't have localhost prefix)
- **Fix:** Wrapped `main()` call in an `isMainModule` guard checking `process.argv[1]` suffix — standard ESM pattern since `require.main === module` is not available in ESM
- **Files modified:** src/scripts/seed-audit-data.ts
- **Commit:** 18ebc81

## Known Stubs

None — all exports are fully implemented with real data.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The localhost safety guard (T-06-01) is implemented in `src/scripts/seed-audit-data.ts` as required by the threat model.

## Self-Check: PASSED

- [x] src/pensieve/ground-truth.ts exists and exports GROUND_TRUTH (13 entries) and GROUND_TRUTH_MAP
- [x] src/pensieve/__tests__/ground-truth.test.ts exists with 7 tests
- [x] src/scripts/seed-audit-data.ts exists with SEED_ENTRIES and localhost guard
- [x] src/scripts/__tests__/seed-audit-data.test.ts exists with 5 tests
- [x] Commits 7de50fa, eb801db, 5070039, 18ebc81 exist in git log
- [x] 12/12 tests pass
