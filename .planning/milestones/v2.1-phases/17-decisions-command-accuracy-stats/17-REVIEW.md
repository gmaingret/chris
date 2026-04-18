---
phase: 17-decisions-command-accuracy-stats
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/decisions/classify-accuracy.ts
  - src/decisions/stats.ts
  - src/decisions/suppressions.ts
  - src/decisions/resolution.ts
  - src/bot/handlers/decisions.ts
findings:
  critical: 0
  warning: 6
  info: 5
  total: 11
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-04-17
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 17 delivers a clean, well-structured implementation of the `/decisions` surface with sound anti-sycophancy discipline: N<10 is enforced in `computeAccuracy` and honored by both `formatDashboard` and `formatStatsBlock`; Wilson CI math is correct and correctly divides both center and margin by the denominator (Pitfall 1 from RESEARCH.md); classification is cached in projection columns and recomputed only at resolve/reclassify time; every DB query is chatId-scoped (no cross-chat leaks); the sub-command dispatch is tidy.

No Critical findings. The pre-flagged `sql.raw(String(windowDays))` in `fetchStatsData` is safe in current call paths because every caller runs the [30,90,365] allowlist check first and the parameter is typed `number`. However, `fetchStatsData` is an exported function with no defense-in-depth guard; a future caller that forgets the allowlist could regress it into an injection sink. Promoted to WR-02 rather than Critical since no current caller is unsafe.

Main Warnings: partial i18n coverage in `formatStatsBlock` (per-domain "threshold not met" at `stats.ts:386` is English-only — pre-flagged WR-02 from context); `parseInt` lenient parsing accepts "30abc" as 30; reclassify handler is an unbounded sequential loop of Haiku calls with no admin gate, no progress reply, and no batch cap; `resolution.ts` writes the projection update + `classified` event as two separate non-transactional statements; `resolution.ts:149` `JSON.parse` has no inner try/catch unlike `classify-accuracy.ts:79-84` — behaviorally safe (outer catch absorbs it) but inconsistent.

Info items are style/cleanup: unused `pgSql` import, hardcoded English `(no domain)` label, non-null assertion proliferation.

## Warnings

### WR-01: `formatStatsBlock` per-domain "threshold not met" line ignores `lang` parameter

**File:** `src/decisions/stats.ts:386`
**Issue:** The overall accuracy line is properly localized across EN/FR/RU at lines 332-340, but the per-domain iteration at line 386 hardcodes English: `` lines.push(`  ${domain}: N=${acc.n}, threshold not met`); ``. Greg reading `/decisions stats` in French gets a French header followed by an English per-domain breakdown when any domain is below N<10. This was called out in the context prompt as a known gap.
**Fix:**
```typescript
if (acc.belowFloor) {
  const thresholdLabel = (() => {
    switch (lang) {
      case 'fr': return `N=${acc.n}, seuil non atteint`;
      case 'ru': return `N=${acc.n}, порог не достигнут`;
      default: return `N=${acc.n}, threshold not met`;
    }
  })();
  lines.push(`  ${domain}: ${thresholdLabel}`);
}
```

### WR-02: `fetchStatsData` has no defense-in-depth validation on `windowDays`

**File:** `src/decisions/stats.ts:93-107`
**Issue:** The SQL fragment at line 104 uses `sql.raw(String(windowDays))` to splice the window into the interval literal: `` sql`now() - interval '${sql.raw(String(windowDays))} days'` ``. In the current call sites (`decisions.ts:56` hardcodes 90, `decisions.ts:131` runs the `[30, 90, 365]` allowlist at lines 120-128) this is safe because `windowDays` is always a trusted integer. But `fetchStatsData` is an exported function whose JSDoc only *asks* callers to pre-validate (line 91). A future caller that forgets — or accepts an int from another input path — would produce a direct SQL injection sink. TypeScript's `number` type does not prevent `NaN`, `Infinity`, or floats from slipping through either. Defense-in-depth: assert inside the function.
**Fix:**
```typescript
export async function fetchStatsData(chatId: bigint, windowDays: number): Promise<StatsRow[]> {
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 3650) {
    throw new Error(`fetchStatsData: windowDays must be a positive integer <= 3650, got ${windowDays}`);
  }
  return db.select({ /* ... */ })
    // ...
}
```

### WR-03: `parseInt` lenient parsing accepts `/decisions stats 30abc` as `30`

**File:** `src/bot/handlers/decisions.ts:123-128`
**Issue:** `parseInt('30abc', 10)` returns `30`, which then passes `validWindows.includes(30)`. Greg typing `/decisions stats 30days` silently gets the 30-day window instead of the error message. `NaN` is correctly rejected by `includes`, but trailing-garbage inputs are not. Minor UX issue; not a security problem.
**Fix:**
```typescript
if (arg) {
  if (!/^\d+$/.test(arg)) {
    await ctx.reply(invalidWindowMessage(lang));
    return;
  }
  const parsed = parseInt(arg, 10);
  if (!validWindows.includes(parsed)) {
    await ctx.reply(invalidWindowMessage(lang));
    return;
  }
  windowDays = parsed;
}
```

### WR-04: `reclassify` handler is unbounded, non-transactional, no progress reply, no admin gate

**File:** `src/bot/handlers/decisions.ts:173-231`
**Issue:** The handler fetches *all* reviewed decisions for this chat and runs two sequential Haiku calls per decision (`classifyOutcome` + `classifyAccuracy`, each with a 5s timeout). For N=20 that is up to 200s worst case; Telegram replies can time out and the user sees nothing until completion. There is also no admin gate — any chat member in a group chat could trigger the full reclassify cycle, consuming Haiku quota. The plan (D-12) correctly notes "Greg-scale (<=20 decisions) makes optimization unnecessary", but the absence of a batch cap, progress heartbeat, or allowlist check is worth flagging because nothing prevents the scale assumption from breaking.

Additionally, the classify event insert at line 215 and the projection update at line 206 are two separate statements; if the event insert fails after the update succeeds, the `decisions.accuracy_class` column is updated without a matching event record, breaking the D-11 invariant "originals preserved via append-only event log".
**Fix:** Add an upper bound and wrap the per-decision writes in a drizzle transaction:
```typescript
const MAX_RECLASSIFY_BATCH = 200;
if (toReclassify.length > MAX_RECLASSIFY_BATCH) {
  await ctx.reply(reclassifyBatchCapMessage(lang, MAX_RECLASSIFY_BATCH));
  return;
}
// send an "in progress" reply so Telegram does not drop the connection
await ctx.reply(reclassifyStartedMessage(lang, toReclassify.length));

for (const d of toReclassify) {
  const outcome = await classifyOutcome(d.resolution!, d.prediction, d.falsificationCriterion);
  const reasoning = await classifyAccuracy(outcome, d.resolution!, d.prediction);
  const accuracyClass = `${outcome}/${reasoning}`;
  await db.transaction(async (tx) => {
    await tx.update(decisions).set({
      accuracyClass, accuracyClassifiedAt: new Date(),
      accuracyModelVersion: HAIKU_MODEL, updatedAt: new Date(),
    }).where(eq(decisions.id, d.id));
    await tx.insert(decisionEvents).values({
      decisionId: d.id, eventType: 'classified',
      snapshot: { accuracyClass, accuracyModelVersion: HAIKU_MODEL,
                  reclassifiedAt: new Date().toISOString() },
      actor: 'system',
    });
  });
  count++;
}
```

### WR-05: `handleResolution` classification write is split across two non-transactional statements

**File:** `src/decisions/resolution.ts:309-321`
**Issue:** Same transactional gap as WR-04 but on the live resolution path: the `UPDATE decisions SET accuracy_class = ...` at 309-314 and the `INSERT INTO decision_events` at 316-321 are independent queries. If the event insert fails (network blip, constraint error), the projection row shows a class that has no corresponding `classified` event, silently breaking the audit trail D-11 promises. The already-written resolution and transition events remain valid, so user-facing behavior does not regress, but the event log loses its "append-only source of truth" property for this decision.
**Fix:**
```typescript
await db.transaction(async (tx) => {
  await tx.update(decisions).set({
    accuracyClass, accuracyClassifiedAt: new Date(),
    accuracyModelVersion: HAIKU_MODEL, updatedAt: new Date(),
  }).where(eq(decisions.id, decisionId));
  await tx.insert(decisionEvents).values({
    decisionId, eventType: 'classified',
    snapshot: { accuracyClass, accuracyModelVersion: HAIKU_MODEL },
    actor: 'system',
  });
});
```

### WR-06: `classifyOutcome` JSON.parse is not wrapped in an inner try/catch (inconsistency with `classifyAccuracy`)

**File:** `src/decisions/resolution.ts:149`
**Issue:** Pre-flagged in context as CR-01. `classify-accuracy.ts:79-84` wraps `JSON.parse(cleaned)` in a dedicated try/catch and logs `accuracy.classify.parse-error` before fail-closing to `unknown`. `resolution.ts:149` calls `JSON.parse(cleaned)` at the top level; a malformed response throws a `SyntaxError` that is caught by the outer `catch (error)` at line 168 and logged as `resolution.classify.error` with the raw error message. Behaviorally this is *safe* — the function still fail-closes to `ambiguous` (T-16-03), which is the required behavior — but the observability is poorer (no dedicated parse-error log label) and the two classifiers in the same codebase diverge in structure for no reason. Promoted from the pre-flagged Critical to Warning because the outer catch does absorb it and the function satisfies its contract.
**Fix:** Mirror the pattern from `classify-accuracy.ts:78-84`:
```typescript
let parsed: unknown;
try {
  parsed = JSON.parse(cleaned);
} catch {
  logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.parse-error');
  return 'ambiguous';
}
```

## Info

### IN-01: Unused import `sql as pgSql` in stats.ts

**File:** `src/decisions/stats.ts:20`
**Issue:** `import { db, sql as pgSql } from '../db/connection.js';` is shadowed by the next line `import { sql } from 'drizzle-orm';` and `pgSql` is never referenced in the file. Dead import.
**Fix:** `import { db } from '../db/connection.js';`

### IN-02: Hardcoded English `(no domain)` label in `formatStatsBlock`

**File:** `src/decisions/stats.ts:367`
**Issue:** `const domain = row.domainTag ?? '(no domain)';` always renders in English regardless of `lang`. Paired with WR-01, the FR/RU per-domain block has two English artifacts: the fallback label and the threshold-not-met line.
**Fix:** Pass `lang` into a helper that returns `'(aucun domaine)'` / `'(без домена)'` / `'(no domain)'` as appropriate.

### IN-03: `fetchRecentDecisions` includes both `resolved` and `reviewed` — worth documenting intent

**File:** `src/decisions/stats.ts:168`
**Issue:** `inArray(decisions.status, ['resolved', 'reviewed'])` is correct: `handleResolution` populates `accuracyClass` during the `due → resolved` transition (lines 309-314) *before* `handlePostmortem` runs the `resolved → reviewed` transition. So a `resolved` row with post-mortem pending already has a class and should surface in `/decisions recent`. Not a bug; just non-obvious. A one-line comment would save a future reader 10 minutes.
**Fix:**
```typescript
// Include 'resolved' rows (post-mortem pending) so accuracy shows in
// /decisions recent even before Greg answers the follow-up question.
```

### IN-04: `/decisions stats` `arg` swallows extra tokens

**File:** `src/bot/handlers/decisions.ts:66-67,122`
**Issue:** `rest.join(' ').trim()` concatenates everything after `stats` into `arg`. `/decisions stats 30 extra junk` yields `arg = '30 extra junk'`, `parseInt` reads 30, passes. Combined with WR-03, the handler silently accepts ill-formed input. Fixed by the `/^\d+$/` regex in WR-03.
**Fix:** Covered by WR-03.

### IN-05: `sub!.toLowerCase()` non-null assertion proliferation

**File:** `src/bot/handlers/decisions.ts:70,87,103,119,141,158,173`
**Issue:** After the `if (!after) { ... return; }` guard at line 53, `after` is non-empty, so `after.split(/\s+/)` produces at least one element and `sub` is defined. The `sub!` assertions are safe but scattered across seven call sites. Computing once with a default makes the later code cleaner and removes the need for the assertion.
**Fix:**
```typescript
const [subRaw = '', ...rest] = after.split(/\s+/);
const sub = subRaw.toLowerCase();
// ... then use `sub === 'open'` everywhere, no `.toLowerCase()` repeated.
```

---

_Reviewed: 2026-04-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
