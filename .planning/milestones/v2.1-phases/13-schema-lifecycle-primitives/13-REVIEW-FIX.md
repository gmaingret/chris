---
phase: 13-schema-lifecycle-primitives
fixed_at: 2026-04-15T18:40:00Z
review_path: .planning/phases/13-schema-lifecycle-primitives/13-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 13: Code Review Fix Report

**Fixed at:** 2026-04-15T18:40:00Z
**Source review:** .planning/phases/13-schema-lifecycle-primitives/13-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05)
- Fixed: 6
- Skipped: 0

All tests pass when run serially (`npx vitest run --no-file-parallelism src/decisions/__tests__/` → 85/85 passed). The shared-DB parallel-file race (foreign-key / missing-row errors when multiple test files run concurrently against one postgres instance) is a pre-existing test infrastructure issue unrelated to these fixes — the same races exist on any commit in this phase's history, because every `__tests__` file uses `afterEach(() => db.delete(...))` on the same database.

## Fixed Issues

### CR-01: BigInt snapshot will crash transitionDecision when chat_id is set

**Files modified:** `src/decisions/lifecycle.ts`, `src/decisions/__tests__/regenerate.test.ts`
**Commit:** 129a89c
**Applied fix:** Added a `snapshotForEvent(row)` helper in `lifecycle.ts` that coerces `row.chatId` (bigint) to a string before jsonb insertion. This matches the pre-existing rehydration logic in `regenerate.ts:40` which already expects a stringified `chatId`. The event INSERT now uses `snapshot: snapshotForEvent(updated[0]!)` instead of the unsound `as unknown as object` cast. Added the requested regression test in `regenerate.test.ts`: seeds a decision with `chatId: 123n`, transitions `open → due`, and asserts the event insert succeeds and `regenerateDecisionFromEvents` deep-equals the live projection (round-trip proves both the stringify on write and the `BigInt(...)` rehydrate on read).

**Status note:** "fixed" — straightforward serialization fix with direct regression test; not a logic-judgment change.

### WR-01: test.sh swallows migration errors with 2>/dev/null

**Files modified:** `scripts/test.sh`
**Commit:** a4fb33d
**Applied fix:** Removed all `2>/dev/null` on the five migration psql lines; added `-v ON_ERROR_STOP=1` so psql exits non-zero on SQL errors (making `set -euo pipefail` actually bite); switched the `CREATE EXTENSION` call to the same `exec -T ... psql -v ON_ERROR_STOP=1 -c "..."` pattern for consistency. Migration failures now halt the script loudly instead of letting vitest run against a half-migrated schema.

### WR-02: pg_isready loop never fails the script when postgres stays down

**Files modified:** `scripts/test.sh`
**Commit:** a4fb33d (bundled with WR-01 — single file, single logical hardening pass)
**Applied fix:** Added a `ready=0` flag that flips to 1 inside the success branch; after the loop, `if [ "$ready" -ne 1 ]` prints an error to stderr and `exit 1`. If postgres never comes up in 30s, the script now fails visibly instead of proceeding to a silenced migration step.

### WR-03: regenerateDecisionFromEvents return type is misleading for non-status last-events

**Files modified:** `src/decisions/regenerate.ts`, `src/decisions/__tests__/regenerate.test.ts`
**Commit:** e527fe3
**Applied fix:** Added `and(..., eq(decisionEvents.eventType, 'status_changed'))` to the events query in `regenerateDecisionFromEvents`. Only `status_changed` events carry a full-row snapshot (D-01); filtering prevents a trailing `field_updated` partial payload from being returned as a malformed "DecisionRow". Updated the tied-timestamp test's previously-softened `expect(regenerated).toBeDefined()` assertion — it now deep-equals the live projection (status='due'), confirming that the two forged `field_updated` tied-timestamp events do not pollute the replay. Added a new test `WR-03: regenerate ignores field_updated events and keys off last status_changed` that explicitly verifies the scenario described in the review: `status_changed` followed by a later `field_updated` partial still yields the full live projection row.

**Status note:** "fixed" — the filter semantics match the reviewer's recommendation (option b: filter to `event_type === 'status_changed'` for the tail-snapshot approach) and the new test locks in the intended behavior.

### WR-04: regenerate test dereferences possibly-null result

**Files modified:** `src/decisions/__tests__/regenerate.test.ts`
**Commit:** e527fe3 (bundled with WR-03 — same file, same edit pass)
**Applied fix:** Added `expect(regenerated).not.toBeNull()` narrowing before `regenerated!.status` access in both the happy-path roundtrip (line ~60) and the side-path `open → withdrawn` test (line ~72-73). Also added `expect(projection).toBeDefined()` before the adjacent `projection!` access, removing the unchecked destructure. Tests now fail loudly with a clear assertion message instead of NPE'ing on accidental null.

### WR-05: chokepoint-audit regex risks false negatives and false positives

**Files modified:** `src/decisions/__tests__/chokepoint-audit.test.ts`
**Commit:** db44e4c
**Applied fix:** Two changes:
1. **Regex tightening:** Both `.update(decisions)` regexes now require `\bstatus\b\s*:` (word boundary) instead of `status\s*:`. `statusCode:` / `status_note:` no longer trigger false positives.
2. **CWD-invariant path handling:** Added `REPO_ROOT = resolve(__dirname, '..', '..', '..')` anchor so `walk()` takes an absolute `SRC_ROOT` and the lifecycle-allowlist comparison uses `relative(REPO_ROOT, f)`. Previously the test's `normalized === 'src/decisions/lifecycle.ts'` check depended on vitest running from the repo root; any other CWD would flip every lifecycle call into a violation.

**Skipped sub-item:** The reviewer also noted that re-export aliases (`import { decisions as decisionsTable }`) could bypass the audit — not fixed here because a full AST-based audit is out-of-scope for a regex-hardening pass, and the grep-based approach is explicitly scoped to "static/grep-based test" per the file's docstring. Documented as a known limitation within the existing Wave-0 design rather than a regression.

---

_Fixed: 2026-04-15T18:40:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
