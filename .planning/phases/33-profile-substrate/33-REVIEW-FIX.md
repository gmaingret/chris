---
phase: 33-profile-substrate
fixed_at: 2026-05-12T17:00:00Z
review_path: .planning/phases/33-profile-substrate/33-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 33: Code Review Fix Report

**Fixed at:** 2026-05-12
**Source review:** `.planning/phases/33-profile-substrate/33-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (3 warning + 4 info)
- Fixed: 7
- Skipped: 0

Warning-severity findings (WR-01, WR-02, WR-03) were applied in a prior
session (commits `ba789e6`, `46719d0`, `1ae7d56`). The Info findings
(IN-01–IN-04) are applied here. IN-01 and IN-02 were combined into a single
atomic commit per user instruction — both touch the same lines 7-22 of
`src/pensieve/embeddings.ts` and the natural fix (extract to named function +
align comment) ships both improvements in one change.

## Fixed Issues

### WR-01: `findFlatteryHits` multi-word matching has the same false-positive bug it was created to fix

**Files modified:** `src/episodic/markers.ts`
**Commit:** `ba789e6`
**Applied fix:** Collapsed the two-branch (`includes(' ')` vs regex) match path into a single `\b<marker>\b` regex path that anchors both edges. Multi-word markers like `"great insight"` no longer match `"great insights"`; `"demonstrating his"` no longer matches `"demonstrating history"`.

### WR-02: `findFlatteryHits` accepts caller-supplied `extraMarkers` without input validation

**Files modified:** `src/episodic/markers.ts`
**Commit:** `46719d0`
**Applied fix:** Added a `.trim().toLowerCase()` normalize pass and `.filter(m => m.length > 0)` drop-empties step at the boundary. Empty / whitespace-only markers can no longer produce the `\b\b` regex that matches at every word boundary.

### WR-03: `embedAndStoreChunked` does not log the chunk-write success count

**Files modified:** `src/pensieve/embeddings.ts`
**Commit:** `1ae7d56`
**Applied fix:** Track `chunksWritten` counter incremented after each successful `db.insert()`. Log payload now carries both `chunkCount` (attempted) and `chunksWritten` (succeeded); when they diverge the log is emitted at warn level instead of info, so log-level filters surface the partial-success case.

### IN-01 + IN-02: Stale cache-dir comment + module-load mutation refactor

**Files modified:** `src/pensieve/embeddings.ts`
**Commit:** `9f6ed18`
**Applied fix:** Combined two related changes touching lines 7-22 of the same file:
- IN-01: Rewrote the stale comment that claimed an `env?.` optional-chaining guard (the actual code uses `&& env`). New comment accurately describes the `&& env` guard as defense-in-depth against test mocks that forget to stub the `env` export.
- IN-02: Extracted the module-load mutation into a named function `configureTransformersCacheDir()` called at module top. The cache-redirect policy now has an explicit, greppable name; the side effect is preserved.

### IN-03: `findFlatteryHits` recompiles regex on every call

**Files modified:** `src/episodic/markers.ts`
**Commit:** `5d6f5d2`
**Applied fix:** Pre-compiled a parallel array `STOCK_MARKER_REGEXES` (1:1 with `FLATTERY_MARKERS`) plus a frozen `STOCK_MARKER_SET` for O(1) extras dedup, both built at module load via a new `compileMarkerRegex(marker)` helper. The hot path now only allocates `RegExp` objects for caller-supplied `extraMarkers`. The same helper handles both stock-marker and extra-marker compilation, so the regex-construction logic lives in one place.

### IN-04: `findFlatteryHits` can return duplicate markers across stock + extras

**Files modified:** `src/episodic/markers.ts`
**Commit:** `86ffc06`
**Applied fix:** Wrapped the normalized marker list in `new Set(...)` so duplicates between `FLATTERY_MARKERS` and `extraMarkers` (e.g., `"great insight"` appears in both stock list and `VALIDATION_MARKERS`) collapse to a single entry before the regex test. Eliminates the duplicate-hit surprise in TEST-31 soft-assertion failure messages.

_Note: IN-03's commit `5d6f5d2` superseded IN-04's earlier dedup implementation with a more structured one (stock-vs-extra dedup via `STOCK_MARKER_SET.has(m)` + `seenExtra.has(m)`). Both achieve the same semantic — no duplicate hits — but the IN-03 form is structurally cleaner for the precompiled-regex architecture._

## Verification

- TypeScript: `node_modules/.bin/tsc --noEmit` is clean after every commit.
- Targeted tests: `bash scripts/test.sh src/episodic/__tests__/live-anti-flattery.test.ts src/pensieve/__tests__/embeddings.test.ts src/pensieve/__tests__/chunked-embedding.test.ts` reports `1 failed | 19 passed (20)`. The single failure is `TEST-22: Live anti-flattery` returning `401 invalid x-api-key` from the Anthropic API — environmental, unrelated to these fixes. `findFlatteryHits` is invoked only AFTER a successful API call (line 245 of `live-anti-flattery.test.ts`), so a 401 never exercises the changed code path. All 19 passing tests include the full `embeddings.test.ts` and `chunked-embedding.test.ts` suites, which exercise the cache-dir redirect and chunked-write paths.

---

_Fixed: 2026-05-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
