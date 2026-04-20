---
phase: 20-schema-tech-debt
fixed_at: 2026-04-18T00:00:00Z
review_path: .planning/phases/20-schema-tech-debt/20-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 4
skipped: 5
status: partial
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-04-18
**Source review:** `.planning/phases/20-schema-tech-debt/20-REVIEW.md`
**Iteration:** 1

**Summary:**
- In-scope findings (warnings): 3
- Fixed: 4 (all 3 warnings + IN-03 as a trivial, same-file cleanup commit)
- Skipped: 5 (IN-01, IN-02, IN-04, IN-05, IN-06 — stylistic nits or non-trivial hardening refactors outside scope)

## Fixed Issues

### WR-02: `set -e` + `trap EXIT` cleanup can swallow real 0005 snapshots

**Files modified:** `scripts/regen-snapshots.sh`
**Commit:** `4950f2b`
**Applied fix:** Introduced a `REGEN_PRODUCED_0005=0` flag at script top-level, set to `1` only immediately before the acceptance-gate `drizzle-kit generate` invocation. The EXIT trap gates the `find ... 0005_snapshot.json -delete` behind this flag, so re-running the script after Plan 20-02's committed snapshot landed no longer nukes the real file. Added a comment explaining the historical hazard.

### WR-03: `introspect_to()` loses diagnostic output on drizzle-kit failure

**Files modified:** `scripts/regen-snapshots.sh`
**Commit:** `a46c8b0`
**Applied fix:** Replaced the `|| true` swallowing of drizzle-kit introspect's exit code with explicit `set +e; (subshell); local rc=$?; set -e;` capture. On non-zero rc, log the actual exit code plus the working directory and return the exit status. The "did not produce a snapshot" case is now clearly distinguishable from "introspect itself failed".

### WR-01: `beforeAll` existence probe is effectively tautological + IN-03: `PgLikeError` duplication

**Files modified:** `src/episodic/__tests__/schema.test.ts`
**Commit:** `66d8755`
**Applied fix:**
- Replaced the `SELECT 1 FROM episodic_summaries LIMIT 0` + `Array.isArray` probe with a positive `information_schema.tables` existence assertion. The new probe survives future postgres.js return-shape drift on `LIMIT 0` and anchors the assertion to the actual table name, not the query shape.
- Hoisted the `PgLikeError` type alias from both `it()` bodies to module scope, next to `mkSummary`. The UNIQUE and CHECK tests now share one declaration (IN-03 trivial cleanup; same-file co-land with WR-01).

Verified: `npx vitest run src/episodic/__tests__/schema.test.ts src/episodic/__tests__/types.test.ts` → 2 files / 10 tests passed.

## Skipped Issues

### IN-01: `.notNull().defaultNow()` order inconsistent

**File:** `src/db/schema.ts:330`
**Reason:** Stylistic nit — functionally identical; drizzle chain is commutative. Reviewer explicitly noted "minor style drift". Out of scope.

### IN-02: `source_entry_ids` lacks `.min(1)` despite "non-empty in practice" comment

**File:** `src/episodic/types.ts:37`
**Reason:** Reviewer flagged this as requiring an "explicit-decision confirmation" — the current state (upstream-only enforcement by `runConsolidate`) is documented and consistent with the D-07 write-side-enforcement pattern. Adding `.min(1)` is a behavior change that may reject legitimate operator flows (OPS-01 backfill edge cases for zero-entry days). Deferred to explicit user judgment.

### IN-04: `beforeEach` deletes without WHERE clause

**File:** `src/episodic/__tests__/schema.test.ts:48`
**Reason:** Reviewer explicitly said "Not strictly required today" — "a very soft nit". The existing inline comment already covers the rationale. Out of scope.

### IN-05: `--check-only` is only recognized flag

**File:** `scripts/regen-snapshots.sh:58-61`
**Reason:** Script-ergonomics nit. Non-trivial refactor (adding case-statement with help text) and the script is rarely invoked — silent acceptance of unknown flags is a known shell pattern. Out of scope.

### IN-06: `node -e` with shell-interpolated paths is theoretically injectable

**File:** `scripts/regen-snapshots.sh:169-176, 191-200, 182, 205`
**Reason:** Reviewer explicitly flagged this as "no urgency — inputs are currently sanitized-by-construction. Flagging as a hardening opportunity for a script that may be extended later." Not a present vulnerability; defensive refactor for future-proofing. Out of scope.

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
