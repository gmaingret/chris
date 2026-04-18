---
phase: 13-schema-lifecycle-primitives
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/db/schema.ts
  - src/db/migrations/0002_decision_archive.sql
  - src/db/migrations/0003_add_decision_epistemic_tag.sql
  - src/decisions/errors.ts
  - src/decisions/lifecycle.ts
  - src/decisions/regenerate.ts
  - src/decisions/capture-state.ts
  - src/decisions/index.ts
  - scripts/test.sh
findings:
  critical: 0
  high: 0
  medium: 2
  low: 4
  info: 3
  total: 9
status: issues_found
summary: |
  Phase 13 delivers a clean, well-reasoned lifecycle chokepoint. All queries in
  lifecycle.ts and regenerate.ts use Drizzle's parameterized builders — no SQL
  injection surface. The optimistic-concurrency guard (UPDATE ... WHERE
  id=$id AND status=$fromStatus, then distinguish missing-row from stale-status
  via a follow-up SELECT) is correct under READ COMMITTED isolation and
  fail-closes to OptimisticConcurrencyError. Transaction ordering
  (UPDATE-then-INSERT inside db.transaction) preserves the append-only spirit
  atomically. Error classes correctly repair the prototype chain for instanceof
  across transpilation targets. The bigint/timestamptz round-trip in
  regenerate.ts is sound for the current column set.

  Two Medium findings flag latent correctness risks: (1) regenerate.ts's date
  rehydration list is maintained by hand and can drift if a future phase adds a
  timestamptz column to decisions (the file acknowledges this but offers no
  enforcement); (2) migrations 0002/0003 have no down-scripts and 0002 is not
  re-runnable — acceptable for forward-only Drizzle migrations but worth
  documenting. Low/Info items cover minor duplication in the barrel, a
  redundant triple-check in isAbortPhrase's regex, defensive gaps on
  non-string/non-null chat_id snapshot values, and the test.sh harness
  bypassing Drizzle's migrate runner in favor of raw psql. No Critical or High
  findings. Chokepoint invariants hold.
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-17
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (Medium-and-below only)

## Summary

Phase 13 delivers the decision lifecycle primitives at a high standard. The
single-chokepoint discipline is architecturally sound and its implementation
reflects careful reasoning about transaction ordering and concurrency. SQL
injection is structurally impossible — every query path uses Drizzle's
parameterized `eq`/`and`/`.set`/`.values` builders and no string interpolation
into SQL fragments occurs anywhere in the reviewed files. (The single `sql``
template in schema.ts is a `nextval` default with a literal argument.)

The optimistic-concurrency design is correct: under READ COMMITTED, two
concurrent `transitionDecision` calls race on the UPDATE; the first acquires
the row-lock and commits; the second finds 0 rows matching the WHERE clause
and throws `OptimisticConcurrencyError`. The post-miss SELECT correctly
separates the "row was deleted" and "row exists but status changed" cases
without inventing a fake `fromStatus`.

No Critical or High findings. Issues found are defensive / code-health items.

## Critical Issues

None.

## High Issues

None.

## Medium Issues

### MD-01: `TIMESTAMPTZ_COLUMNS` in regenerate.ts is hand-maintained and can silently drift

**File:** `src/decisions/regenerate.ts:16-26`
**Issue:** The `TIMESTAMPTZ_COLUMNS` tuple enumerates every timestamptz column
on `decisions` that needs to be rehydrated from ISO-string back to `Date` for
deep-equal parity with the live projection. The file comment warns a future
phase adding a new column must extend this list, but nothing enforces the
invariant at compile or test time. If Phase 17 or later adds, say,
`postmortem_completed_at`, the snapshot will contain it as a string and the
returned `DecisionRow` will violate its own type (string masquerading as Date).
Deep-equal tests would catch it, but only if written; the regression is
invisible to the type system because `rehydrateDates` returns `as DecisionRow`.
**Fix:** Derive the timestamptz column list from the schema programmatically,
or add a compile-time check. Minimal fix — add a self-test that reflects on
`decisions.$inferSelect` and compares against `TIMESTAMPTZ_COLUMNS`:
```ts
// In a test file:
import { getTableColumns } from 'drizzle-orm';
import { decisions } from '../../db/schema.js';
const actualTimestamptzCols = Object.entries(getTableColumns(decisions))
  .filter(([, col]) => col.dataType === 'date' && col.columnType.includes('Timestamp'))
  .map(([name]) => name);
expect(new Set(actualTimestamptzCols)).toEqual(new Set(TIMESTAMPTZ_COLUMNS));
```
This guards against drift without runtime cost.

### MD-02: Migrations 0002 and 0003 have no rollback path and 0002 is not re-runnable

**File:** `src/db/migrations/0002_decision_archive.sql`, `src/db/migrations/0003_add_decision_epistemic_tag.sql`
**Issue:** Migration 0002 creates three enum types, three tables, one FK, and
three indexes with no `IF NOT EXISTS` guards (`CREATE TYPE`, `CREATE TABLE`
without idempotency). Re-running the migration against a database that already
has these objects fails mid-stream, potentially leaving partial state.
Migration 0003 is safer (uses `ADD VALUE IF NOT EXISTS`) but still has no down
script. For forward-only Drizzle migrations this is the accepted pattern, but
it means recovery from a botched deploy (or from testing an environment with a
partial 0002) requires manual SQL intervention. `scripts/test.sh` side-steps
the issue by always starting from a fresh container, but production operators
have no similar safety net.
**Fix:** Either (a) add `IF NOT EXISTS` to the CREATE TYPE and CREATE TABLE
statements in 0002, or (b) document in the migration header that recovery
requires dropping the tables/enums manually before re-running. Option (a) is
the smaller surgical change:
```sql
CREATE TYPE IF NOT EXISTS "public"."decision_capture_stage" AS ENUM(...);
CREATE TABLE IF NOT EXISTS "decision_capture_state" (...);
```
Note: `CREATE TYPE IF NOT EXISTS` for enums requires a recent Postgres — verify
the target minimum before committing the change. Alternatively, keep the
current 0002 as an atomic forward-only checkpoint and document the recovery
procedure in the migration header.

## Low Issues

### LO-01: `isAbortPhrase` performs three overlapping checks

**File:** `src/decisions/capture-state.ts:128-142`
**Issue:** The function checks `normalized === p`, then
`normalized.startsWith(p + ' ')`, then a word-boundary regex. The regex
already covers both earlier cases (start-of-string is `^`, followed by a word
match, followed by `\s|$`). The two earlier checks are redundant
micro-optimizations that obscure intent.
**Fix:** Keep only the regex (or only the two fast-path checks if perf-critical
on hot path; since this is called once per message, simplicity wins):
```ts
export function isAbortPhrase(text: string, language: 'en' | 'fr' | 'ru'): boolean {
  const normalized = text.trim().toLowerCase();
  const phrases = language === 'en' ? ABORT_PHRASES_EN
                : language === 'fr' ? ABORT_PHRASES_FR
                : ABORT_PHRASES_RU;
  return phrases.some((p) => {
    const re = new RegExp(`(^|\\s)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
    return re.test(normalized);
  });
}
```

### LO-02: `index.ts` barrel re-exports `capture-state` helpers in two separate blocks

**File:** `src/decisions/index.ts:22-29,57`
**Issue:** Lines 22-29 export the bulk of `capture-state.ts` (getActive,
createCaptureDraft, updateCaptureDraft, clearCapture, isAbortPhrase + types).
Line 57 separately re-exports `upsertAwaitingResolution` and
`updateToAwaitingPostmortem` from the same file. The split suggests an
incremental addition but leaves a reader hunting to confirm the module's full
surface. No functional impact.
**Fix:** Consolidate the two blocks into one export group from
`./capture-state.js` for readability.

### LO-03: `rehydrateDates` only coerces `chatId` when it is a string

**File:** `src/decisions/regenerate.ts:40`
**Issue:** The check `if (typeof out['chatId'] === 'string') out['chatId'] = BigInt(...)`
handles the expected jsonb-serialized-bigint case and is correct for the
current writer (`snapshotForEvent` in lifecycle.ts stringifies bigints and
preserves `null`). However, if any future writer accidentally passes `chatId`
as a `number` (e.g., from a migration backfill), it slips through as a JS
number instead of being coerced to bigint, silently violating the
`DecisionRow` type contract (the schema declares `mode: 'bigint'`).
**Fix:** Coerce from any non-null non-bigint numeric/string form:
```ts
const ch = out['chatId'];
if (ch !== null && ch !== undefined && typeof ch !== 'bigint') {
  out['chatId'] = BigInt(ch as string | number);
}
```

### LO-04: `LEGAL_TRANSITIONS[fromStatus] ?? []` masks a real bug class

**File:** `src/decisions/lifecycle.ts:82`
**Issue:** The nullish-coalesce to `[]` guards against `fromStatus` values
outside `DecisionStatusLiteral`. Because `fromStatus` is already typed
`DecisionStatusLiteral`, the only way this branch fires is if a caller bypasses
TS (via `as any` or an untrusted source). Silently falling back to an empty
legal-list converts a programmer error into an `InvalidTransitionError`, which
the caller might interpret as a normal business-rule violation and handle as
such.
**Fix:** Either drop the `?? []` (the type system already guarantees
non-nullish lookup) or throw a distinct error if the key is unexpectedly
missing:
```ts
const legal = LEGAL_TRANSITIONS[fromStatus];
if (!legal) throw new TypeError(`Unknown decision status literal: ${fromStatus}`);
if (!legal.includes(toStatus) || fromStatus === toStatus) {
  throw new InvalidTransitionError(fromStatus, toStatus);
}
```

## Info

### IN-01: `scripts/test.sh` runs raw psql migrations, bypassing Drizzle's migrator

**File:** `scripts/test.sh:41-52`
**Issue:** The harness applies each migration file via `psql -v ON_ERROR_STOP=1`,
which correctly fails loud on SQL errors but does NOT populate
`__drizzle_migrations` bookkeeping. Tests that rely on Drizzle's migrator state
(if any are added later) would see a fresh schema but no migration history.
This is an intentional trade-off (simpler harness, no Drizzle CLI dep) and the
chokepoint-audit tests don't need migrator state — just noting the deviation.
**Fix:** None required unless a test depends on `__drizzle_migrations`.

### IN-02: Hardcoded DB password in `scripts/test.sh`

**File:** `scripts/test.sh:7`
**Issue:** `DB_URL="postgresql://chris:localtest123@localhost:5433/chris"` —
the password `localtest123` is baked into the test harness. This is acceptable
for a local-only docker-compose setup (`docker-compose.local.yml` presumably
uses the same literal), but a reader scanning for "secrets" might flag it.
Matches the broader pattern of local dev credentials; not a production
leakage.
**Fix:** None required. If secret-scanning tooling is added later, allowlist
this file or move to an env var with a default.

### IN-03: Enum `'open-draft'` uses a hyphen

**File:** `src/db/schema.ts:66`, `src/db/migrations/0002_decision_archive.sql:3`
**Issue:** Postgres enum values are unquoted string literals; `'open-draft'`
is valid but unusual (underscore convention is more common for machine
identifiers). No functional problem — Drizzle handles it correctly and the
literal round-trips through jsonb and Drizzle's type inference.
**Fix:** None required. Locked per D-04 design decision.

---

_Reviewed: 2026-04-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
