# Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode — Research

**Researched:** 2026-04-16
**Domain:** Engine mode extension, decision lifecycle resolution, Pensieve temporal retrieval, sweep escalation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** ACCOUNTABILITY is a new engine mode — added to `ChrisMode` union in `engine.ts` and `personality.ts`. Own system prompt, own handler (`handleAccountability()`). NOT a COACH extension.
- **D-02:** LLM tier = Sonnet for resolution + post-mortem conversation. Haiku for outcome classification (hit/miss/ambiguous/unverifiable).
- **D-03:** ACCOUNTABILITY system prompt uses constitutional preamble + explicit Hard Rule reminder. `buildSystemPrompt('ACCOUNTABILITY', ...)` prepends `CONSTITUTIONAL_PREAMBLE` AND adds "Never attribute the outcome to Greg's character or track record."
- **D-04:** Praise quarantine bypassed for ACCOUNTABILITY — add to `mode === 'COACH' || mode === 'PSYCHOLOGY'` check in `praise-quarantine.ts`.
- **D-05:** Pensieve retrieval for resolution = ±48h temporal query only. No hybrid search. Decision row provides core context; temporal entries give surrounding life context.
- **D-06:** Epistemic tag for all resolution/post-mortem Pensieve entries = DECISION. Reuses Phase 13 tag.
- **D-07:** Resolution handler = single-pass Sonnet. Greg's reply → Sonnet (ACCOUNTABILITY prompt + decision context) → acknowledgment. Then Haiku classifies, then Sonnet generates post-mortem question. All in one response turn.
- **D-08:** Language = Greg's reply language via `getLastUserLanguage()` / `franc`. Prediction and falsification criterion quoted verbatim in original `language_at_capture`.
- **D-09:** Pensieve writes = two separate fire-and-forget entries. Greg's resolution reply (DECISION, source_ref_id=decision.id) + Chris's acknowledgment (DECISION, source_ref_id=decision.id).
- **D-10:** Resolution → post-mortem = immediate same-turn. Steps: (1) Sonnet acknowledgment, (2) `transitionDecision(id, 'due', 'resolved')`, (3) write `resolution` text to decisions row, (4) update capture state to AWAITING_POSTMORTEM, (5) Haiku classification, (6) Sonnet post-mortem question.
- **D-11:** Class-specific post-mortem questions: hit="What did you see that others missed?", miss="What would you do differently knowing what you know now?", ambiguous="What would settle this conclusively?", unverifiable="Is there any way to know, or was this inherently untestable?" — each localized EN/FR/RU.
- **D-12:** Haiku outcome classification input = Greg's reply + original prediction + falsification criterion.
- **D-13:** Post-mortem answer: stored in `resolution_notes`, `transitionDecision(id, 'resolved', 'reviewed')`, `clearCapture(chatId)`, one-line ack in Greg's language. No further conversation.
- **D-14:** Popper criterion in system prompt context block (not an explicit quote). Sonnet weaves it in naturally.
- **D-15:** 48h timer uses sweep tick + `proactive_state` timestamp. Key: `accountability_sent_<decisionId>`.
- **D-16:** Non-reply counting via `accountability_prompt_count_<decisionId>` in proactive_state. First prompt=1, second prompt=2, then stale after another 48h.
- **D-17:** Stale transition is silent. No message to Greg. Two ignored prompts = done.
- **D-18:** Second prompt acknowledges follow-up: "A couple days ago I asked about your prediction on X. Still curious what happened." Distinct template from first prompt.

### Claude's Discretion

- Exact file organization for resolution/post-mortem handler code (`src/decisions/resolution.ts` vs `src/chris/modes/accountability.ts` vs combined).
- ±48h Pensieve retrieval implementation (direct SQL query vs extending `searchPensieve` with a time-window option).
- Exact EN/FR/RU wording of class-specific post-mortem questions and one-line acknowledgments.
- Whether the same-turn two-part reply is a single concatenated string or two sequential Telegram API messages.
- How `proactive_state` keys for per-decision escalation tracking are named and cleaned up after stale/reviewed transitions.

### Deferred Ideas (OUT OF SCOPE)

- `/decisions` list/stats/accuracy/reclassify → Phase 17.
- Synthetic-fixture end-to-end + live ACCOUNTABILITY Sonnet suite → Phase 18.
- Per-channel `/mute decisions` → Phase 17.
- Multi-question post-mortems (explicitly rejected, OOS-M007-04).
- Opus for post-mortem depth (deferred).
- Hybrid search for resolution context (deferred).
- Resolution edit/retry (rejected, OOS-M007-03 spirit).
- Stale → open revival (rejected; terminal states have no outgoing edges).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RES-01 | New ACCOUNTABILITY mode bypasses praise quarantine + forbids The Hard Rule | `praise-quarantine.ts` line 82 bypass pattern verified; `CONSTITUTIONAL_PREAMBLE` and Hard Rule text in `personality.ts` confirmed |
| RES-02 | Resolution prompts surface within 24h of `resolve_by`; cite original prediction in Greg's language | Sweep deadline trigger already fires; PP#0 AWAITING_RESOLUTION branch exists with TODO comment |
| RES-03 | Engine PP#0 intercepts AWAITING_RESOLUTION, routes to resolution handler, stores response, transitions `due → resolved` | PP#0 branch with fallthrough comment at `engine.ts` confirmed; `transitionDecision('due','resolved')` legal in LEGAL_TRANSITIONS map |
| RES-04 | One post-mortem follow-up (Haiku-classified); response in `resolution_notes`; `resolved → reviewed`; both Pensieve entries with `source_ref_id` | `transitionDecision('resolved','reviewed')` legal; `writePensieveEntry` pattern in `capture.ts:224–236` shows DECISION tag + metadata.sourceRefId pattern |
| RES-05 | ±48h Pensieve temporal retrieval; Popper criterion in prompt | No existing temporal-window query in `retrieve.ts` — new helper required (direct SQL with `gte`/`lte` on `created_at`); `gte`/`lte` available from `drizzle-orm` |
| RES-06 | Auto-escalation: 48h no reply → second prompt once; 2 non-replies → `stale` | `proactive_state` KV pattern confirmed; `setValue`/`getValue`/`deleteKey` generics available; `transitionDecision('due','stale')` legal |

</phase_requirements>

---

## Summary

Phase 16 fills in the TODO branches that prior phases deliberately left empty. The entire surface area is well-scaffolded: `engine.ts` PP#0 already has the AWAITING_RESOLUTION / AWAITING_POSTMORTEM branch with a "Phase 16 will handle" comment, `upsertAwaitingResolution()` already writes the row the sweep creates, `transitionDecision()` already allows `due→resolved`, `resolved→reviewed`, and `due→stale`, and `praise-quarantine.ts` already has the pattern for mode-level bypass.

The three genuinely new components are: (1) the ACCOUNTABILITY mode handler and system prompt (`src/decisions/resolution.ts` or `src/chris/modes/accountability.ts`), (2) a temporal-window Pensieve retrieval helper (±48h SQL query not yet in `retrieve.ts`), and (3) per-decision escalation tracking in `proactive_state` plus sweep escalation logic in `sweep.ts`.

The highest-risk area is the same-turn multi-step resolution flow (D-10): a single Greg message triggers a Sonnet call, a DB transition, a DB write, a Haiku call, a second Sonnet call, two fire-and-forget Pensieve writes, and a capture-state update — all synchronously within `processMessage()`. The planner must sequence these carefully so partial failures degrade gracefully (no double-transitions, no orphaned AWAITING_POSTMORTEM rows without a resolution stored).

**Primary recommendation:** Implement the resolution handler as `src/decisions/resolution.ts` (collocated with capture.ts, lifecycle.ts — the decisions domain module). ACCOUNTABILITY mode's system prompt lives in `src/llm/prompts.ts` (alongside other mode prompts) and `buildSystemPrompt()` in `personality.ts` dispatches to it. This keeps the engine layer thin.

---

## Standard Stack

### Core (all verified in codebase)

| Component | Location | Purpose | Status |
|-----------|----------|---------|--------|
| `ChrisMode` union | `src/chris/personality.ts:12` | Mode type — add `'ACCOUNTABILITY'` | Extend |
| `buildSystemPrompt()` | `src/chris/personality.ts:77` | Dispatches to mode-specific prompt | Extend switch |
| `quarantinePraise()` | `src/chris/praise-quarantine.ts:78` | Post-processor bypass for mode | Add `|| mode === 'ACCOUNTABILITY'` |
| `processMessage()` PP#0 | `src/chris/engine.ts:~163` | AWAITING_RESOLUTION / AWAITING_POSTMORTEM fallthrough | Fill in |
| `transitionDecision()` | `src/decisions/lifecycle.ts:75` | due→resolved, resolved→reviewed, due→stale | Already legal |
| `upsertAwaitingResolution()` | `src/decisions/capture-state.ts:88` | Reads the AWAITING_RESOLUTION row in PP#0 | Already written by Phase 15 |
| `clearCapture()` | `src/decisions/capture-state.ts:78` | Clear state after post-mortem stored | Already exists |
| `getLastUserLanguage()` | `src/chris/language.ts:52` | Detect Greg's reply language | Already exists |
| `detectLanguage()` / `franc` | `src/chris/language.ts:29` | Language detection | Already exists |
| `getValue` / `setValue` | `src/proactive/state.ts:14–31` | proactive_state KV primitives for escalation keys | Extend |
| `ACCOUNTABILITY_SYSTEM_PROMPT` | `src/proactive/prompts.ts:39` | Sweep version (outreach prompt) | Exists; resolution version is different |
| `storePensieveEntry()` | `src/pensieve/store.ts:19` | Pensieve write primitive | Already exists |
| `buildMessageHistory()` | `src/memory/context-builder.ts:22` | Conversation history for LLM context | Already exists |
| `SONNET_MODEL` / `HAIKU_MODEL` | `src/llm/client.ts` | LLM tier constants | Already used in sweep |

### New Components Required

| Component | Location (recommended) | Purpose |
|-----------|------------------------|---------|
| `ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT` | `src/llm/prompts.ts` | Resolution conversation Sonnet prompt (distinct from sweep outreach) |
| `handleResolution()` | `src/decisions/resolution.ts` | AWAITING_RESOLUTION handler — acknowledgment + classification + post-mortem question |
| `handlePostmortem()` | `src/decisions/resolution.ts` | AWAITING_POSTMORTEM handler — store notes, transition reviewed, one-line ack |
| `classifyOutcome()` | `src/decisions/resolution.ts` | Haiku hit/miss/ambiguous/unverifiable classification |
| `getTemporalPensieve()` | `src/pensieve/retrieve.ts` | ±48h window query using `gte`/`lte` on `created_at` |
| `updateToAwaitingPostmortem()` | `src/decisions/capture-state.ts` | Write AWAITING_POSTMORTEM stage + store resolution text |
| `getEscalationCount()` / `setEscalationCount()` / `clearEscalationKeys()` | `src/proactive/state.ts` | Per-decision escalation tracking |
| Escalation logic in `runSweep()` | `src/proactive/sweep.ts` | Check AWAITING_RESOLUTION age, second prompt, stale transition |

---

## Architecture Patterns

### Pattern 1: PP#0 Branch Fill-in (SWEEP-03 + RES-03)

The engine PP#0 already has the branch structure. Phase 16 fills in the two fallthroughs:

```typescript
// src/chris/engine.ts — existing TODO comment at ~line 192
// AWAITING_RESOLUTION / AWAITING_POSTMORTEM / DONE → Phase 16 will handle; for now fall through.

// Phase 16 replaces the fallthrough:
if (activeCapture.stage === 'AWAITING_RESOLUTION') {
  const reply = await handleResolution(chatId, text, activeCapture.decisionId!);
  await saveMessage(chatId, 'USER', text, 'JOURNAL');
  await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
  return reply;
}
if (activeCapture.stage === 'AWAITING_POSTMORTEM') {
  const reply = await handlePostmortem(chatId, text, activeCapture.decisionId!);
  await saveMessage(chatId, 'USER', text, 'JOURNAL');
  await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
  return reply;
}
```

[VERIFIED: codebase — `src/chris/engine.ts` lines 163–229]

### Pattern 2: Mode Extension — ChrisMode + buildSystemPrompt

Add `'ACCOUNTABILITY'` to the union type and switch:

```typescript
// src/chris/personality.ts
export type ChrisMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE' | 'PHOTOS' | 'ACCOUNTABILITY';

// In buildSystemPrompt() switch:
case 'ACCOUNTABILITY':
  modeBody = ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT
    .replace('{decisionContext}', decisionContext || 'No decision context.')
    .replace('{pensieveContext}', contextValue);
  break;
```

[VERIFIED: codebase — `src/chris/personality.ts:12` and `:87–116`]

### Pattern 3: Praise Quarantine Bypass

One-line change at `praise-quarantine.ts:82`:

```typescript
// Before (existing):
if (mode === 'COACH' || mode === 'PSYCHOLOGY') {
  return response;
}

// After (Phase 16):
if (mode === 'COACH' || mode === 'PSYCHOLOGY' || mode === 'ACCOUNTABILITY') {
  return response;
}
```

[VERIFIED: codebase — `src/chris/praise-quarantine.ts:82`]

### Pattern 4: Pensieve Write with DECISION Tag + source_ref_id

The pattern is already established in `capture.ts`. Resolution handler reuses it:

```typescript
// src/decisions/capture.ts:229–235 — existing pattern for reference:
await db.insert(pensieveEntries).values({
  content: text,
  epistemicTag: 'DECISION',
  source: 'telegram',
  metadata: { chatId: chatId.toString(), sourceRefId },
}).returning({ id: pensieveEntries.id });
```

Note: `source_ref_id` is stored in `metadata.sourceRefId` (JSONB), NOT as a first-class column on `pensieve_entries`. The `decisions.sourceRefId` column on the `decisions` table is separate (links decisions back to their Pensieve capture entry). For resolution writes, use `metadata: { chatId, sourceRefId: decision.id }`.

[VERIFIED: codebase — `src/decisions/capture.ts:222–236`, `src/db/schema.ts:241`]

### Pattern 5: ±48h Temporal Pensieve Query

No existing temporal-window function in `retrieve.ts`. Implement as a new helper using `gte`/`lte`:

```typescript
// src/pensieve/retrieve.ts — new helper
import { gte, lte, and, isNull, asc } from 'drizzle-orm';

export async function getTemporalPensieve(
  centerDate: Date,
  windowHours: number = 48,
): Promise<typeof pensieveEntries.$inferSelect[]> {
  const lower = new Date(centerDate.getTime() - windowHours * 3_600_000);
  const upper = new Date(centerDate.getTime() + windowHours * 3_600_000);

  return await db
    .select({ entry: pensieveEntries })
    .from(pensieveEntries)
    .where(
      and(
        isNull(pensieveEntries.deletedAt),
        gte(pensieveEntries.createdAt, lower),
        lte(pensieveEntries.createdAt, upper),
      ),
    )
    .orderBy(asc(pensieveEntries.createdAt))
    .then(rows => rows.map(r => r.entry));
}
```

`gte`, `lte`, `and`, `isNull`, `asc` are all available from `drizzle-orm` (verified in existing usage across the codebase).

[VERIFIED: codebase — `src/proactive/triggers/deadline.ts:17` uses `lte, and, asc` from drizzle-orm; `src/pensieve/retrieve.ts` uses `isNull`]

### Pattern 6: proactive_state Key Conventions for Per-Decision Escalation

The existing `proactive_state` table is a simple KV store (`key: varchar(255) PK`, `value: jsonb`). The generic `getValue`/`setValue`/`deleteKey` helpers in `state.ts` handle everything.

For per-decision escalation, the pattern is:

```typescript
// In src/proactive/state.ts:
const escalationSentKey = (decisionId: string) => `accountability_sent_${decisionId}`;
const escalationCountKey = (decisionId: string) => `accountability_prompt_count_${decisionId}`;

export async function getEscalationSentAt(decisionId: string): Promise<Date | null> { ... }
export async function setEscalationSentAt(decisionId: string, t: Date): Promise<void> { ... }
export async function getEscalationCount(decisionId: string): Promise<number> { ... }
export async function setEscalationCount(decisionId: string, count: number): Promise<void> { ... }
export async function clearEscalationKeys(decisionId: string): Promise<void> {
  await deleteKey(escalationSentKey(decisionId));
  await deleteKey(escalationCountKey(decisionId));
}
```

Cleanup on `reviewed` or `stale` transition: call `clearEscalationKeys(decisionId)` at the end of `handlePostmortem()` and in the sweep's stale transition path.

[VERIFIED: codebase — `src/proactive/state.ts` — getValue/setValue/deleteKey pattern at lines 14–35]

### Pattern 7: Resolution Handler Flow (D-07, D-10)

The full sequence within `handleResolution(chatId, text, decisionId)`:

```typescript
// 1. Load decision row (prediction, falsification_criterion, language_at_capture, resolve_by)
// 2. Detect Greg's reply language via getLastUserLanguage / franc
// 3. Retrieve ±48h Pensieve entries around decision.resolve_by
// 4. Build ACCOUNTABILITY resolution context (prediction, criterion, temporal entries, Popper criterion)
// 5. Build conversation history via buildMessageHistory()
// 6. Sonnet call → acknowledgment text
// 7. transitionDecision(decisionId, 'due', 'resolved', { actor: 'system' })
// 8. UPDATE decisions SET resolution = text, updatedAt = now() WHERE id = decisionId
// 9. updateToAwaitingPostmortem(chatId, decisionId)  // sets stage = AWAITING_POSTMORTEM
// 10. classifyOutcome(text, prediction, criterion) → Haiku → 'hit'|'miss'|'ambiguous'|'unverifiable'
// 11. Sonnet call → class-specific post-mortem question (localized)
// 12. Fire-and-forget Pensieve write: Greg's resolution reply (DECISION, metadata.sourceRefId=decisionId)
// 13. Fire-and-forget Pensieve write: Chris's acknowledgment+question (DECISION, metadata.sourceRefId=decisionId)
// 14. clearEscalationKeys(decisionId)
// 15. Return concatenated: acknowledgment + "\n\n" + postmortem_question
```

Step 7 MUST precede step 8 (transition first, then update nullable column — the chokepoint handles status, the handler updates resolution text separately via a plain UPDATE). Step 9 MUST follow step 7 (stage update only valid after status transition). Steps 12–13 are fire-and-forget (do not await in the critical path — use `.catch(logger.warn)`).

[VERIFIED: codebase — `transitionDecision()` at `lifecycle.ts:75`, `updateCaptureDraft()` pattern at `capture-state.ts:61`, `capture.ts` fire-and-forget Pensieve write pattern]

### Pattern 8: Outcome Classification (D-12)

Haiku structured output for the four-class classification:

```typescript
// OUTCOME_CLASSIFICATION_PROMPT guides Haiku to output JSON only:
// { "outcome": "hit" | "miss" | "ambiguous" | "unverifiable" }
// Input: Greg's reply + original prediction + falsification criterion
// Never throws — fail-closed to 'ambiguous' on parse failure
```

Follows the same Haiku structured output pattern as `classifyStakes()` in `src/decisions/triggers.ts` (verified present in codebase).

[VERIFIED: codebase — `src/decisions/triggers.ts` (stakes classifier Haiku pattern)]

### Pattern 9: Post-Mortem Handler Flow (D-13)

```typescript
// handlePostmortem(chatId, text, decisionId):
// 1. Load decision row to get language_at_capture
// 2. Detect Greg's language via getLastUserLanguage
// 3. UPDATE decisions SET resolution_notes = text WHERE id = decisionId
// 4. transitionDecision(decisionId, 'resolved', 'reviewed', { actor: 'system' })
// 5. clearCapture(chatId)
// 6. clearEscalationKeys(decisionId)
// 7. Fire-and-forget: Pensieve write for Greg's post-mortem answer (DECISION, metadata.sourceRefId=decisionId)
// 8. Return one-line ack:
//    en: "Noted."  fr: "Noté."  ru: "Принято."
```

[VERIFIED: codebase — `clearCapture()` at `capture-state.ts:78`; `transitionDecision('resolved','reviewed')` legal in LEGAL_TRANSITIONS]

### Pattern 10: Sweep Escalation (D-15, D-16, D-17, D-18, RES-06)

Added to the accountability channel in `runSweep()`, after the existing deadline trigger block:

```
// After accountability outreach fires (or after cap check):
// For each AWAITING_RESOLUTION row that exists:
//   sentAt = getEscalationSentAt(decisionId)
//   count = getEscalationCount(decisionId)
//   if sentAt is null: set it now (first prompt was just sent — record timestamp)
//   elif count === 1 AND now - sentAt > 48h: fire second prompt, setCount(2)
//   elif count >= 2 AND now - lastSent > 48h: transitionDecision(id, 'due', 'stale'), clearCapture, clearEscalation
```

The sweep needs a new SQL helper to list all AWAITING_RESOLUTION rows. A simple `SELECT decision_id FROM decision_capture_state WHERE stage = 'AWAITING_RESOLUTION'` suffices.

[VERIFIED: codebase — `decisionCaptureState` schema at `db/schema.ts:276`; `hasSentTodayAccountability` pattern in `state.ts`]

### Recommended Project Structure

No new directories needed. New files:

```
src/
├── decisions/
│   ├── resolution.ts      # handleResolution(), handlePostmortem(), classifyOutcome()
│   └── ...                # existing: capture.ts, lifecycle.ts, capture-state.ts
├── chris/
│   └── personality.ts     # extend ChrisMode union + buildSystemPrompt() switch
├── chris/
│   └── praise-quarantine.ts  # one-line bypass extension
├── llm/
│   └── prompts.ts         # existing file — add ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT
├── pensieve/
│   └── retrieve.ts        # add getTemporalPensieve() helper
└── proactive/
    ├── state.ts            # add per-decision escalation key helpers
    └── sweep.ts            # add escalation check logic in accountability channel
```

### Anti-Patterns to Avoid

- **Double-transition guard:** Never call `transitionDecision(id, 'due', 'resolved')` twice. The optimistic concurrency WHERE clause will throw `OptimisticConcurrencyError` on the second call — this is correct behavior and must be allowed to propagate (not swallowed), otherwise AWAITING_POSTMORTEM could be set without a successful resolution transition.
- **Awaiting fire-and-forget:** Do NOT `await` the two Pensieve writes in `handleResolution()`. They must be fire-and-forget: `writePensieveEntry(...).catch(err => logger.warn({err}, '...'))`. Embedding is async and slow; blocking on it adds 200–500ms to Greg's response.
- **Resolution text UPDATE via transitionDecision:** `transitionDecision()` only sets `status`. The `resolution` text field must be written with a separate `db.update(decisions).set({ resolution: text })` — the chokepoint does not accept arbitrary field patches.
- **AWAITING_POSTMORTEM without resolution text:** Do not set stage=AWAITING_POSTMORTEM before writing `decisions.resolution`. If the stage update succeeds but the text write fails, Greg's post-mortem answer will be stored in `resolution_notes` with no `resolution` to pair it with.
- **Skipping abort-phrase check in PP#0 for resolution stages:** The abort-phrase check in PP#0 runs before stage detection. Current implementation at `engine.ts:~178` checks `isAbortPhrase(text, lang)` but reads `lang` from `draft.language_at_capture`. For AWAITING_RESOLUTION / AWAITING_POSTMORTEM, `draft` is `{}` (set by `upsertAwaitingResolution` as empty object). The resolution handler must read `language_at_capture` from the `decisions` table directly, not from `draft`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Outcome classification | Custom string matching on Greg's reply | Haiku JSON structured output (`classifyOutcome()`) | Free-text replies are ambiguous; hit/miss/ambiguous/unverifiable often require semantic inference |
| Language detection in resolution handler | Re-running franc inside resolution.ts | `getLastUserLanguage(chatId.toString())` from `language.ts` | Language is already tracked per-session by the engine; calling franc again would diverge if Greg uses a short message |
| Temporal Pensieve retrieval | Embedding search on the decision text | Direct SQL `gte`/`lte` on `created_at` | The query is time-based (what happened around resolve_by date), not semantic; embedding search would return thematically similar entries, not temporally adjacent ones |
| proactive_state cleanup | Let stale keys accumulate | `clearEscalationKeys(decisionId)` on reviewed/stale transition | The `proactive_state` table has no TTL; keys will accumulate and pollute the KV store if not cleaned up |
| Escalation timing | Wall-clock `setInterval` or new cron | Reuse existing sweep cadence + `proactive_state` timestamp | Adding a second scheduler for escalation creates a race condition with the main sweep; one sweep loop with timestamp-based checks is the established pattern |

---

## Common Pitfalls

### Pitfall 1: `draft` is `{}` for AWAITING_RESOLUTION rows

**What goes wrong:** Code reads `language_at_capture` from `activeCapture.draft` in the PP#0 branch. For AWAITING_RESOLUTION rows, `draft` was written as `{}` by `upsertAwaitingResolution()` — there is no `language_at_capture` in it.

**Why it happens:** Phase 14 capture stages always have `language_at_capture` in `draft` because they're created via `createCaptureDraft()`. But Phase 15's `upsertAwaitingResolution()` creates rows with `draft: {}`.

**How to avoid:** In `handleResolution()`, get language from: (1) `getLastUserLanguage(chatId.toString())` for Greg's current reply language, and (2) `decisions.languageAtCapture` from the decision row for the original capture language. Never read it from `activeCapture.draft` in the resolution path.

**Warning signs:** TypeScript: `(draft as CaptureDraft).language_at_capture` returns `undefined` for resolution-stage rows.

[VERIFIED: codebase — `upsertAwaitingResolution()` at `capture-state.ts:88–103` writes `draft: {}`]

### Pitfall 2: `updateToAwaitingPostmortem()` does not exist yet

**What goes wrong:** Code calls `updateToAwaitingPostmortem()` which does not exist in `capture-state.ts`.

**Why it happens:** The CONTEXT.md at line 141 notes "may need `updateToAwaitingPostmortem()` helper". The existing `updateCaptureDraft()` can set `nextStage` — but it requires the `draft` object, and `draft` is `{}` for resolution-stage rows (no CaptureDraft shape). Calling `updateCaptureDraft` would work mechanically but produces a confusing type.

**How to avoid:** Add a dedicated `updateToAwaitingPostmortem(chatId: bigint, decisionId: string): Promise<void>` to `capture-state.ts` that does a direct DB update: `SET stage = 'AWAITING_POSTMORTEM', decision_id = decisionId, updated_at = now()`.

[VERIFIED: codebase — `capture-state.ts` — no such function exists; `updateCaptureDraft` at line 61 requires a full `CaptureDraft`-shaped patch]

### Pitfall 3: transitionDecision throws on concurrent sweep + reply

**What goes wrong:** The sweep fires a second accountability prompt (escalation path) at the same moment Greg replies. Both code paths attempt `transitionDecision(id, 'due', 'resolved')`. The second call throws `OptimisticConcurrencyError`.

**Why it happens:** Optimistic concurrency is working correctly — the WHERE clause `WHERE id=$id AND status='due'` prevents double-transition. But if `OptimisticConcurrencyError` is not caught in the resolution handler, it surfaces as a 500 to Greg.

**How to avoid:** In `handleResolution()`, catch `OptimisticConcurrencyError` specifically: if caught, re-read the decision row — if `status === 'resolved'`, the concurrent path already handled it and this path should return a graceful message. Failing closed is acceptable; the decision is in a consistent state.

[VERIFIED: codebase — `lifecycle.ts:112–113` throws `OptimisticConcurrencyError`; `errors.ts` defines it]

### Pitfall 4: Embedded sweep escalation vs. accountability daily cap

**What goes wrong:** Escalation prompts count against `hasSentTodayAccountability()`. After a first outreach fires and is recorded, the escalation check (48h later) sees `hasSentTodayAccountability()` as true and skips the second prompt.

**Why it happens:** The accountability daily cap was designed for first-outreach prompts. If escalation prompts go through the same cap, they can never fire — the first-day outreach already consumed the cap, and a different day's cap check would pass but the escalation might fire on the same calendar day as a new deadline.

**How to avoid:** Escalation prompts should bypass the `hasSentTodayAccountability()` check. The daily cap guards cold outreach to prevent spam; escalation is a follow-up on an already-open resolution and should fire based purely on the 48h timestamp check. Implement escalation as a separate code path in the accountability channel after the cap check.

[VERIFIED: codebase — `sweep.ts:83` checks `hasSentTodayAccountability()` before deadline trigger; escalation must run independently]

### Pitfall 5: AWAITING_POSTMORTEM stage rows never cleared on stale transition

**What goes wrong:** A decision transitions to `stale` while in AWAITING_RESOLUTION. But if Greg later replies (late message delivery), PP#0 still finds the capture row in AWAITING_RESOLUTION stage and routes to `handleResolution()` — which then fails because `transitionDecision('due', 'resolved')` throws (`due→stale` already happened; current status is `stale`).

**Why it happens:** The stale transition in the sweep clears the proactive_state keys but does not call `clearCapture()`.

**How to avoid:** When transitioning to stale in the sweep, also call `clearCapture(chatId)`. If Greg replies after stale, PP#0 finds no active capture and falls through to normal mode detection — the message is processed as a regular journal entry.

[VERIFIED: codebase — `clearCapture()` at `capture-state.ts:78`; stale transition in sweep does not currently call it (Phase 15 sweep only calls `upsertAwaitingResolution`, not the inverse)]

### Pitfall 6: Resolution text UPDATE outside the chokepoint

**What goes wrong:** Developer puts `SET resolution = text` inside a custom transaction alongside `transitionDecision()`, or modifies `transitionDecision()` to accept resolution text as a parameter.

**Why it happens:** It seems clean to do everything atomically. But `transitionDecision()` is a locked chokepoint (D-03). Modifying it adds coupling between the lifecycle layer and the resolution-text domain.

**How to avoid:** The `resolution` column is nullable (`decisions.resolution: text('resolution')` with no `.notNull()`). Do two separate operations: (1) `transitionDecision(id, 'due', 'resolved')`, then (2) `db.update(decisions).set({ resolution: text, updatedAt: new Date() }).where(eq(decisions.id, id))`. The two-step is fine; if step 2 fails after step 1 succeeds, the decision is correctly in `resolved` status with a null `resolution` text — which is a valid (if incomplete) state that `handlePostmortem()` should handle gracefully.

[VERIFIED: codebase — `decisions` schema at `src/db/schema.ts:228` — `resolution: text('resolution')` with no `.notNull()`]

---

## Code Examples

### Haiku Outcome Classification

```typescript
// Source: inferred from classifyStakes() pattern in src/decisions/triggers.ts
const OUTCOME_CLASSIFICATION_PROMPT = `You are an outcome classifier.

Given Greg's account of what happened, the original prediction, and the falsification criterion,
classify the outcome into exactly one of four categories.

Respond with ONLY valid JSON: {"outcome": "hit" | "miss" | "ambiguous" | "unverifiable"}

Definitions:
- hit: The prediction was confirmed by the falsification criterion
- miss: The prediction was falsified by the criterion
- ambiguous: Both sides have merit; the criterion is met in some ways but not others
- unverifiable: It is not possible to determine whether the criterion was met`;

// Input message: "Prediction: X\nCriterion: Y\nGreg's account: Z"
// Never throws — fail-closed to 'ambiguous'
```

[VERIFIED: pattern from `src/decisions/triggers.ts` stakes classification Haiku call]

### ±48h Temporal Pensieve Context Builder

```typescript
// In resolution handler, after getTemporalPensieve():
function buildTemporalContext(entries: PensieveEntry[]): string {
  if (entries.length === 0) return 'No surrounding Pensieve entries found.';
  return entries
    .map(e => {
      const date = new Date(e.createdAt!).toISOString().slice(0, 10);
      return `(${date}) ${e.content}`;
    })
    .join('\n');
}
```

[ASSUMED: format is analogous to `buildPensieveContext()` in `src/memory/context-builder.ts`]

### ACCOUNTABILITY Resolution System Prompt (skeleton)

```typescript
export const ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT = `You are Chris. Greg made a prediction and you're now reviewing what actually happened.

## Decision context
{decisionContext}

## Surrounding Pensieve entries (±48h around deadline)
{pensieveContext}

Your task: Acknowledge what Greg said actually happened. Neutral-factual. One paragraph max.

Hard rules:
- NEVER say "you were right", "great call", "you called it", or any flattery.
- NEVER say "you were wrong", "you failed", or tie the outcome to Greg as a person.
- NEVER attribute the outcome to Greg's character or track record.
- The Hard Rule (D027) is explicitly forbidden: do not use Greg's past performance as evidence.
- ALWAYS write in Greg's current language (see language directive below).
- One paragraph. Then stop — the post-mortem question comes separately.`;
```

[ASSUMED: wording is for planner draft; executor tunes]

### proactive_state Escalation Key Helpers

```typescript
// Source: pattern from src/proactive/state.ts lines 14–35
const escalationSentKey = (id: string) => `accountability_sent_${id}`;
const escalationCountKey = (id: string) => `accountability_prompt_count_${id}`;

export async function getEscalationSentAt(decisionId: string): Promise<Date | null> {
  const val = await getValue(escalationSentKey(decisionId));
  return val ? new Date(val as string) : null;
}

export async function incrementEscalationCount(decisionId: string): Promise<number> {
  const current = ((await getValue(escalationCountKey(decisionId))) as number) ?? 0;
  const next = current + 1;
  await setValue(escalationCountKey(decisionId), next);
  return next;
}

export async function clearEscalationKeys(decisionId: string): Promise<void> {
  await deleteKey(escalationSentKey(decisionId));
  await deleteKey(escalationCountKey(decisionId));
}
```

[VERIFIED: pattern from `src/proactive/state.ts`]

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| PP#0 AWAITING_RESOLUTION/POSTMORTEM fallthrough | Phase 16 fills in the handlers | The branch exists with "Phase 16 will handle" comment |
| No ACCOUNTABILITY mode in ChrisMode | Add to union + buildSystemPrompt switch | Pattern established by COACH, PSYCHOLOGY, etc. |
| No per-decision escalation keys | New keys in proactive_state KV | Generic getValue/setValue already generic enough |
| No temporal Pensieve retrieval | New `getTemporalPensieve()` helper | Drizzle gte/lte operators already in use elsewhere |

**Existing but needs extension:**
- `decisionCaptureState`: Has AWAITING_POSTMORTEM stage in enum but no helper writes it yet — `updateToAwaitingPostmortem()` is new.
- `decisions` table: `resolution` and `resolutionNotes` columns exist but are never written yet (schema comment: "Phase 16 fills").

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT wording (skeleton above) | Code Examples | Low — planner drafts, executor tunes; the structural constraints are verified |
| A2 | Optimal format for the `buildTemporalContext()` output string | Code Examples | Low — format is cosmetic; function signature and SQL query are what matter |
| A3 | Escalation logic runs after (not inside) the daily cap check in sweep.ts | Architecture Patterns §10 | Medium — if wrong, escalation prompts may be throttled unexpectedly; mitigated by Pitfall 4 |

**All other claims are VERIFIED against the codebase or CITED to specific file/line.**

---

## Open Questions

1. **Should `updateToAwaitingPostmortem()` also store the decisionId on the row?**
   - What we know: `decisionCaptureState.decisionId` is already set by `upsertAwaitingResolution()` for AWAITING_RESOLUTION rows.
   - What's unclear: When transitioning to AWAITING_POSTMORTEM within the same resolution flow, `decisionId` should already be on the row. The update only needs to change `stage`.
   - Recommendation: `updateToAwaitingPostmortem()` updates `stage = 'AWAITING_POSTMORTEM'` only; does not need to re-set `decisionId`. Verify `decisionId` is not null before the update.

2. **Two-part reply: concatenated string vs. two Telegram API calls?**
   - What we know: CONTEXT.md D-10 says "Greg sees a two-part reply: acknowledgment + follow-up question." This is Claude's discretion.
   - What's unclear: Whether a single concatenated message (with `\n\n` separator) or two sequential `bot.api.sendMessage` calls is better UX.
   - Recommendation: Single concatenated string returned from `handleResolution()`. The engine layer calls `saveMessage` once and returns. If UX testing shows it feels abrupt, the executor can split. Simpler to implement and test.

3. **Which AWAITING_RESOLUTION rows does the sweep escalation check?**
   - What we know: `decision_capture_state` has `chatId` as PK, and the sweep currently sends to `config.telegramAuthorizedUserId` (single-user system).
   - What's unclear: The sweep needs to enumerate AWAITING_RESOLUTION rows that are stale enough for escalation. A `SELECT` on `decisionCaptureState WHERE stage = 'AWAITING_RESOLUTION'` gives all of them. With a single user this is at most a handful.
   - Recommendation: Query all AWAITING_RESOLUTION rows in the sweep's escalation block; loop over them. `decisionId` is on each row; use it to look up `proactive_state` escalation keys.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 16 is a pure code change. No new external dependencies. Existing stack (PostgreSQL, Anthropic API, Telegram Bot API, Node.js) is already operational from prior phases.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed in `vitest.config.ts`) |
| Config file | `/home/claude/chris/vitest.config.ts` |
| Quick run command | `npx vitest run src/decisions/__tests__/resolution.test.ts` |
| Full suite command | `npm test` (Docker + PostgreSQL + all migrations) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RES-01 | ACCOUNTABILITY mode bypasses praise quarantine | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | ✅ (extend existing) |
| RES-01 | `buildSystemPrompt('ACCOUNTABILITY', ...)` includes Hard Rule | unit | `npx vitest run src/chris/__tests__/personality.test.ts` | ✅ (extend existing) |
| RES-02 | PP#0 routes AWAITING_RESOLUTION to resolution handler | integration | `npx vitest run src/decisions/__tests__/engine-resolution.test.ts` | ❌ Wave 0 |
| RES-03 | `handleResolution()` transitions `due → resolved`, stores `resolution` text | integration | `npx vitest run src/decisions/__tests__/resolution.test.ts` | ❌ Wave 0 |
| RES-04 | `handlePostmortem()` stores `resolution_notes`, transitions `resolved → reviewed`, clears capture | integration | `npx vitest run src/decisions/__tests__/resolution.test.ts` | ❌ Wave 0 |
| RES-04 | Two Pensieve entries written with `DECISION` tag + `metadata.sourceRefId` | integration | `npx vitest run src/decisions/__tests__/resolution.test.ts` | ❌ Wave 0 |
| RES-05 | `getTemporalPensieve()` returns only entries within ±48h window | unit | `npx vitest run src/pensieve/__tests__/retrieve.test.ts` | ✅ (extend existing) |
| RES-06 | Escalation: second prompt fires after 48h | integration | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts` | ❌ Wave 0 |
| RES-06 | Stale transition fires after 2 non-replies + `clearCapture` called | integration | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts` | ❌ Wave 0 |
| RES-01 | `classifyOutcome()` returns correct class for hit/miss/ambiguous/unverifiable | unit (mock Haiku) | `npx vitest run src/decisions/__tests__/resolution.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/decisions/__tests__/resolution.test.ts src/chris/__tests__/praise-quarantine.test.ts`
- **Per wave merge:** `npm test` (full Docker suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/decisions/__tests__/resolution.test.ts` — covers RES-03, RES-04 (handleResolution, handlePostmortem, classifyOutcome)
- [ ] `src/decisions/__tests__/engine-resolution.test.ts` — covers RES-02 (PP#0 routing for AWAITING_RESOLUTION/AWAITING_POSTMORTEM)
- [ ] `src/proactive/__tests__/sweep-escalation.test.ts` — covers RES-06 (48h escalation, stale transition)

*(Existing `praise-quarantine.test.ts`, `personality.test.ts`, and `retrieve.test.ts` need extension, not new files.)*

---

## Security Domain

This phase adds no new authentication surfaces, no new external endpoints, and no new user-controlled inputs beyond what the existing engine PP#0 already handles. The Telegram message routing and engine pre-processor security model are unchanged.

**Applicable ASVS categories:**

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth surface |
| V3 Session Management | No | No new sessions |
| V4 Access Control | No | Single-user system, no new command surface |
| V5 Input Validation | Yes (existing) | Greg's resolution text is user input; engine PP#0 already validates length (100,000 char max) before reaching resolution handler |
| V6 Cryptography | No | No new secrets, no new key handling |

---

## Sources

### Primary (HIGH confidence — verified in codebase)
- `src/chris/engine.ts` lines 163–229 — PP#0 structure, AWAITING_RESOLUTION/AWAITING_POSTMORTEM fallthrough
- `src/chris/personality.ts` — ChrisMode union, buildSystemPrompt() switch, CONSTITUTIONAL_PREAMBLE
- `src/chris/praise-quarantine.ts` lines 78–84 — bypass pattern for COACH/PSYCHOLOGY
- `src/decisions/lifecycle.ts` lines 16–25 — LEGAL_TRANSITIONS map confirming due→resolved, resolved→reviewed, due→stale
- `src/decisions/capture-state.ts` — upsertAwaitingResolution(), clearCapture(), DecisionCaptureStage type
- `src/decisions/capture.ts` lines 222–236 — writePensieveEntry() pattern with DECISION tag + metadata.sourceRefId
- `src/proactive/state.ts` — getValue/setValue/deleteKey generics, channel-aware helpers
- `src/proactive/sweep.ts` lines 1–160 — accountability channel architecture, daily cap pattern
- `src/proactive/prompts.ts` — ACCOUNTABILITY_SYSTEM_PROMPT (sweep version, distinct from resolution version)
- `src/pensieve/retrieve.ts` — searchPensieve(), hybridSearch(), no existing temporal-window function
- `src/db/schema.ts` — decisions table columns (resolution, resolutionNotes nullable; sourceRefId on decisions not on pensieveEntries), decisionCaptureState schema
- `src/chris/language.ts` — getLastUserLanguage(), detectLanguage(), franc usage
- `src/decisions/triggers.ts` — Haiku structured output pattern for classification (classifyStakes reference)
- `vitest.config.ts` — test framework configuration
- `scripts/test.sh` — full test suite (Docker + PostgreSQL)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions D-01 through D-18 — user-locked implementation decisions
- REQUIREMENTS.md RES-01 through RES-06 — requirement definitions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified in codebase with file/line citations
- Architecture: HIGH — patterns derived from existing code, not assumed
- Pitfalls: HIGH — each pitfall traced to a specific verified code artifact
- Prompt wording (ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT): ASSUMED — structural constraints verified, exact wording is planner draft

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable internal codebase; no external dependency changes expected)
