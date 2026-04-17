---
phase: 17-decisions-command-accuracy-stats
fixed_at: 2026-04-17T21:45:00Z
review_path: .planning/phases/17-decisions-command-accuracy-stats/17-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-04-17
**Source review:** `.planning/phases/17-decisions-command-accuracy-stats/17-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (6 Warning + 5 Info; `fix_scope: all`)
- Fixed: 11
- Skipped: 0

All 6 warnings and all 5 info findings were addressed. IN-04 was folded into the WR-03 commit because the review explicitly marked it as "Covered by WR-03" — the `/^\d+$/` regex that rejects trailing garbage also rejects extra tokens smuggled via `rest.join(' ')`.

## Fixed Issues

### WR-01: `formatStatsBlock` per-domain "threshold not met" line ignores `lang`

**Files modified:** `src/decisions/stats.ts`
**Commit:** 3f5591c
**Applied fix:** Replaced the hardcoded English `` `  ${domain}: N=${acc.n}, threshold not met` `` line at stats.ts:386 with a 3-case switch on `lang` that returns the French (`seuil non atteint`) and Russian (`порог не достигнут`) equivalents, matching the existing localization pattern used in the overall accuracy line at lines 332-340.

### WR-02: `fetchStatsData` has no defense-in-depth validation on `windowDays`

**Files modified:** `src/decisions/stats.ts`
**Commit:** 7bb90a3
**Applied fix:** Added `Number.isInteger(windowDays) && 0 < windowDays <= 3650` guard as the first line of `fetchStatsData`. Throws a descriptive error if violated. This means a future caller that forgets the `[30,90,365]` allowlist cannot regress `sql.raw(String(windowDays))` into a SQL injection sink, and `NaN`/`Infinity`/floats are rejected at the function boundary rather than producing garbage SQL. Updated the JSDoc to document the defense-in-depth behaviour.

### WR-03: `parseInt` lenient parsing accepts `/decisions stats 30abc` as `30` (also covers IN-04)

**Files modified:** `src/bot/handlers/decisions.ts`
**Commit:** 835af89
**Applied fix:** Added `/^\d+$/.test(arg)` pre-check before `Number(arg)` parse. Replaced `parseInt(arg, 10)` with `Number(arg)` plus `Number.isInteger` check. This rejects trailing garbage (`30abc`), extra tokens (`30 extra junk` — addresses IN-04), floats, and negative numbers, while the allowlist (`validWindows.includes`) still guards the final value. Both a failed regex and an out-of-allowlist value produce the same `invalidWindowMessage(lang)` response.

### WR-04: `reclassify` handler unbounded, non-transactional, no progress reply

**Files modified:** `src/bot/handlers/decisions.ts`
**Commit:** 2fb09c6
**Applied fix:** Three changes to the reclassify branch:
1. Added `MAX_RECLASSIFY_BATCH = 200` module-level constant and an early return with new `reclassifyBatchCapMessage(lang, cap, actual)` reply when `toReclassify.length > MAX_RECLASSIFY_BATCH`.
2. Added a pre-loop `await ctx.reply(reclassifyStartedMessage(lang, toReclassify.length))` so Telegram does not time out and Greg has visibility that work is in progress.
3. Wrapped the per-decision `tx.update(decisions).set({accuracyClass, ...})` and `tx.insert(decisionEvents)` in a `db.transaction(async (tx) => {...})` block, using the same pattern as `lifecycle.ts:90` and `capture.ts:211`. Added EN/FR/RU helpers for both new messages. Admin-gate was NOT added (out of scope per the review's "worth flagging" phrasing; the D-12 Greg-scale assumption is preserved, and the cap makes it impossible to consume unbounded Haiku quota from a rogue group member).

### WR-05: `handleResolution` classification write split across two non-transactional statements

**Files modified:** `src/decisions/resolution.ts`
**Commit:** d894068
**Applied fix:** Wrapped the projection-update (lines 309-314) and classified-event-insert (lines 316-321) in a single `db.transaction(async (tx) => {...})`, mirroring the WR-04 fix. The D-11 invariant ("originals preserved via append-only event log") is now atomic on the live resolution path — a network blip or constraint error between the two statements no longer leaves a projection row without a matching event. All subsequent steps (post-mortem question generation, Pensieve writes, escalation cleanup) are unchanged and remain outside the transaction as they are not part of the event-log invariant.

### WR-06: `classifyOutcome` JSON.parse not wrapped in inner try/catch

**Files modified:** `src/decisions/resolution.ts`
**Commit:** 3103703
**Applied fix:** Replaced the bare `const parsed: unknown = JSON.parse(cleaned)` at resolution.ts:149 with an explicit `let parsed: unknown; try { parsed = JSON.parse(cleaned); } catch { logger.warn(..., 'resolution.classify.parse-error'); return 'ambiguous'; }` block. Mirrors the exact pattern from `classify-accuracy.ts:78-84`. Observability improvement: parse errors now surface as `resolution.classify.parse-error` instead of being absorbed into the outer `resolution.classify.error` label. Behaviorally still fail-closes to `ambiguous` per T-16-03.

### IN-01: Unused import `sql as pgSql` in stats.ts

**Files modified:** `src/decisions/stats.ts`
**Commit:** 8e2381b
**Applied fix:** Removed `, sql as pgSql` from the `import { db, sql as pgSql } from '../db/connection.js'` line at stats.ts:20. The `sql` import from `drizzle-orm` at line 23 already covers the needed SQL-tagged-template functionality; `pgSql` was never referenced in the file.

### IN-02: Hardcoded English `(no domain)` label in `formatStatsBlock`

**Files modified:** `src/decisions/stats.ts`
**Commit:** 3bd95e3
**Applied fix:** Extracted `noDomainLabel` as a locally-scoped switch expression in `formatStatsBlock` that returns `(aucun domaine)` for French, `(без домена)` for Russian, and `(no domain)` for English. Used as the fallback in `row.domainTag ?? noDomainLabel` when building the domain map. Completes the i18n coverage when paired with WR-01.

### IN-03: `fetchRecentDecisions` includes both `resolved` and `reviewed` — rationale undocumented

**Files modified:** `src/decisions/stats.ts`
**Commit:** fc1e327
**Applied fix:** Extended the JSDoc for `fetchRecentDecisions` to explain why both statuses are intentional (`handleResolution` populates `accuracyClass` during the `due -> resolved` transition before `handlePostmortem` runs `resolved -> reviewed`, so post-mortem-pending rows already have a class worth surfacing). Added a matching inline `// Include 'resolved' rows...` comment on the `inArray(decisions.status, ['resolved', 'reviewed'])` clause.

### IN-04: `/decisions stats` `arg` swallows extra tokens

**Files modified:** `src/bot/handlers/decisions.ts`
**Commit:** 835af89 (folded into WR-03)
**Applied fix:** Covered by the `/^\d+$/` regex introduced in WR-03. An input like `30 extra junk` produces `arg = '30 extra junk'`, which now fails the regex and returns `invalidWindowMessage(lang)`. The review explicitly said "Covered by WR-03", so this was not a separate commit — it is addressed by the same regex change.

### IN-05: `sub!.toLowerCase()` non-null assertion proliferation

**Files modified:** `src/bot/handlers/decisions.ts`
**Commit:** 6ff159e
**Applied fix:** Replaced `const [sub, ...rest] = after.split(/\s+/)` with `const [subRaw = '', ...rest] = after.split(/\s+/); const sub = subRaw.toLowerCase();` at the top of the handler, then updated all 7 branch comparisons from `sub!.toLowerCase() === '<name>'` to `sub === '<name>'`. Confirmed no `sub!` references remain in the file via grep. `sub` is now typed `string` (never `undefined`), eliminating the non-null assertion smell flagged at lines 70, 87, 103, 119, 141, 158, 173.

## Skipped Issues

None — all findings in scope were fixed.

## Testing Gate

Per the orchestrator prompt, the testing gate was:
```
bash scripts/test.sh --no-coverage \
  src/decisions/__tests__/stats.test.ts \
  src/decisions/__tests__/classify-accuracy.test.ts \
  src/decisions/__tests__/suppressions.test.ts \
  src/decisions/__tests__/decisions-command.test.ts \
  src/decisions/__tests__/resolution.test.ts
```

**Result:** All 5 listed test files are absent from the worktree. The prompt warned: "Some test files may have been removed in the 5582442 worktree merge — if a file doesn't exist, report that." Confirmed — the `src/decisions/__tests__/` directory contains only:
- `live-accountability.test.ts` (TEST-13, needs real ANTHROPIC_API_KEY)
- `synthetic-fixture.test.ts` (TEST-10/11/12)
- `vague-validator-live.test.ts` (TEST-14, needs real ANTHROPIC_API_KEY)

Vitest exit: `No test files found, exiting with code 1`.

**Fallback verification:** Ran the full worktree test suite (`scripts/test.sh --no-coverage`, Docker postgres integration). 810 tests pass across 54 files; 94 tests fail across 10 files. Every failure traces to infrastructure issues pre-existing in this worktree:
- **Live-API 401s** in `live-accountability.test.ts` and `vague-validator-live.test.ts` — these files use `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` but an invalid-but-truthy placeholder key in this env makes them run and fail 401. Not triggered by my fixes.
- **EACCES** on `@huggingface/transformers` cache dir in `contradiction-false-positive.test.ts` — `node_modules/@huggingface/transformers/.cache` is not writable by the test process. Not triggered by my fixes.

My changes span only 3 files (`src/bot/handlers/decisions.ts`, `src/decisions/resolution.ts`, `src/decisions/stats.ts`), none of which is exercised by the failing tests. `synthetic-fixture.test.ts` (which does exercise the Phase 17 surface end-to-end) passed cleanly.

**TypeScript:** `npx tsc --noEmit` exits 0 after every fix.

**Docker:** Per the durable user preference and MEMORY.md directive, the test runs above used the real postgres container via `scripts/test.sh`. No mocking was substituted for the integration harness.

## Commits

All 10 fix commits (IN-04 folded into WR-03):

```
6ff159e fix(17): IN-05 compute sub once with default, drop non-null assertions
fc1e327 fix(17): IN-03 document fetchRecentDecisions resolved+reviewed rationale
3bd95e3 fix(17): IN-02 localize (no domain) fallback label in formatStatsBlock
8e2381b fix(17): IN-01 drop unused pgSql import in stats.ts
3103703 fix(17): WR-06 explicit inner try/catch for JSON.parse in classifyOutcome
d894068 fix(17): WR-05 wrap projection-update + classified-event insert in tx in handleResolution
2fb09c6 fix(17): WR-04 add batch cap, progress reply, and tx wrap to reclassify handler
835af89 fix(17): WR-03+IN-04 reject trailing garbage in /decisions stats window arg
7bb90a3 fix(17): WR-02 add defense-in-depth windowDays guard in fetchStatsData
3f5591c fix(17): WR-01 localize per-domain threshold-not-met line in formatStatsBlock
```

---

_Fixed: 2026-04-17_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
