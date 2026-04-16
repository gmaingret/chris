# Phase 15: Deadline Trigger & Sweep Integration — Research

**Researched:** 2026-04-16
**Domain:** Proactive sweep extension — new trigger + dual-channel daily cap + stale-context framing
**Confidence:** HIGH (grounded in direct codebase reading of all referenced files)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Query `decisions WHERE status='open' AND resolve_by <= now() ORDER BY resolve_by ASC LIMIT 1`. Transition exactly one oldest-due decision `open → due` per sweep tick via `transitionDecision(id, 'open', 'due', { actor: 'sweep' })`.
- **D-02:** The deadline trigger runs in SQL Phase 1, parallel with silence and commitment triggers. Priority=2 slots naturally between silence=1 and commitment=3. Existing winner-by-priority logic handles ties.
- **D-03:** On `OptimisticConcurrencyError` (race with user reply), sweep retries once. On `InvalidTransitionError` (decision already moved), sweep skips silently and tries the next oldest-due. Follows Phase 13 D-14 error contract.
- **D-04:** Two independent `last_sent` keys in `proactive_state`: `last_sent_reflective` and `last_sent_accountability`. Each channel checks its own key via channel-aware helpers in `state.ts`. Same JSONB KV pattern as existing `last_sent` / `mute_until`.
- **D-05:** On same-day collision, accountability fires first (hard 24h window), then reflective fires independently — no waiting for Greg's reply. Both can land same day since caps are independent. Neither blocks the other.
- **D-06:** Global mute (`mute_until`) suppresses both channels. No per-channel mute in Phase 15.
- **D-07:** Migration of existing `last_sent` key: becomes `last_sent_reflective`. Code falls back to reading `last_sent` if `last_sent_reflective` doesn't exist yet (no DB migration required).
- **D-08:** When `now() - resolve_by > 48h`, trigger context includes absolute date: "On {YYYY-MM-DD} you predicted: '{prediction}'. It's now {days} past your deadline." When ≤48h: "Your deadline just passed for a prediction you made: '{prediction}'."
- **D-09:** `STALE_CONTEXT_THRESHOLD_MS = 48 * 60 * 60 * 1000` hardcoded constant in the trigger file.
- **D-10:** Accountability channel uses Sonnet (same tier as reflective outreach).
- **D-11:** Language threading uses Greg's most recent language from `getLastUserLanguage()`. Decision details stay in `language_at_capture` and are quoted verbatim.
- **D-12:** Distinct `ACCOUNTABILITY_SYSTEM_PROMPT` in `src/proactive/prompts.ts` (or new file — planner's call). Tone: cite prediction + falsification criterion verbatim, no flattery, no condemnation, ask "what actually happened?" The Hard Rule (D027) applies.

### Claude's Discretion

- Whether `runSweep()` is refactored into channel-aware sub-functions or stays as one function with branching logic.
- Exact wording of `ACCOUNTABILITY_SYSTEM_PROMPT` in EN.
- Whether `last_sent` migration is a one-time DB migration or handled by fallback logic in `state.ts` (D-07 says fallback).
- Index strategy on `decisions(status, resolve_by)` — already exists in schema (verified below).

### Deferred Ideas (OUT OF SCOPE)

- Resolution handler, post-mortem, ACCOUNTABILITY engine mode → Phase 16.
- `/decisions` list/stats/accuracy/unsuppress, `/mute decisions` per-channel mute → Phase 17.
- Synthetic-fixture end-to-end + live Sonnet suite → Phase 18.
- Configurable stale-context threshold.
- Accountability channel daily cap > 1.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SWEEP-01 | New `decision-deadline` trigger at priority=2, implements `TriggerDetector`, transitions oldest-due decision `open → due` before `sendMessage` | Trigger factory pattern verified in `silence.ts`; `transitionDecision()` chokepoint verified in `lifecycle.ts`; index on `(status, resolve_by)` already exists in schema |
| SWEEP-02 | Channel separation: `reflective_outreach` and `accountability_outreach` with independent daily caps; same-day collision fires both serially | `proactive_state` KV pattern verified in `state.ts`; `hasSentToday`/`setLastSent` are extensible to channel-aware variants; sweep architecture supports two sequential send paths |
| SWEEP-04 | Stale-context prompt: when prompt fires >48h past `resolve_by`, text is explicitly dated | Trigger result `context` string is the injection point; verified in `sweep.ts` line 127-130 where `winner.context` is interpolated into system prompt |
</phase_requirements>

---

## Summary

Phase 15 adds a fifth proactive trigger (`decision-deadline`) and upgrades the sweep from a single-channel daily cap to a dual-channel architecture. Everything it touches is already in place: the `TriggerDetector` interface, the `transitionDecision()` chokepoint, the `proactive_state` KV table, and the `decisions` table with its composite index. This is a surgical extension with no new tables and no schema migrations.

The core architectural challenge is the channel separation in `sweep.ts`. The existing `runSweep()` has one mute gate, one daily-cap gate, one trigger phase, one generation step, and one `setLastSent` call. Phase 15 needs two independent daily-cap gates and two independent generation steps that can both run on the same day — without either blocking the other. The simplest implementation is: run accountability channel first (gates: muted? → `hasSentTodayAccountability?`), then run reflective channel (gates: muted? → `hasSentTodayReflective?`), either or both can fire per sweep tick.

The stale-context injection (SWEEP-04) requires no new abstractions: the trigger result's `context` string is already how trigger intent reaches the LLM prompt. The deadline trigger simply sets a different `context` string depending on whether staleness exceeds 48h.

**Primary recommendation:** Implement in three sequential plans — (1) deadline trigger file, (2) channel-aware state helpers + key migration fallback, (3) sweep refactor + prompt. Test each plan in isolation before integrating.

---

## Standard Stack

### Core (verified against live codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.1.2 | Test framework | Project-standard; all 50+ test files use it [VERIFIED: package.json] |
| drizzle-orm | existing | DB access layer | Used throughout; `eq`, `and`, `lt`, `asc` already imported in triggers [VERIFIED: codebase] |
| Anthropic SDK | existing | LLM generation | `anthropic.messages.create` with `SONNET_MODEL` — matches D-10 [VERIFIED: sweep.ts] |

### Existing Modules to Extend (do not reinvent)

| Module | File | What Phase 15 Adds |
|--------|------|--------------------|
| `TriggerDetector` interface | `src/proactive/triggers/types.ts` | Add `'decision-deadline'` to `triggerType` union |
| `createSilenceTrigger` factory | `src/proactive/triggers/silence.ts` | Template: copy factory-function pattern for `createDeadlineTrigger()` |
| `hasSentToday` / `setLastSent` | `src/proactive/state.ts` | Add channel-aware variants with fallback for key migration |
| `PROACTIVE_SYSTEM_PROMPT` | `src/proactive/prompts.ts` | Add `ACCOUNTABILITY_SYSTEM_PROMPT` following same `{triggerContext}` pattern |
| `runSweep()` | `src/proactive/sweep.ts` | Add accountability channel path; keep reflective channel path |
| `transitionDecision()` | `src/decisions/lifecycle.ts` | Call from deadline trigger with `{ actor: 'sweep' }` — no changes to lifecycle.ts |

**Installation:** No new npm packages required. [VERIFIED: all dependencies present]

---

## Architecture Patterns

### Pattern 1: TriggerDetector Factory (template from silence.ts)

**What:** A factory function returns an object with a `detect()` method returning `Promise<TriggerResult>`. The factory accepts configuration; `detect()` closes over it.

**When to use:** All SQL-first triggers follow this pattern.

```typescript
// Source: src/proactive/triggers/silence.ts (verified)
export function createDeadlineTrigger(): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const notTriggered = (context: string): TriggerResult => ({
        triggered: false,
        triggerType: 'decision-deadline',
        priority: 2,
        context,
      });
      // ... SQL query + transitionDecision + context string construction
    },
  };
}
```

### Pattern 2: Proactive State KV Helpers (template from state.ts)

**What:** Every piece of proactive state is a key/value row in `proactive_state`. Keys are string constants. Helpers are thin wrappers around `getValue`/`setValue`.

**When to use:** All persistent sweep state (mute, last_sent timestamps).

```typescript
// Source: src/proactive/state.ts (verified)
// Existing pattern — channel-aware variants follow the same shape:
const LAST_SENT_REFLECTIVE_KEY = 'last_sent_reflective';
const LAST_SENT_ACCOUNTABILITY_KEY = 'last_sent_accountability';
// Fallback: if 'last_sent_reflective' not found, fall back to 'last_sent' (D-07 migration)
```

### Pattern 3: Dual-Channel Sweep Architecture

**What:** `runSweep()` runs two independent channel checks in sequence. Accountability fires first (has a hard 24h window). Reflective fires second (independent cap). Each has its own `hasSentToday` check and `setLastSent` call. Global mute gates both at the top.

**Current state of `runSweep()`:**
```
mute? → sentToday? → Phase1 SQL → Phase2 Opus → winner → generate → send → setLastSent
```

**Target state after Phase 15:**
```
mute? →
  [accountability channel] → hasSentTodayAccountability? → deadlineTrigger.detect() →
    if fired: generate (ACCOUNTABILITY_SYSTEM_PROMPT) → send → setLastSentAccountability
  [reflective channel]    → hasSentTodayReflective? → existing Phase1+Phase2 pipeline →
    if fired: generate (PROACTIVE_SYSTEM_PROMPT) → send → setLastSentReflective
```

Both channels can fire in one sweep tick. The function always runs accountability path first, then reflective path, regardless of the first outcome.

### Pattern 4: Context String for Stale Detection (SWEEP-04)

**What:** The trigger's `context` string (injected into the system prompt at `{triggerContext}`) encodes stale vs. fresh framing. The LLM is given the context and naturally produces dated language when the context says "48 days ago on 2026-01-15...".

```typescript
// Source: architecture derived from sweep.ts line 127-130 (verified)
const STALE_CONTEXT_THRESHOLD_MS = 48 * 60 * 60 * 1000; // D-09

function buildDeadlineContext(decision: DecisionRow, now: Date): string {
  const staleness = now.getTime() - decision.resolveBy.getTime();
  if (staleness > STALE_CONTEXT_THRESHOLD_MS) {
    const resolveByStr = decision.resolveBy.toISOString().slice(0, 10); // YYYY-MM-DD
    const days = Math.round(staleness / (24 * 60 * 60 * 1000));
    return `On ${resolveByStr} you predicted: '${decision.prediction}'. It's now ${days} days past your deadline. Your falsification criterion was: '${decision.falsificationCriterion}'.`;
  }
  return `Your deadline just passed for a prediction you made: '${decision.prediction}'. Your falsification criterion was: '${decision.falsificationCriterion}'.`;
}
```

### Recommended File Structure

```
src/proactive/
├── triggers/
│   ├── types.ts          MODIFY: add 'decision-deadline' to triggerType union
│   ├── silence.ts        unchanged
│   ├── commitment.ts     unchanged
│   ├── deadline.ts       NEW: createDeadlineTrigger() factory
│   ├── pattern.ts        unchanged
│   ├── thread.ts         unchanged
│   └── opus-analysis.ts  unchanged
├── state.ts              MODIFY: add channel-aware helpers + migration fallback
├── prompts.ts            MODIFY: add ACCOUNTABILITY_SYSTEM_PROMPT
├── sweep.ts              MODIFY: dual-channel architecture
└── __tests__/
    ├── sweep.test.ts     MODIFY: add accountability + collision tests
    ├── state.test.ts     MODIFY: add channel-aware helper tests
    └── deadline.test.ts  NEW: unit tests for createDeadlineTrigger
```

### Anti-Patterns to Avoid

- **Don't make commitment priority 2 now.** Current commitment is priority=2. The CONTEXT.md says deadline=2 "between silence=1 and commitment=3". This means commitment must be renumbered to 3 when deadline trigger is added. Verify in `commitment.ts` (current value is `priority: 2` — this MUST change to 3).
- **Don't share the `setLastSent` call between channels.** If both channels call the old unified `setLastSent`, the reflective channel will see "already sent today" on the same day the accountability channel fired. Each channel needs its own key.
- **Don't transition inside `detect()` after returning notTriggered.** The transition must only happen when the trigger wins or is about to generate a message. In the deadline trigger, transition inside `detect()` is acceptable per D-02 because only the single oldest-due decision is transitioned — but the design must never transition a decision that then loses the priority contest and whose message is never sent (leaving status='due' with no corresponding send). Solution: transition happens inside `detect()` only for the single candidate row; if the deadline trigger loses to silence (priority 1), the row is now 'due' but no message was sent — this is acceptable because on the next sweep tick, the commitment and reflective channels no longer compete with it (it's accountability channel only). The tradeoff is accepted per D-01/D-02.
- **Don't bypass global mute for accountability channel.** D-06 is explicit: global mute kills both. The mute gate must run before both channel checks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimistic concurrency | Custom UPDATE logic | `transitionDecision()` in lifecycle.ts | Already handles WHERE id AND status guard, throws typed errors, writes decision_events atomically — Phase 13 work |
| Decision query | Raw SQL | Drizzle with existing schema exports | `decisions` table and `decisionStatusEnum` already exported from schema.ts |
| Language detection | New franc call | `getLastUserLanguage(chatIdStr)` | Already threaded through engine; consistent with existing proactive outreach |
| Retry logic on concurrency error | New retry framework | Inline try/catch with single retry per D-03 | One retry is the whole spec; don't over-engineer |
| Priority arbitration | Custom sort | Existing `fired.sort((a, b) => a.priority - b.priority)` | This exists in sweep.ts already |

---

## Critical Priority Collision Detail

**The commitment trigger currently has `priority: 2`** (verified in `src/proactive/triggers/commitment.ts` line 35). The CONTEXT.md specifies deadline=2, commitment=3. **This is a required change.** The plan MUST renumber commitment to priority=3 as part of adding the deadline trigger. Failure to do this means deadline and commitment triggers will tie and the winner will be non-deterministic (sort is stable but both are at the same priority).

Current priority map:
```
silence=1, commitment=2, pattern=3, thread=4
```

Target priority map after Phase 15:
```
silence=1, deadline=2, commitment=3, pattern=4, thread=5
```

Pattern and thread priorities must also shift up by 1. These are defined in `pattern.ts` and `thread.ts` — verify and update.

---

## Common Pitfalls

### Pitfall 1: SweepResult Return Shape Breaks Callers

**What goes wrong:** `runSweep()` currently returns `{ triggered: boolean, triggerType?, message?, skippedReason? }`. When the function runs two channels and both fire, callers expecting a single `triggerType` get confused. The existing cron caller only cares whether the sweep ran — but the sweep test mocks and assertions check `result.triggerType`.

**How to avoid:** Return the accountability result's `triggerType` if it fired, else the reflective result's. Or extend `SweepResult` to include both channels' outcomes. The simplest extension: add `accountabilityTriggered?: boolean` and `reflectiveTriggered?: boolean` while keeping the top-level `triggered` as `true` if either channel fired.

**Warning signs:** Sweep tests fail because `result.triggerType` is undefined when both channels fire.

### Pitfall 2: `hasSentTodayReflective` Always Returns False on First Deploy

**What goes wrong:** The `last_sent_reflective` key doesn't exist in `proactive_state` yet. If the fallback logic reads `last_sent` first and Greg already had a message sent today (under the old unified key), the reflective channel will fire again the same day.

**How to avoid:** On first read of `last_sent_reflective`, if key is absent, read `last_sent` as the fallback. This is D-07's explicit intent. The fallback must be: `getValue('last_sent_reflective') ?? getValue('last_sent')`. On the first write via `setLastSentReflective`, write to `last_sent_reflective` (the new key). After one successful write the old `last_sent` key becomes irrelevant for the reflective channel.

**Warning signs:** Greg receives two messages on the day of deploy — one via old unified key check that didn't block, one via new key.

### Pitfall 3: Transition Before Generation Loses Atomicity

**What goes wrong:** Deadline trigger transitions `open → due` inside `detect()`. Then the sweep's LLM call fails (API timeout, empty response). The decision is now `due` in the DB but no message was sent. The sweep won't fire accountability for this decision again until the next tick, and the existing `due` status means the trigger will query for the NEXT oldest decision instead.

**How to avoid:** This is acceptable per the architecture (D-01/D-02) because `due` is a valid state indicating the deadline has passed. The decision will stay `due` and be picked up again by the resolution flow (Phase 16). The send failure means Greg doesn't see the prompt today — the retry is tomorrow's sweep tick. Log the generation failure explicitly so it's visible.

**Warning signs:** Decision stuck in `due` with no `decision_events` accountability row for the resolution prompt send.

### Pitfall 4: D-03 Retry Logic Needs a Second Query

**What goes wrong:** On `OptimisticConcurrencyError`, D-03 says retry once. But retry of what? The whole sweep tick or just the trigger? The trigger queries `LIMIT 1` (oldest due). After the concurrency failure (the decision was already moved, e.g., by user withdrawal), the retry must re-query to get the next oldest-due decision — the original candidate is no longer valid.

**How to avoid:** The retry in the trigger's `detect()` method re-runs the full SQL query rather than retrying the transition on the same ID. Pseudocode:
```typescript
// First attempt
let candidate = await queryOldestDueDecision();
try {
  await transitionDecision(candidate.id, 'open', 'due', { actor: 'sweep' });
} catch (err) {
  if (err instanceof OptimisticConcurrencyError) {
    // Re-query for next candidate (the first was concurrently modified)
    candidate = await queryOldestDueDecision();
    if (!candidate) return notTriggered('No due decisions after retry');
    await transitionDecision(candidate.id, 'open', 'due', { actor: 'sweep' });
  } else if (err instanceof InvalidTransitionError) {
    // Decision already moved — skip silently, no retry
    return notTriggered('Decision already transitioned');
  }
}
```

### Pitfall 5: Sweep Test File Must Be Substantially Rewritten

**What goes wrong:** The existing `sweep.test.ts` mocks `hasSentToday` and `setLastSent` as unified functions. After Phase 15, these become channel-specific. All existing test setup (`mockHasSentToday`) will need to be split into `mockHasSentTodayReflective` and `mockHasSentTodayAccountability`. This is non-trivial refactoring — the test file is 650 lines.

**How to avoid:** Plan an explicit task for sweep test migration. The existing tests must continue to pass (reflective channel behavior is unchanged). New tests add accountability + collision coverage. Structure: keep existing test cases but update mocks to use new channel-specific functions; add new describe block for accountability channel.

**Warning signs:** All existing sweep tests fail after mock updates because module mock shape changed.

---

## Code Examples

### Deadline Trigger — Minimal Structure

```typescript
// src/proactive/triggers/deadline.ts
// Source: pattern verified from silence.ts + lifecycle.ts (direct codebase read)

import { and, eq, lte, asc } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { decisions } from '../../db/schema.js';
import { transitionDecision } from '../../decisions/lifecycle.js';
import { OptimisticConcurrencyError, InvalidTransitionError } from '../../decisions/errors.js';
import type { TriggerResult, TriggerDetector } from './types.js';

export const STALE_CONTEXT_THRESHOLD_MS = 48 * 60 * 60 * 1000; // D-09

export function createDeadlineTrigger(): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const notTriggered = (context: string): TriggerResult => ({
        triggered: false,
        triggerType: 'decision-deadline',
        priority: 2,
        context,
      });

      const now = new Date();
      const rows = await db
        .select()
        .from(decisions)
        .where(and(eq(decisions.status, 'open'), lte(decisions.resolveBy, now)))
        .orderBy(asc(decisions.resolveBy))
        .limit(1);

      if (rows.length === 0) return notTriggered('No due decisions');

      const candidate = rows[0]!;
      try {
        await transitionDecision(candidate.id, 'open', 'due', { actor: 'sweep' });
      } catch (err) {
        if (err instanceof OptimisticConcurrencyError) {
          // Retry with next oldest (re-query)
          const retry = await db.select().from(decisions)
            .where(and(eq(decisions.status, 'open'), lte(decisions.resolveBy, now)))
            .orderBy(asc(decisions.resolveBy)).limit(1);
          if (retry.length === 0) return notTriggered('No due decisions after retry');
          await transitionDecision(retry[0]!.id, 'open', 'due', { actor: 'sweep' });
        } else if (err instanceof InvalidTransitionError) {
          return notTriggered('Decision already transitioned');
        } else {
          throw err;
        }
      }

      const staleness = now.getTime() - candidate.resolveBy.getTime();
      const context = staleness > STALE_CONTEXT_THRESHOLD_MS
        ? `On ${candidate.resolveBy.toISOString().slice(0, 10)} you predicted: '${candidate.prediction}'. It's now ${Math.round(staleness / 86400000)} days past your deadline. Your falsification criterion was: '${candidate.falsificationCriterion}'.`
        : `Your deadline just passed for a prediction you made: '${candidate.prediction}'. Your falsification criterion was: '${candidate.falsificationCriterion}'.`;

      return {
        triggered: true,
        triggerType: 'decision-deadline',
        priority: 2,
        context,
        evidence: [`Decision ID: ${candidate.id}`, `Resolve by: ${candidate.resolveBy.toISOString()}`, `Staleness: ${Math.round(staleness / 3600000)}h`],
      };
    },
  };
}
```

### Channel-Aware State Helpers

```typescript
// src/proactive/state.ts additions
// Source: verified from existing state.ts structure

const LAST_SENT_REFLECTIVE_KEY = 'last_sent_reflective';
const LAST_SENT_ACCOUNTABILITY_KEY = 'last_sent_accountability';
const LAST_SENT_KEY = 'last_sent'; // legacy fallback key (D-07)

export async function hasSentTodayReflective(timezone: string): Promise<boolean> {
  // D-07: fall back to legacy 'last_sent' if 'last_sent_reflective' not yet written
  const val = await getValue(LAST_SENT_REFLECTIVE_KEY) ?? await getValue(LAST_SENT_KEY);
  if (!val) return false;
  return isSameDay(new Date(val as string), new Date(), timezone);
}

export async function setLastSentReflective(timestamp: Date): Promise<void> {
  await setValue(LAST_SENT_REFLECTIVE_KEY, timestamp.toISOString());
}

export async function hasSentTodayAccountability(timezone: string): Promise<boolean> {
  const val = await getValue(LAST_SENT_ACCOUNTABILITY_KEY);
  if (!val) return false;
  return isSameDay(new Date(val as string), new Date(), timezone);
}

export async function setLastSentAccountability(timestamp: Date): Promise<void> {
  await setValue(LAST_SENT_ACCOUNTABILITY_KEY, timestamp.toISOString());
}

function isSameDay(a: Date, b: Date, timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(a) === fmt.format(b);
}
```

### ACCOUNTABILITY_SYSTEM_PROMPT — Draft

```typescript
// src/proactive/prompts.ts addition
// Hard Rule (D027), D025 (no praise quarantine bypass needed — forbidden at prompt level)

export const ACCOUNTABILITY_SYSTEM_PROMPT = `You are Chris. Greg made a prediction with a specific deadline, and that deadline has now passed.

Context about the prediction:
{triggerContext}

Your task: Send a brief, neutral check-in asking what actually happened.

Rules:
- Cite the original prediction and falsification criterion verbatim from the context above.
- Ask one open question: "what actually happened?" or a natural variation.
- Tone: neutral-factual. Not judgmental. Not encouraging. Just factual inquiry.
- If the prediction was correct, do not say "you were right", "great call", or any variant. Just report it as data and ask for reflection.
- If the prediction was wrong, do not say "you were wrong" or tie the outcome to Greg as a person. Just note the gap between prediction and criterion.
- NEVER say: "impressive", "good job", "well done", "you called it", "I knew you could", or any flattery.
- NEVER say: "I'm disappointed", "you failed", "you were wrong about yourself", or any condemnation.
- ALWAYS write in the language Greg most recently used.
- Keep to 2-3 sentences maximum.
- NEVER mention being automated, scheduled, or triggered.`;
```

### Dual-Channel Sweep Structure (conceptual)

```typescript
// src/proactive/sweep.ts — structural change to runSweep()
// Source: verified current structure; this is the target shape

export async function runSweep(): Promise<SweepResult> {
  // Gate 1: Global mute (suppresses BOTH channels — D-06)
  if (await isMuted()) return { triggered: false, skippedReason: 'muted' };

  let accountabilityFired = false;
  let reflectiveFired = false;

  // === ACCOUNTABILITY CHANNEL (fires first — hard 24h window) ===
  if (!await hasSentTodayAccountability(config.proactiveTimezone)) {
    const deadlineTrigger = createDeadlineTrigger();
    const deadlineResult = await deadlineTrigger.detect();
    if (deadlineResult.triggered) {
      // generate with ACCOUNTABILITY_SYSTEM_PROMPT, send, setLastSentAccountability
      accountabilityFired = true;
    }
  }

  // === REFLECTIVE CHANNEL (independent cap — D-05) ===
  if (!await hasSentTodayReflective(config.proactiveTimezone)) {
    // existing Phase 1 SQL + Phase 2 Opus pipeline
    // on win: generate with PROACTIVE_SYSTEM_PROMPT, send, setLastSentReflective
    reflectiveFired = true; // if a trigger fired
  }

  const triggered = accountabilityFired || reflectiveFired;
  return {
    triggered,
    skippedReason: triggered ? undefined : 'no_trigger',
    // ... extend SweepResult as needed
  };
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact on Phase 15 |
|--------------|------------------|---------------------|
| Single `last_sent` KV key | Two keys: `last_sent_reflective` + `last_sent_accountability` | Must migrate via fallback (D-07), not a DB migration |
| Single-channel daily cap | Dual-channel independent caps | `runSweep()` structure changes substantially |
| 4 triggers (silence/commitment/pattern/thread) | 5 triggers, with deadline as SQL-first at priority=2 | Commitment, pattern, thread priorities shift up by 1 |

**Priority numbering note:** Current code has:
- `silence.ts`: priority 1 [VERIFIED]
- `commitment.ts`: priority 2 [VERIFIED — must change to 3]
- `pattern.ts` and `thread.ts`: priorities 3 and 4 [need to verify and shift to 4/5]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pattern trigger priority=3, thread=4 (need to shift to 4/5) — not directly verified in this session | Architecture Patterns (priority map) | If already different, renumbering plan is wrong — planner should verify `pattern.ts` and `thread.ts` before writing tasks |
| A2 | `getLastUserLanguage()` is importable from its existing module for use in the deadline trigger or sweep | Code Examples | If it requires engine context not available in sweep.ts, language must be fetched differently — check import path |

---

## Open Questions (RESOLVED)

1. **Where does `decisionCaptureState` row for `AWAITING_RESOLUTION` get written in Phase 15?**
   - What we know: CONTEXT.md says the sweep transitions the decision `open → due` and sends the prompt. The ARCHITECTURE.md (from Phase 15's canonical refs) says the sweep also inserts a `decision_capture_state` row (stage=AWAITING_RESOLUTION) before `sendMessage`, so the engine knows Greg's next reply is a resolution response.
   - What's unclear: Phase 15 CONTEXT.md doesn't explicitly mention writing `decision_capture_state`. The resolution handler is Phase 16. If Phase 15 doesn't write the capture state row, Phase 16 has nothing to route against.
   - Recommendation: Phase 15 SHOULD write the `decision_capture_state` row (stage=AWAITING_RESOLUTION, decisionId=candidate.id) before sending the message. This is consistent with ARCHITECTURE.md §3 and with Phase 16 pre-processor #0 routing. The planner should include this as a task step, not leave it to Phase 16.
   - **RESOLVED:** Plan 03 Task 1 adds `upsertAwaitingResolution()` to `capture-state.ts`, called in sweep before `sendMessage` in the accountability path (Plan 03 Task 2).

2. **Does `runSweep()` return value shape need extension for two-channel results?**
   - What we know: Existing callers (the cron scheduler) only use `result.triggered`. The sweep tests check `result.triggerType` and `result.message` for assertions.
   - What's unclear: If both channels fire, which `triggerType`/`message` is returned?
   - Recommendation: Extend `SweepResult` with `accountabilityResult` and `reflectiveResult` sub-objects. Keep the top-level `triggered` as `true` if either fired. The existing sweep tests will need updates to check the right sub-object.
   - **RESOLVED:** Plan 03 Task 2 extends `SweepResult` with `accountabilityResult?: ChannelResult` and `reflectiveResult?: ChannelResult` sub-objects.

---

## Environment Availability

Step 2.6: All external dependencies for Phase 15 are already present in the running project. No new tools, services, or runtimes required. Docker + Postgres confirmed running for tests per `scripts/test.sh`. [VERIFIED: test script reads existing migrations; no new migration required for Phase 15]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (root: `src`, includes `**/__tests__/**/*.test.ts`) |
| Quick run command | `DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris npx vitest run src/proactive/__tests__/deadline.test.ts` |
| Full suite command | `npm test` (runs `scripts/test.sh` — starts Docker Postgres, applies migrations, runs vitest) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SWEEP-01 | `createDeadlineTrigger().detect()` returns triggered=true when open decision past resolveBy | unit | `npm test -- src/proactive/__tests__/deadline.test.ts` | ❌ Wave 0 |
| SWEEP-01 | `transitionDecision` called with `(id, 'open', 'due', { actor: 'sweep' })` on hit | unit | same | ❌ Wave 0 |
| SWEEP-01 | `OptimisticConcurrencyError` → single retry with re-query | unit | same | ❌ Wave 0 |
| SWEEP-01 | `InvalidTransitionError` → skip silently, return notTriggered | unit | same | ❌ Wave 0 |
| SWEEP-01 | `priority` field equals 2 | unit | same | ❌ Wave 0 |
| SWEEP-02 | Same-day: accountability fires even when `hasSentTodayReflective` true | unit | `npm test -- src/proactive/__tests__/sweep.test.ts` | Exists (needs new tests) |
| SWEEP-02 | Same-day: reflective fires even when `hasSentTodayAccountability` true | unit | same | Exists (needs new tests) |
| SWEEP-02 | Global mute suppresses both channels | unit | same | Exists (needs update) |
| SWEEP-02 | `hasSentTodayReflective` falls back to `last_sent` when `last_sent_reflective` absent | unit | `npm test -- src/proactive/__tests__/state.test.ts` | Exists (needs new test) |
| SWEEP-04 | Context string contains absolute date when staleness > 48h | unit | `npm test -- src/proactive/__tests__/deadline.test.ts` | ❌ Wave 0 |
| SWEEP-04 | Context string uses implicit framing when staleness ≤ 48h | unit | same | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- src/proactive/__tests__/deadline.test.ts src/proactive/__tests__/state.test.ts`
- **Per wave merge:** `npm test` (full suite with Docker Postgres)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/proactive/__tests__/deadline.test.ts` — covers SWEEP-01 and SWEEP-04; follows sweep.test.ts K001/K002 mock patterns
- [ ] No new conftest/fixture needed; existing vitest.config.ts covers the new file automatically

---

## Security Domain

Phase 15 involves no new authentication surfaces, no new command handlers, and no user-facing inputs beyond the existing Telegram channel. The accountability prompt MUST enforce D027 (The Hard Rule) and D025 (no flattery) at the prompt level — this is the sole security-adjacent concern: ensuring the accountability channel cannot become a sycophancy vector even if the praise quarantine doesn't apply.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | no | Decision data is trusted DB content, not user input |
| V2 Authentication | no | Sweep is server-side cron; no new auth surface |
| Prompt injection | yes (low risk) | Decision `prediction` and `falsificationCriterion` text is quoted verbatim into the system prompt. Greg-authored content. Risk is low (single user, trusted content), but the quote delimiters ('...') provide implicit boundary. |

---

## Sources

### Primary (HIGH confidence — direct codebase read)

- `src/proactive/sweep.ts` — full sweep orchestration, current priority map, `SweepResult` shape
- `src/proactive/triggers/types.ts` — `TriggerDetector` interface, `TriggerResult` shape, triggerType union
- `src/proactive/triggers/silence.ts` — factory pattern template for deadline trigger
- `src/proactive/triggers/commitment.ts` — current priority=2 (must shift to 3)
- `src/proactive/state.ts` — KV pattern for `hasSentToday`/`setLastSent`/`isMuted`
- `src/proactive/prompts.ts` — `PROACTIVE_SYSTEM_PROMPT` shape with `{triggerContext}` placeholder
- `src/decisions/lifecycle.ts` — `transitionDecision()` signature, `LEGAL_TRANSITIONS`, error handling
- `src/decisions/errors.ts` — `OptimisticConcurrencyError`, `InvalidTransitionError` class shapes
- `src/db/schema.ts` — `decisions` table columns, `decisionStatusEnum`, composite index `decisions_status_resolve_by_idx` already defined
- `src/proactive/__tests__/sweep.test.ts` — K001/K002 mock patterns, existing test structure (650 lines, substantially must be updated)
- `src/proactive/__tests__/state.test.ts` — mock DB chain pattern for new channel helpers
- `.planning/phases/15-deadline-trigger-sweep-integration/15-CONTEXT.md` — all decisions D-01 through D-12
- `.planning/research/PITFALLS.md` — C5 (scheduler collision), M3 (mid-conversation surfacing)
- `.planning/research/ARCHITECTURE.md` — integration diagram, sweep Phase 3 build order

### Secondary (MEDIUM confidence — project documentation)

- `.planning/REQUIREMENTS.md` — SWEEP-01, SWEEP-02, SWEEP-04 requirement text
- `.planning/research/PITFALLS.md` §C5 — prevention strategy that defines the dual-channel architecture

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules verified by direct file read
- Architecture patterns: HIGH — derived from reading actual source, not docs
- Pitfalls: HIGH — pitfall 5 (sweep test rewrite scope) is a planning risk that needs explicit task allocation; others are concrete and verified
- Priority renumbering: HIGH for commitment (verified priority=2); ASSUMED for pattern/thread (A1)

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable codebase; only invalidated by Phase 15 execution itself)
