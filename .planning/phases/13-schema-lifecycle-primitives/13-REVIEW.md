---
phase: 13-schema-lifecycle-primitives
reviewed: 2026-04-15T12:00:00Z
depth: standard
iteration: 2
files_reviewed: 17
files_reviewed_list:
  - scripts/test.sh
  - src/db/migrations/0002_decision_archive.sql
  - src/db/migrations/0003_add_decision_epistemic_tag.sql
  - src/db/migrations/meta/0002_snapshot.json
  - src/db/migrations/meta/_journal.json
  - src/db/schema.ts
  - src/decisions/__tests__/capture-state.test.ts
  - src/decisions/__tests__/chokepoint-audit.test.ts
  - src/decisions/__tests__/concurrency.test.ts
  - src/decisions/__tests__/lifecycle.test.ts
  - src/decisions/__tests__/regenerate.test.ts
  - src/decisions/__tests__/schema.test.ts
  - src/decisions/capture-state.ts
  - src/decisions/errors.ts
  - src/decisions/index.ts
  - src/decisions/lifecycle.ts
  - src/decisions/regenerate.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: clean
---

# Phase 13: Code Review Report (Iteration 2)

**Reviewed:** 2026-04-15
**Depth:** standard
**Iteration:** 2 (post-fix re-review; supersedes iteration 1)
**Files Reviewed:** 17
**Status:** clean

## Summary

All 1 critical and 5 warnings from iteration 1 have been addressed correctly. The
fixes are tight, well-commented, and each is backed by a regression test or inline
explanatory comment that pins the invariant being protected.

Verification of fixes (commits 129a89c, a4fb33d, e527fe3, db44e4c):

- **CR-01 fix (bigint jsonb crash) — SOUND.** `snapshotForEvent()` at
  `src/decisions/lifecycle.ts:41-46` coerces `chatId` to string on write;
  `rehydrateDates()` at `src/decisions/regenerate.ts:40` rehydrates back to
  `bigint` on read. The new regression test at
  `src/decisions/__tests__/regenerate.test.ts:67-101` seeds `chatId: 123n`,
  transitions `open → due`, and asserts deep-equal parity with the live
  projection. Write/read sides are now symmetric and the `regenerate.ts:39`
  comment that foreshadowed stringification now matches reality.
- **WR-01 fix (silent psql errors) — SOUND.** All four migration psql calls plus
  the `CREATE EXTENSION` call at `scripts/test.sh:40-49` now pass
  `-v ON_ERROR_STOP=1` and no longer redirect stderr. An explanatory comment
  (lines 37-39) records the reasoning so a future maintainer does not
  "simplify" it away.
- **WR-02 fix (readiness loop never fails) — SOUND.** `scripts/test.sh:23-34`
  now uses an explicit `ready=0 / ready=1` flag with a post-loop guard that
  emits a clear error and `exit 1` if postgres never came up. The 2>/dev/null
  on `pg_isready` itself is fine — that is noise suppression during polling,
  not error swallowing.
- **WR-03 fix (misleading return on non-status tail events) — SOUND.**
  `regenerateDecisionFromEvents` at `src/decisions/regenerate.ts:65-74` now
  filters `where(eq(decisionEvents.eventType, 'status_changed'))` and keys off
  the last status event. The new test at
  `src/decisions/__tests__/regenerate.test.ts:160-180` forges a `field_updated`
  event AFTER a `status_changed` event and asserts the regenerated row still
  matches the live projection (not the partial snapshot). The tied-timestamp
  test at lines 118-158 was also updated to reflect the new semantics.
- **WR-04 fix (possibly-null deref in test) — SOUND.**
  `src/decisions/__tests__/regenerate.test.ts:61-63` now asserts
  `expect(regenerated).not.toBeNull()` before dereferencing via `regenerated!`.
  The same pattern is applied consistently across the new test cases.
- **WR-05 fix (chokepoint-audit regex fragility) — SOUND.**
  `src/decisions/__tests__/chokepoint-audit.test.ts:23` anchors all path
  comparisons to `REPO_ROOT` via `resolve(__dirname, '..', '..', '..')` and
  compares against `toRepoRel(f)`. The regex at line 55 now uses `\bstatus\b`
  word boundaries, so `statusCode:` and `status_note:` no longer trip it.
  Inline comments document both invariants.

**No regressions introduced by the fixes.** The remaining items below are all
**Info**-level polish suggestions carried forward or newly observed — none block
promotion of this phase.

## Info

### IN-01: snapshotForEvent only coerces chatId — no compile-time safety for future bigint columns

**File:** `src/decisions/lifecycle.ts:41-46`
**Issue:** `snapshotForEvent()` explicitly coerces `chatId` to string, but the
mirror in `regenerate.ts:40` only rehydrates `chatId`. If a future phase adds a
second `bigint({ mode: 'bigint' })` column to `decisions` (e.g. a future
`sourceChatId` or similar), the same BigInt serialization crash will reappear
and the bug will again be invisible until a chat-scoped row is transitioned in
production. Nothing at the type system or test layer forces parity between the
write-side coercion set and the read-side rehydration set.

**Fix:** Two reasonable options:
  1. Derive the bigint column set from Drizzle metadata at runtime — iterate
     `getTableColumns(decisions)` and pick columns whose `dataType` is bigint
     with `mode: 'bigint'`, then stringify/rehydrate based on that list.
  2. Add a unit test that `for (col of getTableColumns(decisions))` asserts
     any bigint-mode column appears in a single shared `BIGINT_COLUMNS`
     constant used by both `snapshotForEvent` and `rehydrateDates`.

Not blocking — Phase 13 only has one bigint column.

### IN-02: TIMESTAMPTZ_COLUMNS is still a manual list

**File:** `src/decisions/regenerate.ts:16-26`
**Issue:** Carried forward from iteration 1 IN-01. The list is correct as of
Phase 13, but the maintenance instruction ("grep timestamp(.*withTimezone
between the `decisions` table declaration boundaries") at lines 13-14 is a
manual process. Phase 17's `accuracyClassifiedAt` is already present, so the
list is complete today; the risk is future additions silently breaking the
`toEqual(projection)` deep-equal in `regenerate.test.ts`. Same Drizzle-metadata
solution as IN-01 applies (filter `getTableColumns(decisions)` on
`dataType === 'date'` / timestamp).

**Fix:** Optional refactor — not blocking.

### IN-03: Malformed-date coercion silently produces Invalid Date

**File:** `src/decisions/regenerate.ts:34-36`
**Issue:** Carried forward from iteration 1 IN-03. `new Date(v)` on a malformed
string returns an `Invalid Date` (getTime() === NaN) rather than throwing.
Deep-equal assertions will fail mysteriously rather than pointing at a
corrupted snapshot. A sanity check after coercion would turn silent data
corruption into a loud error.

**Fix:**
```ts
if (typeof v === 'string' || typeof v === 'number') {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`regenerate: malformed timestamptz value for column '${col}': ${v}`);
  }
  out[col] = d;
}
```

### IN-04: decision_events.actor is varchar(32) with no DB-side constraint

**File:** `src/db/schema.ts:260`, `src/db/migrations/0002_decision_archive.sql:20`
**Issue:** Carried forward from iteration 1 IN-04. The TS `ActorKind` type in
`lifecycle.ts:27` enforces the enum on the chokepoint write path, but test
data-forges that bypass the chokepoint (e.g. `regenerate.test.ts:127-134`)
write `actor = 'system'` via raw SQL with no DB-side guard. A typo in a future
raw insert would land an unknown actor with no diagnostic.

**Fix:** Consider promoting `actor` to a `pgEnum` in a future migration, or at
minimum a `CHECK (actor IN ('capture','transition','sweep','user','system'))`
constraint. Not blocking for Phase 13.

---

_Reviewed: 2026-04-15 (iteration 2)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
