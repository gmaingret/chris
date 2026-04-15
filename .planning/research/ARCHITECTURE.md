# Architecture Research — M007 Decision Archive Integration

**Domain:** Telegram bot / Node.js ESM / Drizzle + Postgres (existing Chris architecture)
**Researched:** 2026-04-15
**Confidence:** HIGH (grounded in direct reading of live codebase files)

> This is an **integration** document for a subsequent milestone. The existing engine, proactive sweep, schema, and Grammy bot wiring are already built and must not be redesigned. Everything below maps how M007 Decision Archive plugs into those structures.

---

## 1. Existing Architecture (Verified Inventory)

```
┌─────────────────────────── Grammy Bot (src/bot/bot.ts) ──────────────────────────┐
│   bot.use(auth)                                                                 │
│   bot.command('sync', handleSyncCommand)   ← existing slash-command pattern     │
│   bot.on('message:text',   handleTextMessage)                                   │
│   bot.on('message:document', handleDocument)                                    │
│   Special interception: isAwaitingOAuthCode(chatId) in handleTextMessage        │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ processMessage(chatId, userId, text)
                                       ▼
┌──────────────────────── Chris Engine (src/chris/engine.ts) ─────────────────────┐
│ Pre-processing (order matters, each can short-circuit with saveMessage + return)│
│   1. detectMuteIntent        → setMuteUntil + ack                               │
│   2. detectRefusal           → addDeclinedTopic + ack                           │
│   3. detectLanguage          → setLastUserLanguage (franc)                      │
│ Mode detection: detectMode() Haiku → ChrisMode                                  │
│ Routing:   handleJournal / Interrogate / Reflect / Coach / Psychology / Produce │
│           / Photos           (all stateless, take chatId+text+lang+declined)    │
│ Post-processing:                                                                │
│   • Praise quarantine   (JOURNAL/REFLECT/PRODUCE, 3s race)                      │
│   • Contradiction det.  (JOURNAL/PRODUCE, 3s race, fire-and-forget notice)      │
│   • saveMessage(ASSISTANT)                                                      │
│   • void writeRelationalMemory()  (JOURNAL only, fire-and-forget)               │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
┌──────────────── Proactive Sweep (src/proactive/sweep.ts, cron) ─────────────────┐
│ Gates: isMuted → hasSentToday                                                   │
│ Phase 1 (parallel SQL): createSilenceTrigger, createCommitmentTrigger           │
│ Phase 2 (Opus, only if Phase 1 empty): pattern, thread                          │
│ Priority sort → winner → Sonnet generation → bot.api.sendMessage                │
│ State update: setLastSent                                                       │
│ Each trigger: { detect(): Promise<TriggerResult> } with priority number         │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
┌───────────────────── Drizzle Schema (src/db/schema.ts) ─────────────────────────┐
│ pgEnum  + pgTable; auto-migrated on startup                                    │
│ Relevant existing tables: pensieve_entries, conversations, proactive_state     │
│ proactive_state is a generic k/v (varchar key, jsonb value) — reusable         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Confirmed patterns to reuse (not reinvent):**
- Pre-processor signature: sync or async function that inspects `text`, mutates session/DB state, and returns either an acknowledgement (short-circuit) or nothing (pass-through).
- Trigger detector signature: `TriggerDetector { detect(): Promise<TriggerResult> }` with a numeric `priority` field — already supports N triggers.
- Command handler signature: `async (ctx) => void`, registered on `bot.command(...)` **before** the generic text handler.
- Session state: two patterns exist — (a) process-local `Map<chatIdStr, ...>` (refusal declined topics, language — resets on restart), (b) durable `proactive_state` k/v in Postgres (mute, last_sent).
- Fire-and-forget side effects: `void someAsync()` with internal try/catch + logger.warn.

---

## 2. Question-by-Question Integration Decisions

### (a) Where does decision trigger-phrase detection live?

**Decision:** New **pre-processor** in `src/chris/engine.ts`, running **after** refusal/language detection and **before** `detectMode()`. Not a mode. Not post-processing.

**Placement rationale:**
- Mute/refusal/language pre-processors already demonstrate the exact pattern needed: cheap synchronous pattern match → if hit, short-circuit with an acknowledgement and save to conversations.
- Making it a mode would require Haiku mode-detection to reliably route "I'm thinking about leaving this job" to a new `DECIDE` mode. Haiku mode detection is probabilistic (defaults to JOURNAL on error) and adding a seventh high-stakes target raises classifier fragility. Regex triggers in M007's spec are deterministic and bilingual — the same rationale D020 used for refusal.
- Post-processing is wrong: the trigger phrase is in the user's message, not Chris's response. By post-processing time Chris has already answered in some other mode.

**Trade-offs:**

| Option | Pro | Con |
|---|---|---|
| **Pre-processor (chosen)** | Deterministic, bilingual regex, consistent with refusal/mute pattern, cheap | False positives on meta-talk ("I told her I'm thinking about it") — must use same meta-reference negative-lookahead guards refusal uses |
| New `DECIDE` mode | Lets Haiku disambiguate meta vs. actual | Classifier latency + cost on every message, behavior regression risk across all modes, classifier drift |
| Post-processing | — | Wrong layer; user intent isn't in Chris's output |

**Important subtlety — not a short-circuit, but a state-opener.** Unlike refusal/mute (which fully answer and return), the decision pre-processor must **open a capture sub-conversation** and then let a **dedicated handler** take over for the next N turns. This is closer to the `isAwaitingOAuthCode(chatId)` interception in `bot.ts` than to the existing engine pre-processors. Concretely:

1. Engine pre-processor detects trigger phrase → writes a new `decision_capture_state` row (chatId, stage=1, draft jsonb) → responds with Question 1 → `saveMessage(ASSISTANT)` → return.
2. On every subsequent message, engine pre-processor checks `decision_capture_state` for this chatId **first** (before mute/refusal/language/mode). If an active capture exists, route to `handleDecisionCapture(chatId, text, state)` which advances the stage, persists the draft, and either emits the next question or finalizes into `decisions` + `pensieve_entries`.
3. Escape hatch: if `text` matches an abort phrase ("stop / skip / never mind / annule / отмена"), clear the state and fall through to normal engine flow.

### (b) How is the 5-question guided sub-conversation implemented?

**Decision:** **New `decision_capture_state` table**, not overloaded `conversations`.

**Why not reuse `conversations`:** `conversations` is an append-only transcript indexed by (chatId, createdAt). It has no "stage" column, no draft jsonb, no active flag. Querying "is this chat currently mid-capture?" would require scanning recent rows and parsing content, which is slow and fragile. `conversations` is a log, not a state machine.

**Why not reuse `proactive_state`:** k/v is fine for a single scalar per chat, but the capture draft has structure (decision text, alternatives[], reasoning, prediction, falsification, timeframe) and should be typed at the Drizzle layer, not stuffed into opaque jsonb.

**Recommended schema addition:**

```typescript
export const decisionCaptureStage = pgEnum('decision_capture_stage', [
  'DECISION', 'ALTERNATIVES', 'REASONING', 'PREDICTION', 'FALSIFICATION', 'DONE',
]);

export const decisionCaptureState = pgTable('decision_capture_state', {
  chatId: bigint('chat_id', { mode: 'bigint' }).primaryKey(), // one active capture per chat
  stage: decisionCaptureStage('stage').notNull(),
  draft: jsonb('draft').notNull(),             // partial decision being built
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

- `primaryKey(chatId)` enforces at most one active capture per chat (single-user bot → effectively one active capture globally).
- Abandoned captures: add a sweep-time GC that drops rows older than N hours (e.g., 24h). Greg can resume a capture with `/decision continue` — optional, defer.
- The **terminal commit** on stage DONE: transactionally insert into `decisions`, insert a summary into `pensieve_entries` with `epistemic_tag='INTENTION'` (or a new tag `DECISION` if added to the enum), and delete the capture state row.

**Resolution flow** reuses the same table with a different `stage` value set (`AWAITING_RESOLUTION`, `AWAITING_POSTMORTEM`) — see (f).

### (c) How does the forecast deadline scheduler integrate?

**Decision:** Add as a **fifth SQL-gated trigger in the existing proactive sweep**, not a separate cron.

**Placement rationale:**
- It is a classic cheap-SQL gate: `SELECT … FROM decisions WHERE status='open' AND resolve_by < NOW() LIMIT 1`. This is exactly the Phase 1 trigger shape (commitment uses the same pattern against pensieve_entries).
- Running it in the existing sweep inherits: mute check, daily cap, bot client, Sonnet generation path, `saveMessage(ASSISTANT)`, `setLastSent`. A separate cron would duplicate all of that.
- Priority ordering: insert as **priority 2**, between silence (1) and commitment (3) — a decision's `resolve_by` passing is time-sensitive and has an explicit deadline that shouldn't be displaced by generic staleness. Pattern becomes 4, thread becomes 5. (Confirm with Greg before reordering commitment, but deadline-driven triggers have higher epistemic urgency.)

**Trigger semantics — two actions, one detect call:**

The trigger has a **side effect**: when it fires, it must also transition matching rows from `open` → `due`. Two options:

1. **Transition inside `detect()`** (simpler, current architecture). detect() runs, advances state, returns a TriggerResult whose context includes the prediction text for Sonnet. Downside: detect() is no longer side-effect-free, which breaks the cosmetic purity of the existing triggers.
2. **Transition after winner selection** (cleaner). detect() returns the candidate decision id; if this trigger wins, sweep.ts calls `markDecisionDue(id)` before sending. Downside: the other decisions that also matched stay in `open` until next sweep.

Recommend **(1)** with the transition bounded to the **single row that will be surfaced** (the oldest `open` decision past `resolve_by`). Unfired decisions stay `open`; they'll transition when they become the oldest, one per day (aligned with daily cap). This keeps status changes visible and one-per-message.

**New trigger file:** `src/proactive/triggers/decision-deadline.ts` implementing `TriggerDetector`. TriggerResult.triggerType enum needs extending to `'silence' | 'commitment' | 'decision-deadline' | 'pattern' | 'thread'` in `types.ts`.

### (d) State machine enforcement — DB vs application vs both?

**Decision:** **Both**, following Chris's existing conventions.

**DB layer (structural constraints):**
- `status` column is a `pgEnum`: `open | due | resolved | reviewed` — enforced at the type/column level already.
- Add a `CHECK` constraint that enforces required fields per state: `resolved` requires non-null `resolution` and `resolution_notes`; `reviewed` requires non-null `reviewed_at`. (`ALTER TABLE decisions ADD CONSTRAINT …` in a migration.)
- **Do NOT** try to express the transition graph in SQL triggers. That's overkill for a single-writer system.

**Application layer (transition function):**
- Central `transitionDecision(id, to, payload)` in `src/decisions/lifecycle.ts` with a validated transition map `{ open: ['due'], due: ['resolved'], resolved: ['reviewed'] }`. Throws `InvalidTransitionError` on illegal moves. No implicit transitions — the spec explicitly demands this.
- All state changes go through this function. The decision-deadline trigger, the resolution handler, and the post-mortem handler all call it.

**Rationale:** Chris's existing enum columns (conversationMode, epistemicTag, contradictionStatus) follow exactly this pattern — DB enforces the value set, application enforces the transitions. A pure application-layer approach loses protection against stray SQL writes (manual fixes, future admin scripts); a pure SQL approach buries the lifecycle rules out of sight and is hard to test.

### (e) Where does `/decisions` Telegram command fit?

**Decision:** Alongside `/sync` in `src/bot/bot.ts`, same registration pattern.

```typescript
// src/bot/bot.ts — add after /sync
bot.command('decisions', handleDecisionsCommand as any);
```

**Implementation location:** `src/bot/handlers/decisions.ts`, mirroring `src/bot/handlers/sync.ts` structure:
- Sub-commands via first-arg parsing: `/decisions` (default: open + recent), `/decisions stats`, `/decisions stats 90d`, `/decisions open`.
- Reuse the formatting helper pattern from sync.ts (`formatRelativeTime`, `formatSyncStatus`). Add `formatDecisionList`, `formatAccuracyStats`.
- Accuracy stats call Haiku to classify each (prediction, resolution) pair as CORRECT/PARTIAL/WRONG. **Cache the classification** on the `decisions` row (add `accuracy_class` and `accuracy_classified_at` columns) so `/decisions stats` over 365 days doesn't re-run 100+ Haiku calls every time Greg types the command.

**Command registration ordering is a gotcha:** existing bot.ts comment says "must be registered before generic text handler" — same holds here. Register before `bot.on('message:text', ...)`.

### (f) Data flow for resolution — how does the engine recognize "this is a resolution response"?

**Decision:** Same `decision_capture_state` table is reused, with a `stage` value that indicates "awaiting resolution for decision X". The engine pre-processor checks this **first**, just like the capture sub-conversation.

**Full flow:**

```
Day D-7: Greg captures decision D1 with resolve_by = D+0.
         → decisions row (status='open'), pensieve INTENTION entry.

Day D (sweep): decision-deadline trigger fires.
         → transitionDecision(D1, 'due')
         → Sonnet generates surfacing: "On {capturedAt} you predicted {prediction}. What actually happened?"
         → Before sending, INSERT INTO decision_capture_state
              (chatId, stage='AWAITING_RESOLUTION', draft={decisionId: D1})
         → bot.api.sendMessage + saveMessage(ASSISTANT) + setLastSent.

Day D (Greg replies): handleTextMessage → processMessage
         → Engine pre-processor (NEW, runs first): getActiveDecisionCapture(chatId)
           finds AWAITING_RESOLUTION row → route to handleResolutionResponse(D1, text)
         → handleResolutionResponse:
              • writes resolution + resolution_notes stub to decisions
              • transitionDecision(D1, 'resolved')
              • saves pensieve entry (source='telegram', tag='EXPERIENCE')
              • moves state row to stage='AWAITING_POSTMORTEM'
              • asks follow-up ("what would you do differently? what surprised you?")
              • saveMessage(ASSISTANT), return.

Day D (Greg replies again): same pre-processor finds AWAITING_POSTMORTEM
         → handlePostmortemResponse(D1, text):
              • appends to resolution_notes
              • sets reviewed_at, transitionDecision(D1, 'reviewed')
              • saves pensieve entry
              • deletes decision_capture_state row
              • generic closing ack, return.
```

**Why this works without mode-detection regressions:** the pre-processor intercepts before `detectMode()` runs, so the resolution response never reaches Haiku / any mode handler. This mirrors the existing `isAwaitingOAuthCode(chatId)` pattern in `bot.ts` — Chris already knows how to branch on "is this chat in a multi-turn sub-flow".

**Escape hatch is important:** if Greg replies with an abort phrase, or the response is clearly unrelated (Haiku sanity check with 2s timeout — optional), the sub-flow surrenders and the message is processed normally. Spec doesn't require this, but it prevents the pre-processor from hijacking messages that Greg intended as normal journal input.

---

## 3. Integration Diagram (Composite)

```
─────────────────────── Incoming Telegram message ──────────────────────
                                 │
                                 ▼
                    bot.on('message:text') [bot.ts]
                                 │
                  ┌──────────────┴──────────────┐
                  │                             │
          isAwaitingOAuthCode?            processMessage()
          (existing)                      [engine.ts]
                                                │
   ┌────────────────────────────────────────────┤
   │  NEW PRE-PROCESSOR #0 — Decision sub-flow │
   │    getActiveDecisionCapture(chatId)       │
   │    ├─ AWAITING_RESOLUTION  → handleResolutionResponse → return
   │    ├─ AWAITING_POSTMORTEM  → handlePostmortemResponse → return
   │    ├─ stages 1–5 (capture) → handleDecisionCapture    → return
   │    └─ none → fall through                             │
   ├────────────────────────────────────────────┤
   │  Existing: mute → refusal → language       │
   ├────────────────────────────────────────────┤
   │  NEW PRE-PROCESSOR #1 — Decision trigger  │
   │    detectDecisionTrigger(text, lang)      │
   │    ├─ match → insert decision_capture_state (stage=DECISION)
   │    │          → ask Q1 → saveMessage → return
   │    └─ no match → fall through             │
   ├────────────────────────────────────────────┤
   │  detectMode() + mode handler               │
   │  Post-processing: praise, contradictions   │
   └────────────────────────────────────────────┘

────────────────── Proactive Sweep (cron, sweep.ts) ───────────────────
   Gates: muted? sentToday?
   Phase 1 SQL (parallel):
     silence (p=1)   commitment (p=3 — renumbered)
     NEW: decision-deadline (p=2)
   Phase 2 Opus (only if Phase 1 empty): pattern (4), thread (5)
   Winner → Sonnet → send → state update
                 │
                 └─ If winner=decision-deadline:
                    transitionDecision(id, 'due') + INSERT decision_capture_state
                    (stage=AWAITING_RESOLUTION) BEFORE sendMessage.

──────────────────── Slash commands (bot.ts) ──────────────────────────
   /sync         [existing]
   NEW: /decisions  → handleDecisionsCommand
        sub-cmds: open, stats, stats <window>

─────────────────────── Drizzle schema (schema.ts) ────────────────────
   NEW enum: decision_status (open/due/resolved/reviewed)
   NEW enum: decision_capture_stage (DECISION/ALTERNATIVES/REASONING/
             PREDICTION/FALSIFICATION/AWAITING_RESOLUTION/AWAITING_POSTMORTEM/DONE)
   NEW table: decisions
   NEW table: decision_capture_state (PK=chat_id)
   MODIFY: TriggerResult.triggerType union in triggers/types.ts
   MODIFY (optional): epistemic_tag enum += 'DECISION' (or reuse INTENTION)
```

---

## 4. New vs Modified Components

| Component | New / Modified | File | Notes |
|---|---|---|---|
| `decisions` table | **NEW** | `src/db/schema.ts` + migration | 11 columns per spec + `accuracy_class`, `accuracy_classified_at` |
| `decision_capture_state` table | **NEW** | `src/db/schema.ts` + migration | PK chat_id, stage enum, draft jsonb |
| `decision_status` pgEnum | **NEW** | schema.ts | open/due/resolved/reviewed |
| `decision_capture_stage` pgEnum | **NEW** | schema.ts | 8 values (5 capture + resolution/postmortem + DONE) |
| CHECK constraints for status | **NEW** | migration SQL | resolved→resolution not null, reviewed→reviewed_at not null |
| Trigger detection module | **NEW** | `src/decisions/triggers.ts` | Bilingual EN/FR/RU regex with meta-reference guards (reuse refusal.ts patterns) |
| Capture handler | **NEW** | `src/decisions/capture.ts` | State-machine over decision_capture_stage |
| Lifecycle module | **NEW** | `src/decisions/lifecycle.ts` | `transitionDecision()` with validated transition map |
| Resolution handler | **NEW** | `src/decisions/resolution.ts` | handleResolutionResponse + handlePostmortemResponse |
| Decision-deadline trigger | **NEW** | `src/proactive/triggers/decision-deadline.ts` | Implements TriggerDetector, priority=2 |
| `/decisions` command handler | **NEW** | `src/bot/handlers/decisions.ts` | Mirrors sync.ts structure |
| Accuracy classifier | **NEW** | `src/decisions/accuracy.ts` | Haiku classify + cache on row |
| `processMessage()` | **MODIFIED** | `src/chris/engine.ts` | Add pre-processor #0 (sub-flow check) and pre-processor #1 (trigger detection), both before existing pre-processors |
| `TriggerResult.triggerType` union | **MODIFIED** | `src/proactive/triggers/types.ts` | Add `'decision-deadline'` |
| `sweep.ts` Phase 1 triggers | **MODIFIED** | `src/proactive/sweep.ts` | Add createDecisionDeadlineTrigger to sqlTriggers array; update priority comments |
| `bot.ts` | **MODIFIED** | `src/bot/bot.ts` | Register `bot.command('decisions', …)` before text handler |
| Synthetic fixture test | **NEW** | `src/decisions/__tests__/lifecycle.integration.test.ts` | Mock clock via injectable `now()`; assert captures, deadline fires, transitions block illegal moves |

**Minor open question — epistemic tag:** Do decision summaries go into `pensieve_entries` as `INTENTION` (existing tag, already used by commitment trigger) or a new `DECISION` tag? Adding `DECISION` is cleaner (and lets commitment trigger avoid picking them up), but requires enum migration. Recommend: **new DECISION tag** + update commitment trigger's `inArray(…, ['INTENTION'])` to stay `['INTENTION']` (so decisions don't double-fire as stale commitments).

---

## 5. Suggested Build Order

The downstream consumer (roadmap author) asked for a dependency-respecting build order. Strict topological order:

### Phase 1 — Schema & Lifecycle Primitives
1. Add `decision_status`, `decision_capture_stage` pgEnums; add `DECISION` to `epistemicTagEnum`.
2. Add `decisions` and `decision_capture_state` tables; add CHECK constraints.
3. Write `src/decisions/lifecycle.ts` with `transitionDecision()` + unit tests.
   - **Gate:** unit tests green; migrations run cleanly against Docker Postgres.

### Phase 2 — Capture Flow
4. Build `src/decisions/triggers.ts` (bilingual regex + meta-guards — copy refusal.ts structure).
5. Build `src/decisions/capture.ts` (5-question state machine, persists draft, commits to `decisions` + `pensieve_entries` on DONE).
6. Wire two new pre-processors into `engine.ts` (sub-flow check first, trigger detection second).
   - **Gate:** unit tests for trigger regex (including FP cases), integration test for full capture happy path.

### Phase 3 — Deadline Trigger & Proactive Integration
7. Build `src/proactive/triggers/decision-deadline.ts`.
8. Extend `TriggerResult.triggerType` union in `types.ts`.
9. Register new trigger in `sweep.ts` Phase 1 array; re-number priorities.
10. Ensure sweep writes `decision_capture_state` (stage=AWAITING_RESOLUTION) before sendMessage when this trigger wins.
    - **Gate:** synthetic-clock integration test — capture D with resolve_by, advance clock, run sweep, assert message sent + state row exists + status='due'.

### Phase 4 — Resolution + Post-mortem
11. Build `src/decisions/resolution.ts` (handleResolutionResponse + handlePostmortemResponse).
12. Pre-processor #0 already routes to these based on stage.
    - **Gate:** integration test — full lifecycle open→due→resolved→reviewed with two simulated Greg replies.

### Phase 5 — `/decisions` Command & Accuracy Stats
13. Build `src/decisions/accuracy.ts` (Haiku classification + row-cache).
14. Build `src/bot/handlers/decisions.ts` with sub-commands.
15. Register `bot.command('decisions', …)` in `bot.ts`.
    - **Gate:** command returns correct open list, correct recent-resolved, stats match fixture expectations over 30/90/365d windows.

### Phase 6 — Full Synthetic Fixture Test
16. End-to-end test with mock clock: capture → fast-forward 7 days → sweep fires → simulated user reply → post-mortem → `/decisions stats` returns accurate numbers. All in one suite, no calendar wait.

**Dependency enforcement:** You cannot implement capture (Phase 2) without lifecycle (Phase 1). You cannot implement deadline trigger (Phase 3) without capture producing rows. You cannot implement resolution (Phase 4) without deadline trigger producing `due` rows. You cannot compute stats (Phase 5) without resolved/reviewed rows. Each phase is independently testable.

---

## 6. Anti-Patterns to Avoid

### AP-1: Making decision capture a seventh mode
Adding `DECIDE` to `ChrisMode` forces Haiku mode detection to disambiguate trigger phrases from normal journaling. Cost on every message, classifier fragility, no benefit over deterministic regex — see D020 for the exact parallel reasoning on refusal.

### AP-2: Storing capture state in `conversations`
Turns an append-only transcript into an implicit state machine. Every new turn requires rescanning and re-parsing. Use a dedicated table.

### AP-3: Implicit state transitions
Spec forbids implicit transitions. Don't mutate `status` in ad-hoc DB UPDATEs scattered across the codebase. Single `transitionDecision()` chokepoint, validated transition map.

### AP-4: Separate cron for the forecast scheduler
Duplicates the mute/daily-cap/generation/send/state pipeline already built into `sweep.ts`. Fifth trigger is cheaper and inherits all existing discipline.

### AP-5: Running accuracy classification on every `/decisions stats` call
Over a 365-day window this is many Haiku calls. Classify once at resolution time, cache on the row, invalidate only if resolution text changes.

### AP-6: Forgetting the abort/escape phrase in sub-flows
A user mid-capture who changes their mind must be able to bail. Without an abort phrase the pre-processor will hijack every message until the flow completes. Reuse the refusal regex dictionary for abort phrases across EN/FR/RU.

---

## 7. Integration Points — Existing Contracts to Respect

| Contract | Why it matters for M007 |
|---|---|
| **Pre-processor short-circuit pattern** | Every pre-processor that handles the message must `saveMessage(USER)` + `saveMessage(ASSISTANT)` before returning, same as mute/refusal do. Skipping this drops messages from the conversation history that later hybrid retrieval depends on. |
| **Fire-and-forget never throws** | Writing decisions → pensieve_entries, writing capture state, transitioning lifecycle must not break the user-visible reply. Wrap in try/catch + logger.warn for non-critical side effects. The `transitionDecision` call at post-mortem completion IS critical — handle its errors and inform the user. |
| **Language threading** | Decision capture questions must be asked in Greg's detected language. Use `getLastUserLanguage(chatIdStr)` before emitting each question. |
| **Refusal interaction** | If Greg refuses the topic mid-capture ("I don't want to talk about this"), the abort path must fire, capture state must be cleared, AND the refusal topic must be added to `declinedTopics` via existing `addDeclinedTopic()`. |
| **Mute interaction** | Sweep already checks `isMuted()` first; decision-deadline trigger inherits this for free. No special handling needed. |
| **Daily cap interaction** | Daily cap applies to ALL proactive messages. A resolution prompt counts against the cap. Spec says "within 24 hours of resolve_by" which allows slippage — the cap does not need to be bypassed. |
| **Auto-migration on startup** | Drizzle migrations run on startup (D016). Writing them correctly is the only way the prod deploy sees the new tables. |

---

## Sources

- `/home/claude/chris/.planning/PROJECT.md` (verified HIGH)
- `/home/claude/chris/M007_Decision_Archive.md` (verified HIGH — spec source)
- `/home/claude/chris/src/chris/engine.ts` (verified HIGH — pre-processor patterns)
- `/home/claude/chris/src/proactive/sweep.ts` (verified HIGH — trigger orchestration)
- `/home/claude/chris/src/proactive/triggers/types.ts` + `commitment.ts` (verified HIGH — TriggerDetector contract)
- `/home/claude/chris/src/db/schema.ts` (verified HIGH — existing enum/table patterns)
- `/home/claude/chris/src/bot/bot.ts` + `handlers/sync.ts` (verified HIGH — command registration, sub-flow interception via `isAwaitingOAuthCode`)
- `/home/claude/chris/src/chris/refusal.ts` (verified HIGH — bilingual regex pattern with meta-reference guards, directly reusable shape)
- `/home/claude/chris/src/memory/conversation.ts` (verified HIGH — saveMessage contract)

---
*Architecture research for: M007 Decision Archive integration into existing Chris v2.1 architecture*
*Researched: 2026-04-15*
