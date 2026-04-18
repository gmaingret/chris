---
phase: 16-resolution-post-mortem-accountability-mode
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/decisions/resolution.ts
  - src/chris/personality.ts
  - src/chris/praise-quarantine.ts
  - src/chris/engine.ts
  - src/pensieve/retrieve.ts
  - src/decisions/capture-state.ts
  - src/llm/prompts.ts
  - src/proactive/state.ts
  - src/proactive/prompts.ts
  - src/proactive/sweep.ts
  - src/decisions/index.ts
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-04-17T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Re-review of Phase 16 deliverables after Phase 19's restoration of `src/proactive/*` (state.ts, prompts.ts, sweep.ts). Core resolution/post-mortem flow in `resolution.ts` is well-structured: fail-closed Haiku classification, awaited Pensieve writes (testable), OptimisticConcurrencyError handled with decision re-read, language threaded through `getLastUserLanguage` with explicit normalization. ACCOUNTABILITY mode is cleanly wired into `ChrisMode`, `buildSystemPrompt`, and `praise-quarantine` bypass (D-25 pattern). The Hard Rule (D027) is explicitly encoded in `ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT`. Escalation block (sweep.ts:176-261) correctly runs outside the daily cap, uses 48h hours-based timing, branches on count (1 → followup, ≥2 → stale), and calls `clearEscalationKeys` + `clearCapture` on stale transition.

One residual bug escaped the earlier CR-02 fix: `handleResolution` line 211 (decision-not-found fallback) still passes an unnormalized full-name language ('English'/'French'/'Russian') directly into `notedAck()`, which switches on short codes. French/Russian users get the English default on this specific error path. Other findings are minor: the stale-transition uses `'due' → 'stale'` but the decision may already be `resolved`; a `sentAt === null` branch in the escalation loop is effectively dead code post-restoration since the accountability channel always seeds escalation keys; and `JSON.parse(cleaned)` at resolution.ts:149 relies on the outer try/catch rather than an inner one (pre-existing CR-01 note). Dynamic `clearEscalationKeys` imports with `typeof` guards at :336 and :394 are now dead-code safety nets — the symbol is statically available post-Phase-19.

## Critical Issues

### CR-01: Decision-not-found fallback in handleResolution passes full language name to notedAck

**File:** `src/decisions/resolution.ts:211`
**Issue:** The previous CR-02 fix (commit e84e281) normalized the language to short codes in the main flow (lines 215-219), but the earlier decision-not-found exit branch at line 211 was missed. `getLastUserLanguage(chatId.toString())` returns `'English' | 'French' | 'Russian' | null`. The `?? 'en'` only kicks in when it's `null`; when a French user's session has `'French'` cached, that string is passed straight into `notedAck()`, whose `switch` only matches `'fr' | 'ru'`, so it falls through to the `default: "Noted."` (English). French/Russian users who reply to a resolution prompt for a since-deleted decision receive an English acknowledgment.

This is the exact same root cause as CR-02 from the prior review — the normalization is missing on this branch.

**Fix:**
```typescript
const decision = rows[0];
if (!decision) {
  logger.warn({ decisionId }, 'resolution.decision-not-found');
  const rawLang = getLastUserLanguage(chatId.toString()) ?? 'English';
  const langCode = rawLang === 'French' ? 'fr' : rawLang === 'Russian' ? 'ru' : 'en';
  return notedAck(langCode);
}
```
Alternative: hoist the normalization above the `if (!decision)` check so both paths share one `detectedLanguage`.

## Warnings

### WR-01: Stale transition assumes 'due' status but decision may be 'resolved'

**File:** `src/proactive/sweep.ts:211`
**Issue:** The escalation block calls `transitionDecision(row.decisionId, 'due', 'stale', { actor: 'sweep' })` when `count >= 2`. This assumes the decision is still in `'due'` status. However, a race is possible: Greg replies between the escalation check and this line, `handleResolution` runs `due → resolved` (line 268 in resolution.ts), and the sweep then tries `due → stale` which fails with `InvalidTransitionError` or `OptimisticConcurrencyError`. The `try/catch` at line 212-214 logs a warning but the flow still proceeds to `clearCapture(row.chatId)` at line 216, which would delete Greg's now-valid AWAITING_POSTMORTEM capture state and silently break the post-mortem flow.

Mitigating factors: (a) the catch block does continue, so the post-mortem question has already been sent by handleResolution before clearCapture runs; (b) `clearCapture` would wipe AWAITING_POSTMORTEM, meaning Greg's next reply routes to JOURNAL instead of `handlePostmortem`. This is a real UX bug under a narrow race window.

**Fix:** Re-read the decision row before transitioning, and skip the transition + clearCapture if status has moved off `'due'`:
```typescript
if (count >= 2) {
  const [current] = await db.select({ status: decisions.status })
    .from(decisions).where(eq(decisions.id, row.decisionId)).limit(1);
  if (current?.status !== 'due') {
    // Greg replied between escalation window and this tick — leave post-mortem flow intact
    await clearEscalationKeys(row.decisionId);
    continue;
  }
  try { await transitionDecision(row.decisionId, 'due', 'stale', { actor: 'sweep' }); } ...
}
```

### WR-02: Sweep escalation `sentAt === null` branch is effectively dead code

**File:** `src/proactive/sweep.ts:193-199`
**Issue:** The accountability channel (lines 152-154) already seeds `setEscalationSentAt(decisionId, new Date())` and `setEscalationCount(decisionId, 1)` immediately after sending the first prompt. In the escalation loop, `sentAt === null` can only occur if: (a) an AWAITING_RESOLUTION row exists from a prior process lifetime where escalation keys were never set (pre-Phase-16 data), or (b) escalation keys were cleared but the capture state wasn't. The "just record timestamp" fallback at lines 196-197 will cause the escalation clock to reset — a decision that has been awaiting for 72 hours before Phase 16 rollout would get a fresh 48h timer instead of immediate follow-up or staleness.

The code was originally written when the initial-prompt seeding (line 153-154) hadn't been added.

**Fix:** Either remove the branch entirely or treat `sentAt === null` as "unknown, assume recent" by setting count to the known value from state rather than resetting to 1:
```typescript
if (sentAt === null) {
  // Legacy row without escalation keys — seed with current count or 1, preserve it
  const currentCount = await getEscalationCount(row.decisionId);
  await setEscalationSentAt(row.decisionId, new Date());
  if (currentCount === 0) await setEscalationCount(row.decisionId, 1);
  continue;
}
```

### WR-03: Escalation follow-up sends via bot.api but does not update setLastSentAccountability

**File:** `src/proactive/sweep.ts:249-255`
**Issue:** The follow-up send at lines 249-255 calls `bot.api.sendMessage` and `saveMessage` but does not call `setLastSentAccountability(new Date())`. This is intentional per D-17 comment ("runs outside the daily cap"), but it means two accountability messages can fire on the same day: one initial at the morning tick (setLastSentAccountability called), then Greg's older decision escalates the same afternoon tick (no cap). That may be desired behavior, but it diverges from the "one accountability outreach per day" invariant implied elsewhere and isn't documented at the call site.

**Fix:** Either add a code comment explicitly stating "escalation follow-ups intentionally bypass the daily cap per D-17/D-18" at line 249, or call `setLastSentAccountability` to tighten the invariant. Recommend the comment — the escalation-outside-cap behavior is planned (see `proactive.sweep.escalation.*` log lines) but the intent should be obvious to future readers.

## Info

### IN-01: Dynamic `clearEscalationKeys` import with typeof guard is now dead-code safety

**File:** `src/decisions/resolution.ts:334-345` and `:393-404`
**Issue:** Both call sites use `await import('../proactive/state.js')` with `typeof clearEscalationKeys === 'function'` guards, written defensively when Phase 16's `proactive/*` files were temporarily missing post-merge. Phase 19's restoration (f8ea66f) brought back `state.ts` with `clearEscalationKeys` exported statically at line 168. The dynamic import + typeof guard now adds an unnecessary async hop and couples resolution.ts to module-loader semantics.

**Fix (optional cleanup, non-blocking):** Replace with a static top-level import:
```typescript
import { clearEscalationKeys } from '../proactive/state.js';
// ...
void clearEscalationKeys(decisionId).catch(() => {
  // best-effort cleanup
});
```
Keep this deferred unless touching resolution.ts for another reason — the current code works correctly.

### IN-02: JSON.parse(cleaned) not wrapped in inner try/catch

**File:** `src/decisions/resolution.ts:149`
**Issue:** (Carried forward from the earlier CR-01 note in prior review rounds.) The `JSON.parse(cleaned)` call at line 149 relies on the outer `try/catch` at line 126/168 for fail-closed behavior. This is correct — parse errors return `'ambiguous'` — but the call is physically distant from the catch, and the outer catch also swallows timeouts, network errors, and missing-text errors with the same `'ambiguous'` fallback, which makes debugging harder (the log message `resolution.classify.error` covers four distinct failure modes).

**Fix:** Optionally tighten with an inner try/catch for parse-specific logging:
```typescript
let parsed: unknown;
try { parsed = JSON.parse(cleaned); }
catch (e) {
  logger.warn({ cleaned: cleaned.slice(0, 200) }, 'resolution.classify.parse-error');
  return 'ambiguous';
}
```

### IN-03: getTemporalPensieve has no MIN row filter if entries are empty

**File:** `src/pensieve/retrieve.ts:102-135`
**Issue:** `getTemporalPensieve(centerDate, windowMs)` returns up to 50 rows within ±windowMs. The `limit(50)` is a sensible cap but silently truncates if there are >50 entries in the window. For a 48h window this is likely fine, but there is no log indicator that truncation occurred. A user with a high-volume day on the resolve-by boundary could have their resolution prompt built on arbitrary 50 entries (ordered by createdAt asc, so the earliest 50). Consider logging when `rows.length === 50` to surface truncation.

**Fix:** Add debug logging when the limit is hit:
```typescript
if (rows.length === 50) {
  logger.debug({ centerDate, windowMs }, 'pensieve.temporal.truncated');
}
```

### IN-04: ACCOUNTABILITY case in buildSystemPrompt repurposes pensieveContext/relationalContext

**File:** `src/chris/personality.ts:117-121`
**Issue:** The ACCOUNTABILITY branch reuses the `pensieveContext` parameter as `{decisionContext}` and `relationalContext` as `{pensieveContext}` in the prompt template. This is a pragmatic reuse of the existing parameter shape, but it's confusing: calling code passes `decisionContext` in the `pensieveContext` slot. The JSDoc at lines 68-76 doesn't document this ACCOUNTABILITY-specific semantic overload. A reader of `buildSystemPrompt('ACCOUNTABILITY', decisionContext, surroundingCtx, ...)` may not realize param naming is semantic-for-most-modes-but-syntactic-for-ACCOUNTABILITY.

**Fix:** Add a dedicated comment in the ACCOUNTABILITY case explaining the overload, or consider a typed overload signature:
```typescript
case 'ACCOUNTABILITY':
  // Reuses pensieveContext param as decisionContext (prediction/criterion/resolution),
  // and relationalContext param as the ±48h temporal Pensieve block. See resolution.ts:239.
  modeBody = ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT...
```

---

_Reviewed: 2026-04-17T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
