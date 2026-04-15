---
phase: 13-schema-lifecycle-primitives
reviewed: 2026-04-15T00:00:00Z
depth: standard
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
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-15
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

The phase delivers the schema + lifecycle chokepoint cleanly: migrations, enums, indexes, and the `transitionDecision` chokepoint form a tight, auditable surface. The UPDATE-first-then-INSERT design inside a single transaction is sound and the test coverage (legal/illegal/terminal/not-found/stale/concurrency/replay) is thorough.

One critical bug is a latent BigInt serialization crash when a `decisions` row with a non-null `chat_id` transitions — JSON.stringify throws on bigint, which will abort the event INSERT and roll back the transition. Five warnings cover silent error swallowing in `scripts/test.sh`, fragility in the chokepoint audit regex, a potential NPE in a replay test, the readiness loop never failing, and a documented-but-real mismatch between `regenerateDecisionFromEvents`'s return contract and what it returns when the last event is not a status event. Info items are minor.

## Critical Issues

### CR-01: BigInt snapshot will crash transitionDecision when chat_id is set

**File:** `src/decisions/lifecycle.ts:109`
**Issue:** The snapshot is written as `updated[0]! as unknown as object`. Drizzle returns `chatId` as a JS `bigint` (the column is declared `bigint('chat_id', { mode: 'bigint' })` in `schema.ts:240`). When drizzle/postgres.js serializes the value into the `jsonb` column it calls `JSON.stringify`, which throws `TypeError: Do not know how to serialize a BigInt` for bigint values. Any decision with a non-null `chat_id` will therefore throw at the `tx.insert(decisionEvents)` step, rolling back the transition.

The tests do not exercise this path: every `seedDecision` helper in `lifecycle.test.ts`, `concurrency.test.ts`, and `regenerate.test.ts` omits `chatId`, so the bug is invisible today. `capture-state.test.ts` does insert a `chatId` into `decisionCaptureState`, but never runs a transition. Phase 14 (capture → open) will be the first consumer that flips a chat-scoped decision and will hit this.

Interestingly, `regenerate.ts:40` already knows about this ("jsonb cannot store bigint natively; if the snapshot carries it as a string, coerce back"), which implies the author expected stringification to happen — but there is no such stringification on the write path.

**Fix:**
```ts
// lifecycle.ts — coerce bigint fields (and any future ones) before stringifying.
function snapshotForEvent(row: typeof decisions.$inferSelect): object {
  return {
    ...row,
    chatId: row.chatId === null ? null : row.chatId.toString(),
  };
}
// ...
await tx.insert(decisionEvents).values({
  decisionId: id,
  eventType: 'status_changed',
  fromStatus,
  toStatus,
  snapshot: snapshotForEvent(updated[0]!),
  actor,
});
```
Add a regression test that seeds a decision with `chatId: 123n`, transitions it, and asserts both the event insert succeeds and `regenerateDecisionFromEvents` deep-equals the live projection (to confirm round-trip including the `regenerate.ts:40` BigInt rehydration).

## Warnings

### WR-01: test.sh swallows migration errors with 2>/dev/null

**File:** `scripts/test.sh:31-35`
**Issue:** Each `psql` invocation redirects stderr to `/dev/null`. Combined with `cat file | psql` (where `cat` always succeeds and psql is not run with `ON_ERROR_STOP=1`), a failing migration prints no error and the script proceeds to run vitest against a half-migrated schema. The tests then fail with confusing schema-mismatch errors instead of a clean migration error. `set -euo pipefail` does not help because `psql` exits 0 by default on SQL errors.

**Fix:**
```bash
# Remove 2>/dev/null and force psql to exit non-zero on SQL errors.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_SQL"
```
Apply the same `-v ON_ERROR_STOP=1` and drop `2>/dev/null` on all four migration lines and the `CREATE EXTENSION` line. Per project memory ("Always run full Docker tests"), surfacing migration failures loudly is important.

### WR-02: pg_isready loop never fails the script when postgres stays down

**File:** `scripts/test.sh:23-28`
**Issue:** The `for i in $(seq 1 30)` loop breaks on success but has no `else` branch for exhaustion. If postgres never comes up, the loop finishes silently and the script proceeds to the migration step, which then errors with a connection refused that — combined with WR-01 — is also silenced. The `trap cleanup EXIT` runs, postgres is stopped, and CI sees a cryptic vitest failure instead of "postgres never came up".

**Fix:**
```bash
ready=0
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec postgres pg_isready -U chris -d chris -q 2>/dev/null; then
    ready=1; break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "❌ postgres failed to become ready after 30s" >&2
  exit 1
fi
```

### WR-03: regenerateDecisionFromEvents return type is misleading for non-status last-events

**File:** `src/decisions/regenerate.ts:56-67`
**Issue:** The return type is `Promise<DecisionRow | null>`, but when the last event for a decision is not a `status_changed` event (e.g. a `field_updated` event whose snapshot is a partial payload), the function returns the raw `last.snapshot` cast to `DecisionRow`. The cast is unsound — Phase 14+ will write `field_updated` events with partial snapshots, and a regenerate call that happens to hit such an event as the tail will return a malformed "row" that type-asserts as complete but is missing required fields.

`regenerate.test.ts:86-113` already surfaces this: it inserts two `field_updated` rows with `{marker: 'first'}` / `{marker: 'second'}` and the assertion is softened to `expect(regenerated).toBeDefined()` with a comment noting the function "uses last status_changed event as status anchor" — but the implementation does **not** filter by event type; it replays and takes the final event unconditionally.

This is currently a latent correctness issue that will bite once `field_updated` events land in Phase 14.

**Fix:** Either (a) document and enforce that callers only invoke this during Phase 13-style status-only histories, or (b) replay semantics: start from a base snapshot and fold each event's `snapshot` into the accumulator — or at minimum, filter to `eventType === 'status_changed'` for the tail-snapshot approach. Add a test that writes a `status_changed` event followed by a `field_updated` partial event and asserts the returned row still deep-equals the live projection.

### WR-04: regenerate test dereferences possibly-null result

**File:** `src/decisions/__tests__/regenerate.test.ts:61,72-73`
**Issue:** `regenerateDecisionFromEvents` has signature `Promise<DecisionRow | null>`, but the test writes `regenerated.status` and `expect(regenerated.status).toBe('reviewed')` without narrowing. In strict TS this fails typecheck; in loose mode it will NPE at runtime if the function ever returns null (e.g. due to WR-03 edge cases or a concurrent events deletion). The adjacent `[projection]` destructure also lacks a length check.

**Fix:**
```ts
const regenerated = await regenerateDecisionFromEvents(id);
expect(regenerated).not.toBeNull();
expect(regenerated!.status).toBe('reviewed');
```

### WR-05: chokepoint-audit regex risks false negatives and false positives

**File:** `src/decisions/__tests__/chokepoint-audit.test.ts:39-42`
**Issue:** The guard regex `/\.update\(\s*decisions\s*\)[\s\S]{0,200}?status\s*:/` has two weaknesses:

1. **False positive risk:** the 200-char window after `.update(decisions)` will match any `.set({ someField: ..., statusCode: ... })` call (200 chars is enough for nested objects), because `status\s*:` matches `statusCode:`. A future caller legitimately updating `statusCode` or `status_note` (on an adjacent object) would trip the audit.
2. **False negative risk:** the test skips files under `__tests__/` (line 22), which is fine, but also only inspects the literal string `decisions`. Any re-export alias (e.g. `import { decisions as decisionsTable }`) bypasses the check silently.

Also note the test excludes `migrations/` but the `join` produces forward slashes on Linux and the comparison `normalized === 'src/decisions/lifecycle.ts'` depends on the CWD being the repo root — if tests run from a different CWD the `src/` prefix differs and the lifecycle allowlist breaks (every call in lifecycle.ts would become a violation).

**Fix:** Tighten the regex to require word-boundary (`\bstatus\b\s*:`) and either switch to an AST/TS-compiler-based audit for robustness, or add a comment enforcing CWD invariant and use `path.relative(repoRoot, f)` for the allowlist check.

## Info

### IN-01: Commented guidance in schema.ts references non-existent column scan

**File:** `src/db/schema.ts:16-17`
**Issue:** The comment in `regenerate.ts:13-14` ("grep timestamp(.*withTimezone between the `decisions` table declaration boundaries") is a manual maintenance instruction. Nothing enforces that new timestamptz columns get added to `TIMESTAMPTZ_COLUMNS` in `regenerate.ts:16`. If Phase 17's `accuracyClassifiedAt` had been added to schema but forgotten in the rehydrate list, the `toEqual(projection)` assertion in `regenerate.test.ts:59` would fail mysteriously (Date vs string).
**Fix:** Consider deriving the column list via Drizzle's metadata at runtime, e.g. iterate `getTableColumns(decisions)` and pick columns whose `dataType === 'date'` (or equivalent). Minor — the current list is complete as of this phase.

### IN-02: Migration 0003 comment is missing

**File:** `src/db/migrations/0003_add_decision_epistemic_tag.sql:1`
**Issue:** The one-line migration `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'DECISION'` has no header comment explaining why it is separate from 0002. Future maintainers may wonder; Postgres requires `ADD VALUE` to be outside a transaction block, which is likely the reason and is worth recording inline.
**Fix:** Prepend `-- Separate migration: ALTER TYPE ... ADD VALUE cannot run inside a txn block.`

### IN-03: TIMESTAMPTZ_COLUMNS coercion does not handle malformed strings

**File:** `src/decisions/regenerate.ts:34-35`
**Issue:** `new Date(v)` silently produces `Invalid Date` (a Date whose `getTime()` is NaN) for malformed strings. A corrupted snapshot will round-trip as an Invalid Date rather than throwing, which will fail the `toEqual` assertion in tests but give no diagnostic.
**Fix:** Add a sanity check `if (Number.isNaN(d.getTime())) throw new Error(...)` after coercion, or at least log a warning.

### IN-4: Actor values are untyped on the DB side

**File:** `src/db/schema.ts:260`
**Issue:** `decision_events.actor` is `varchar(32)` with a comment listing the allowed values but no CHECK constraint or enum. The TS type `ActorKind` in `lifecycle.ts:27` enforces it on the write path, but any future raw SQL insert (e.g. test data forges like `regenerate.test.ts:87-93`) could write arbitrary strings without the DB noticing.
**Fix:** Consider promoting `actor` to a `pgEnum` in a future migration, or at minimum a `CHECK (actor IN (...))` constraint. Not blocking for Phase 13.

---

_Reviewed: 2026-04-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
