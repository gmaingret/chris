# Phase 26: Daily Voice Note Ritual — Research

**Researched:** 2026-04-26
**Domain:** First M009 ritual — voice note prompt fire (21:00 Paris) + PP#5 ritual-response detector at engine position 0 + shuffled-bag prompt rotation + pre-fire suppression on heavy-deposit days + polite-decline `bot.on('message:voice')` handler.
**Confidence:** HIGH — every recommendation grounded in (a) Phase 25 Plan 25-01..03 shipped substrate (verified by direct file inspection of `src/rituals/{cadence,idempotency,scheduler,types}.ts`, `src/db/schema.ts`, `src/db/migrations/0006_rituals_wellbeing.sql`), (b) milestone research SUMMARY/PITFALLS/ARCHITECTURE already locked, or (c) existing M001–M008 code (engine PP-ordering, language tracker, dayBoundaryUtc helper).
**Mode:** `--auto` follow-up to `/gsd-discuss-phase --auto` (CONTEXT.md decisions D-26-01..09 are LOCKED).

---

## Summary

Phase 26 ships **4 plans, ~450 LoC + ~390 LoC test, zero new dependencies** on top of Phase 25 substrate. The non-negotiable rule is HARD CO-LOCATION #1 + #5: PP#5 ritual-response detector + voice note handler + mock-chain coverage update for the existing `engine.test.ts` family ALL land atomically in Plan 26-02. Splitting any of the three reproduces Pitfall 6 (Chris responds to ritual voice notes — kills the habit on day 1) or Pitfall 24 (mock-chain regression class from v2.0/v2.1 Phase 14).

**Primary recommendation:** Plan 26-02 is the highest-risk plan in the entire milestone. Land it second (after Plan 26-01's substrate) so the deposit-only contract is verifiable end-to-end before suppression (26-03) and voice-decline (26-04) layer on. Plans 26-03 and 26-04 are independent of each other and could ship in parallel after 26-02, though the simpler shipping order is sequential.

**Zero new dependencies:** `franc` already installed (`package.json` line confirms `"franc": "^6.2.0"`); Luxon, node-cron, Drizzle, Grammy, Anthropic SDK all at Phase 25 versions. No version bumps.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-26-01:** New migration `0007_daily_voice_note_seed.sql` with hand-authored hybrid SQL (Plan 25-01 D-25-01-A pattern); seed insert idempotent via `INSERT ... ON CONFLICT (name) DO NOTHING`; partial index `ritual_pending_responses_chat_id_active_idx ON ritual_pending_responses (chat_id, expires_at) WHERE consumed_at IS NULL`; `scripts/regen-snapshots.sh` extended to include 0007; `scripts/test.sh` adds psql line confirming seed row exists post-migration.

**D-26-02:** PP#5 ritual-response detector at the absolute top of `processMessage` body in `src/chris/engine.ts` (BEFORE PP#0 capture lookup at lines ~166-217). Query: `SELECT id, ritual_id, fired_at, expires_at FROM ritual_pending_responses WHERE chat_id = $1 AND consumed_at IS NULL AND expires_at > $2 ORDER BY fired_at DESC LIMIT 1`. On hit: write Pensieve entry with `RITUAL_RESPONSE` tag + `metadata.source_subtype = 'ritual_voice_note'`, atomically consume the pending row (`UPDATE ... SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`), insert `ritual_responses` row linking back, return empty string from `processMessage` (IN-02 silent-skip via existing `src/bot/bot.ts:54` guard). HARD CO-LOC #1 ENFORCED.

**D-26-03:** Add explicit `epistemicTag` parameter to `storePensieveEntry(content, source, metadata?, opts?: { epistemicTag?: ... })`. Backward-compat (existing 4 call sites omit `opts`). PP#5 passes `{ epistemicTag: 'RITUAL_RESPONSE' }`. Tagger auto-classifier (`src/pensieve/tagger.ts`) is NOT invoked on entries that already have an explicit tag. HARD CO-LOC #5 ENFORCED — engine.test.ts mock-chain update lands in same plan as PP#5 introduction.

**D-26-04:** **4 plans** for Phase 26:
- **Plan 26-01 (Substrate, ~120 LoC + ~80 LoC test):** Migration 0007 (seed + partial index) + drizzle meta-snapshot regen + `scripts/test.sh` extension + NEW `src/rituals/voice-note.ts` module with frozen PROMPTS array (6 strings, spec order) + PROMPT_SET_VERSION/RESPONSE_WINDOW_HOURS/RITUAL_SUPPRESS_DEPOSIT_THRESHOLD constants + pure shuffled-bag rotation primitive `chooseNextPromptIndex(currentBag): { index, newBag }` with property-test coverage. **No handler logic, no bot wiring, no engine edit.** Requirements: VOICE-02 (constants) + VOICE-03 (rotation primitive only).
- **Plan 26-02 (Voice handler + PP#5 + mock-chain — HARD CO-LOC #1 + #5, ~250 LoC + ~150 LoC test):** `fireVoiceNote(ritual, cfg)` handler + dispatch wiring in `src/rituals/scheduler.ts` (REPLACES Phase 25 throwing skeleton for `daily_voice_note` name) + `epistemicTag` parameter add to `storePensieveEntry` + PP#5 detector at top of `processMessage` + `recordRitualVoiceResponse` deposit helper + `findActivePendingResponse` query helper + mock-chain updates in 3 engine test files + new `src/chris/__tests__/engine-pp5.test.ts` real-DB integration test asserting cumulative `mockAnthropicCreate.not.toHaveBeenCalled()`. Requirements: VOICE-01, VOICE-02 (handler usage), VOICE-03 (handler usage), VOICE-06.
- **Plan 26-03 (Pre-fire suppression VOICE-04, ~80 LoC + ~80 LoC test):** `shouldSuppressVoiceNoteFire(now)` helper using `dayBoundaryUtc` from `src/episodic/sources.ts` to query `pensieve_entries WHERE source='telegram' AND created_at >= dayStart AND metadata->>'mode' = 'JOURNAL'` count ≥ 5 → skip fire, advance `next_run_at` to tomorrow via `computeNextRunAt(now, 'daily', config)`, emit `'system_suppressed'` outcome, no `skip_count` increment. Append `'system_suppressed'` literal to `RitualFireOutcome` union in `src/rituals/types.ts`. Real-DB integration test seeds 5 JOURNAL-mode Pensieve entries on same date and asserts suppression behavior. Requirements: VOICE-04.
- **Plan 26-04 (Polite-decline voice handler VOICE-05, ~50 LoC + ~80 LoC test):** Register `bot.on('message:voice', handleVoiceMessageDecline)` in `src/bot/bot.ts` + NEW `src/bot/handlers/voice-decline.ts` (~30 LoC) reading `getLastUserLanguage(chatId.toString())` from `src/chris/language.ts` and replying in EN/FR/RU with templated Android-STT-keyboard suggestion. No transcription, no Whisper, no `processMessage` call. Requirements: VOICE-05.

**D-26-05:** Pre-fire suppression query mechanism = `dayBoundaryUtc(now, config.proactiveTimezone, 'start')` + `db.select({ count: sql<number>\`COUNT(*)::int\` }).from(pensieveEntries).where(and(eq(source, 'telegram'), gte(createdAt, dayStart), sql\`metadata->>'mode' = 'JOURNAL'\`))`. Threshold = `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD = 5` per Pitfall 9.

**D-26-06:** Append `'system_suppressed'` literal to `RitualFireOutcome` union in Phase 26 (Plan 26-03). Phase 28 enriches with discriminator fields if needed. Phase 26 NEVER increments `skip_count` for `'system_suppressed'`, `'caught_up'`, or `'race_lost'`.

**D-26-07:** Mock-chain test family update scope = `engine.test.ts` + `engine-mute.test.ts` + `engine-refusal.test.ts` (verify `boundary-audit.test.ts` doesn't transitively import engine — if it does, add the mock too). New file `src/chris/__tests__/engine-pp5.test.ts` is the REAL-DB integration test (real Docker postgres on port 5434, mirrors Plan 25-02 idempotency.test.ts pattern).

**D-26-08:** `dispatchRitualHandler` in `src/rituals/scheduler.ts` keys on `ritual.name` (not `ritual.type`/cadence). Switch statement: `case 'daily_voice_note': return fireVoiceNote(ritual, parseRitualConfig(ritual.config));` — other names continue throwing until Phases 27/29.

**D-26-09:** Voice-decline handler reads language from `getLastUserLanguage(chatId.toString())` (existing M006 stickiness contract); if `null`, default to English. NO `franc` invocation on the empty-text voice message. Templated EN/FR/RU replies hardcoded in `src/bot/handlers/voice-decline.ts`.

### Claude's Discretion

- File names within `src/rituals/`: single `voice-note.ts` module (constants + handler + helpers + rotation primitive); planner verifies vs convention.
- Log-event names: planner picks per `rituals.fire.*` precedent — recommended `rituals.voice_note.fired`, `rituals.voice_note.suppressed`, `chris.engine.pp5.hit`, `chris.engine.pp5.miss`, `bot.voice.declined`.
- Test file locations: `src/chris/__tests__/engine-pp5.test.ts`, `src/rituals/__tests__/voice-note.test.ts` + `voice-note-suppression.test.ts` + `prompt-rotation-property.test.ts`, `src/bot/handlers/__tests__/voice-decline.test.ts`.
- Whether to ship `scripts/fire-ritual.ts` operator wrapper in Plan 26-02 (recommended: yes, ~30 LoC thin wrapper around `runRitualSweep` with name-filter) or defer.
- `recordRitualVoiceResponse` exact return type and error handling (recommended: returns `{ pensieveEntryId, consumedAt }`; throws `StorageError` on Pensieve write failure — engine PP#5 catches and falls through to normal pipeline; better to deposit-as-JOURNAL than to lose the message).

### Deferred Ideas (OUT OF SCOPE)

- Server-side Whisper transcription (OOS-3 PLAN.md anti-feature).
- `config.suppress_if_deposits_above` per-ritual override (Phase 28 adjustment dialogue territory).
- `RESPONSE_WINDOW_HOURS` retuning (revisit after 30 days of real use; OPEN-1 in research SUMMARY).
- Cleaned-projection `pensieve_entries.cleaned_for_quote_retrieval` for STT filler removal (Pitfall 8; future M010+ phase).
- Skip-tracking on missed voice notes (`fired_no_response` outcome) — Phase 28.
- AI follow-up after voice deposit (OOS-1; D026 forbids).
- Free-text custom prompts via Haiku (OOS-10).
- 14-day primed-fixture full-pipeline test (Phase 30 TEST-25).

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-01 | PP#5 ritual-response detector at position 0 of `processMessage` (BEFORE PP#0); state-table lookup; Pensieve write as `RITUAL_RESPONSE` with `source_subtype='ritual_voice_note'`; return empty string for IN-02 silent-skip | §1 (PP#5 placement + query SQL + atomic consume mechanism). Also §3 (mock-chain update scope per HARD CO-LOC #5). |
| VOICE-02 | 6 spec-order prompts in `src/rituals/voice-note.ts` with `PROMPT_SET_VERSION = 'v1'` constant | §2 (constants + frozen-array shape) |
| VOICE-03 | Shuffled-bag rotation via `rituals.config.prompt_bag: number[]`; property-test verifiable (600 fires = ~100 each, no consecutive dupes, max gap ≤ 11) | §2 (rotation primitive shape + property-test invariants) |
| VOICE-04 | 21:00 Europe/Paris default fire (configurable via `config.fire_at`); pre-fire suppression on ≥5 telegram JOURNAL entries today; advance `next_run_at` to tomorrow without incrementing `skip_count`; `'system_suppressed'` outcome | §4 (suppression query SQL + outcome literal append) |
| VOICE-05 | `bot.on('message:voice')` polite-decline ~10 LoC; EN/FR/RU per `franc` detection on user's last text message | §5 (handler shape + language source + templated replies) |
| VOICE-06 | STT filler tagging — `metadata.source_subtype = 'ritual_voice_note'` on every voice-note Pensieve entry | §1 (recordRitualVoiceResponse helper sets this in metadata) |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Migration 0007 SQL (seed + partial index) | Database / Storage | — | Schema lives in Postgres; idempotency guards inline (ON CONFLICT DO NOTHING / IF NOT EXISTS) |
| Drizzle meta-snapshot 0007 regen | Database / Storage | — | Lineage discipline (TECH-DEBT-19-01 escape hatch from v2.1 Phase 19 + Plan 25-01) |
| `src/rituals/voice-note.ts` constants + rotation primitive | API / Backend (pure functions) | — | No I/O; testable in microseconds via property test |
| `fireVoiceNote(ritual, cfg)` handler | API / Backend (Process / Cron) | Database (writes to `rituals.config`, `ritual_pending_responses`, Telegram side-effect) | Lives in `src/rituals/voice-note.ts`; called by `dispatchRitualHandler` from Plan 25-03's scheduler |
| PP#5 detector in `engine.ts:processMessage` | API / Backend (engine pre-processor) | Database (reads `ritual_pending_responses`, writes Pensieve + ritual_responses) | Cross-cuts engine + rituals; co-located with handler per HARD CO-LOC #1 |
| `recordRitualVoiceResponse(pendingRow, chatId, text)` deposit helper | API / Backend | Database (Pensieve write + atomic consume + ritual_responses insert) | Lives in `src/rituals/voice-note.ts`; pure-side-effect function (no return value beyond `{ pensieveEntryId, consumedAt }`) |
| `findActivePendingResponse(chatId, now)` query helper | API / Backend (read-only query) | Database | Single SELECT with partial-index hot path; called by PP#5 |
| `epistemicTag` parameter on `storePensieveEntry` | API / Backend | Database | Additive signature change; backward-compat |
| `shouldSuppressVoiceNoteFire(now)` suppression check | API / Backend (read-only query) | Database (counts pensieve_entries) | Pure function returning bool; mockable by injecting `dayBoundaryUtc` if needed |
| `'system_suppressed'` outcome literal | API / Backend (type) | — | Additive union extension in `src/rituals/types.ts` |
| `bot.on('message:voice', handleVoiceMessageDecline)` registration | API / Backend (HTTP / Bot router) | — | Lives in `src/bot/bot.ts` peer to existing `message:text` + `message:document` registrations |
| `handleVoiceMessageDecline` handler | API / Backend | — | Lives in `src/bot/handlers/voice-decline.ts`; reads `getLastUserLanguage`; templated EN/FR/RU reply |
| `scripts/fire-ritual.ts` operator wrapper (recommended) | CLI / Scripts | — | Optional thin wrapper around `runRitualSweep` filtered by name; matches `scripts/manual-sweep.ts` convention |

**Tier-correctness sanity check:** PP#5 cross-cuts engine (`src/chris/`) + rituals (`src/rituals/`) which is correct — the detector lives in the engine pre-processor chain because that's the only path Telegram messages flow through. The deposit helper lives in `src/rituals/` because it owns the Pensieve write semantics for ritual responses. The split honors the layer responsibility: engine = orchestration; rituals = ritual-domain semantics.

---

## Standard Stack

### Core (already installed — zero version bumps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | ^0.45.2 | Read `ritual_pending_responses` (PP#5), write Pensieve entries, atomic UPDATE for consume + insert ritual_responses, count pensieve_entries (suppression) | Already used across 21 existing tables; M009 substrate (Phase 25) added 6 ritual tables; no surface change |
| `drizzle-kit` | ^0.31.10 | Meta-snapshot 0007 regeneration via `scripts/regen-snapshots.sh` | TECH-DEBT-19-01 fix pattern; same as Plan 25-01 |
| `luxon` | ^3.7.2 | `dayBoundaryUtc` for suppression day-start computation; `computeNextRunAt` already shipped (Plan 25-02) | Existing M008 / Plan 25-02 pattern |
| `zod` | ^3.24.0 | `RitualConfig` already validated by Plan 25-02; Phase 26 just reads `config.prompt_bag` field | No schema changes — `prompt_bag` already declared in `RitualConfigSchema` |
| `franc` | ^6.2.0 | NOT directly invoked by Phase 26 — voice-decline reads `getLastUserLanguage` (which uses franc internally for incoming text messages) | Already installed; verified at `/home/claude/chris/package.json` |
| `node-cron` | ^4.2.1 | NOT touched in Phase 26 — Phase 25 already registered the 21:00 tick (RIT-11/12) | No surface change |
| `grammy` | ^1.31.0 | `bot.on('message:voice', ...)` registration — first use of `message:voice` filter in this codebase (existing surface uses `message:text` + `message:document`) | Same Grammy primitives; no version bump |

### Supporting (existing, used as-is)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | ^0.90.0 | NOT used in Phase 26 — voice note has no LLM call (deposit-only contract). Phase 29 uses for weekly review. | Not in Phase 26 scope |
| `pino` (logger) | (internal) | Structured logging via `src/utils/logger.ts` — every Phase 26 module: `logger.info({ pendingId, chatId }, 'chris.engine.pp5.hit')` | Every plan |
| `postgres` | ^3.4.5 | Low-level PG driver for raw SQL when needed (suppression count uses `sql\`metadata->>'mode' = 'JSON'\`` template) | Plan 26-03 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Append `'system_suppressed'` to existing union | Wait for Phase 28 to formalize discriminated union with metadata fields | VOICE-04 success criterion 3 demands the outcome string in Phase 26; waiting blocks the requirement |
| `getLastUserLanguage` for voice-decline | Run `franc` against the voice message itself | Voice messages have no text; franc would return null/garbage |
| Read `pensieve_entries` for suppression | Read `conversations.role='USER'` | Pensieve is authoritative (D035); conversations is transient |
| Single `voice-note.ts` module | Split into `prompt-rotation.ts` + `pp5-handler.ts` + `voice-note.ts` | Splitting adds boundary cost for ~300 LoC total; single module mirrors `src/episodic/consolidate.ts` shape |
| `INSERT ... ON CONFLICT (name) DO NOTHING` for seed | `INSERT ... ON CONFLICT DO UPDATE SET config = EXCLUDED.config` | UPDATE on conflict would clobber Greg's adjustments (e.g., `mute_until` set by Phase 28); DO NOTHING is the safe default |

**Installation:** None. Zero `package.json` diffs in Phase 26. [VERIFIED: package.json + Phase 25 LEARNINGS confirm `franc@6.2.0` already present + zero version-bump policy.]

---

## Architecture Patterns

### System Architecture Diagram

Phase 26 fire-side + response-side flow (focused on the new path; existing engine path unchanged on PP#5 miss):

```
                          ┌─────────────────────────────┐
                          │   21:00 Paris cron tick     │
                          │   (Phase 25 registerCrons)  │
                          └──────────────┬──────────────┘
                                         │ runSweep()
                                         ▼
                          ┌─────────────────────────────┐
                          │   src/proactive/sweep.ts    │
                          │   ACCOUNTABILITY → ESCAL    │
                          │   → RITUAL channel          │
                          │   → REFLECTIVE              │
                          └──────────────┬──────────────┘
                                         │ runRitualSweep()
                                         ▼
                          ┌─────────────────────────────────────────┐
                          │   src/rituals/scheduler.ts              │
                          │   1. hasReachedRitualDailyCap (3/day)   │
                          │   2. SELECT due rituals LIMIT 1         │
                          │   3. parseRitualConfig (RIT-07)         │
                          │   4. catch-up ceiling check             │
                          │   5. tryFireRitualAtomic (RIT-10)       │
                          │   6. dispatchRitualHandler(ritual)      │
                          │      switch (ritual.name) {             │
                          │        case 'daily_voice_note':         │
                          │          → fireVoiceNote   ◄──── Plan 26-02
                          │        ...                              │
                          │      }                                  │
                          └──────────────┬──────────────────────────┘
                                         │
                                         ▼
                          ┌─────────────────────────────────────────┐
                          │   src/rituals/voice-note.ts             │
                          │   fireVoiceNote(ritual, cfg):           │
                          │     1. shouldSuppressVoiceNoteFire?     │ ◄── Plan 26-03
                          │        if true: advance next_run_at,    │
                          │          emit 'system_suppressed', exit │
                          │     2. chooseNextPromptIndex(bag)       │ ◄── Plan 26-01
                          │     3. INSERT ritual_pending_responses  │
                          │        (chat_id, fired_at, expires_at)  │
                          │     4. UPDATE rituals.config.prompt_bag │
                          │     5. bot.api.sendMessage(prompt)      │
                          └─────────────────────────────────────────┘

                                  ┌─── Greg replies via STT ───┐
                                  │                            │
                                  ▼                            │
   ┌──────────────────────────────────────────────────────────┐│
   │  Telegram → Grammy router → bot.on('message:text')        ││
   │  → handleTextMessage (src/bot/bot.ts:34)                  ││
   │  → processMessage(chatId, userId, text)                   ││
   └──────────────┬────────────────────────────────────────────┘│
                  │                                              │
                  ▼                                              │
   ┌──────────────────────────────────────────────────────────┐ │
   │  src/chris/engine.ts processMessage:                      │ │
   │  ┌──── PP#5 ritual-response detector (Plan 26-02) ────┐  │ │
   │  │  pending = findActivePendingResponse(chatId, now)  │  │ │
   │  │  if (pending) {                                    │  │ │
   │  │    await recordRitualVoiceResponse(pending, ...)   │  │ │
   │  │    return '';  ← IN-02 silent-skip                 │  │ │
   │  │  }                                                  │  │ │
   │  └─────────────────────────────────────────────────────┘  │ │
   │  PP#0 active capture (existing) — unchanged on miss       │ │
   │  PP#1 trigger (existing) — unchanged on miss              │ │
   │  ...                                                      │ │
   └───────────────────────────────────────────────────────────┘ │
                                                                  │
   ┌──────────────────────────────────────────────────────────┐  │
   │  recordRitualVoiceResponse (src/rituals/voice-note.ts):   │  │
   │  1. storePensieveEntry(text, 'telegram',                  │◄─┘
   │       { source_subtype: 'ritual_voice_note',              │
   │         ritual_id, ritual_pending_response_id },          │
   │       { epistemicTag: 'RITUAL_RESPONSE' })  ◄── D-26-03  │
   │  2. INSERT ritual_responses (ritual_id, fired_at,          │
   │       responded_at, prompt_text, pensieve_entry_id)        │
   │  3. UPDATE ritual_pending_responses                        │
   │       SET consumed_at = now()                              │
   │       WHERE id = $1 AND consumed_at IS NULL                │
   │       RETURNING id  ◄── atomic mutual exclusion            │
   └───────────────────────────────────────────────────────────┘

                                  ┌── Greg sends voice msg ───┐
                                  │                           │
                                  ▼                           │
   ┌─────────────────────────────────────────────────────────┐│
   │  Telegram → Grammy router →                              ││
   │  bot.on('message:voice', handleVoiceMessageDecline)      ││ ◄── Plan 26-04
   │  → reads getLastUserLanguage(chatId)                     ││
   │  → ctx.reply(EN/FR/RU "use STT keyboard mic")            ││
   │  → no Pensieve write, no processMessage call             ││
   └──────────────────────────────────────────────────────────┘│
```

---

## Section 1 — PP#5 ritual-response detector: placement, query, atomic consume

### Placement (re-confirms D-26-02)

**Insert at the absolute top of `processMessage` body**, immediately after the input-validation block (`src/chris/engine.ts:155-161`) and BEFORE the existing `try { ... }` block opening at line 165 — OR inside the try block at the very top, BEFORE the PP#0 `getActiveDecisionCapture` lookup at line 168. Recommendation: **inside the try block** so PP#5 errors are caught by the existing `LLMError` wrapper (line 418), preserving uniform error semantics. Concrete shape:

```typescript
// In src/chris/engine.ts processMessage, immediately inside try { ... } at line ~165:

// ── PP#5: Ritual-response detection (M009 Phase 26) ────────────────
// Runs FIRST. If a ritual-response window is open for this chat, the
// message IS the response. Writes to Pensieve as RITUAL_RESPONSE,
// atomically consumes the pending row, returns empty string to
// suppress reply (deposit-only — Pitfall 6 mitigation).
const chatIdStr = chatId.toString();
const pending = await findActivePendingResponse(chatIdStr, new Date());
if (pending) {
  try {
    const result = await recordRitualVoiceResponse(pending, chatId, text);
    logger.info(
      { pendingId: pending.id, ritualId: pending.ritualId,
        pensieveEntryId: result.pensieveEntryId },
      'chris.engine.pp5.hit',
    );
    return ''; // IN-02 silent-skip via src/bot/bot.ts:54 guard
  } catch (depositErr) {
    // Fall-through: better to deposit-as-JOURNAL than to lose the message.
    logger.warn(
      { err: depositErr, pendingId: pending.id },
      'chris.engine.pp5.deposit_error',
    );
    // Continue to PP#0 / mode detection / normal pipeline.
  }
}
```

### Query SQL (PP#5 hot path)

```typescript
// In src/rituals/voice-note.ts:

export async function findActivePendingResponse(
  chatIdStr: string,
  now: Date,
): Promise<typeof ritualPendingResponses.$inferSelect | null> {
  const chatId = BigInt(chatIdStr);
  const [row] = await db
    .select()
    .from(ritualPendingResponses)
    .where(and(
      eq(ritualPendingResponses.chatId, chatId),
      isNull(ritualPendingResponses.consumedAt),
      gt(ritualPendingResponses.expiresAt, now),
    ))
    .orderBy(desc(ritualPendingResponses.firedAt))
    .limit(1);
  return row ?? null;
}
```

Backed by the **partial index** added in migration 0007:
```sql
CREATE INDEX IF NOT EXISTS ritual_pending_responses_chat_id_active_idx
  ON ritual_pending_responses (chat_id, expires_at)
  WHERE consumed_at IS NULL;
```

This makes the lookup an index-only scan — even after years of accumulated rows, query latency stays <1ms.

### Atomic consume + deposit

```typescript
export async function recordRitualVoiceResponse(
  pending: typeof ritualPendingResponses.$inferSelect,
  chatId: bigint,
  text: string,
): Promise<{ pensieveEntryId: string; consumedAt: Date }> {
  // 1. Atomic consume — mutual exclusion against concurrent PP#5 invocations.
  //    A second message arriving in the same tick (rare but possible) would
  //    find the same pending row but UPDATE...RETURNING would yield no rows
  //    on the loser, and the loser falls through to normal pipeline.
  const [consumed] = await db
    .update(ritualPendingResponses)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(ritualPendingResponses.id, pending.id),
      isNull(ritualPendingResponses.consumedAt),
    ))
    .returning({ id: ritualPendingResponses.id, consumedAt: ritualPendingResponses.consumedAt });

  if (!consumed) {
    // Race lost — another PP#5 already consumed this pending row.
    throw new StorageError('ritual.pp5.race_lost');
  }

  // 2. Pensieve write with explicit RITUAL_RESPONSE tag (D-26-03).
  const entry = await storePensieveEntry(
    text,
    'telegram',
    {
      telegramChatId: Number(chatId),
      source_subtype: 'ritual_voice_note',  // VOICE-06
      ritual_id: pending.ritualId,
      ritual_pending_response_id: pending.id,
    },
    { epistemicTag: 'RITUAL_RESPONSE' },
  );

  // 3. Insert ritual_responses row linking back (longitudinal trail).
  await db.insert(ritualResponses).values({
    ritualId: pending.ritualId,
    firedAt: pending.firedAt,
    respondedAt: consumed.consumedAt,
    promptText: '',  // prompt text is on the fire-side ritual_pending_responses metadata; future Plan can backfill
    pensieveEntryId: entry.id,
  });

  return { pensieveEntryId: entry.id, consumedAt: consumed.consumedAt };
}
```

**Why no transaction wrapping:** The consume + Pensieve write + ritual_responses insert do not need to be transactionally atomic — if Pensieve write fails after consume succeeds, the pending row is just orphaned (consumed but no entry); the engine error path falls through to normal pipeline AND Greg's message is preserved by the fall-through JOURNAL deposit. If ritual_responses insert fails, it's a fire-and-forget audit trail; the Pensieve entry has the source_subtype tag for retrieval. The simplicity outweighs transactional purity here.

### `epistemicTag` parameter add to `storePensieveEntry` (D-26-03)

```typescript
// src/pensieve/store.ts (additive parameter):
export async function storePensieveEntry(
  content: string,
  source: string = 'telegram',
  metadata?: PensieveEntryMetadata,
  opts?: { epistemicTag?: typeof epistemicTagEnum.enumValues[number] },
): Promise<typeof pensieveEntries.$inferSelect> {
  // ... existing validation
  const [entry] = await db
    .insert(pensieveEntries)
    .values({
      content,
      source,
      metadata: metadata ?? null,
      epistemicTag: opts?.epistemicTag ?? null,  // ◄── new
    })
    .returning();
  // ... existing logger + return
}
```

**Existing 4 call sites** (verified via grep `storePensieveEntry(` in `src/`): all currently omit the 4th parameter and continue to work without modification. The Haiku auto-tagger (`src/pensieve/tagger.ts`) only updates entries with `epistemic_tag IS NULL`, so PP#5's pre-tagged entries are skipped by future tagger invocations.

### Mock-chain coverage update (HARD CO-LOC #5)

Per Phase 14 (v2.1) regression class — when adding a new call site to `engine.ts`, every existing engine test file must update its mock chain. Plan 26-02 updates:

- `src/chris/__tests__/engine.test.ts` — add `vi.mock('../../rituals/voice-note.js', ...)` chain stub returning `null` from `findActivePendingResponse`.
- `src/chris/__tests__/engine-mute.test.ts` — same mock; mute tests run after PP#5 falls through.
- `src/chris/__tests__/engine-refusal.test.ts` — same mock; refusal tests run after PP#5 falls through.
- `src/chris/__tests__/boundary-audit.test.ts` — verify it doesn't import engine; if it does, add the mock too.
- NEW `src/chris/__tests__/engine-pp5.test.ts` — REAL-DB integration test (mirrors Plan 25-02 idempotency.test.ts pattern):
  - Connect to Docker postgres on port 5434
  - Seed `rituals` row + `ritual_pending_responses` row directly via Drizzle
  - Spy on `mockAnthropicCreate` (Anthropic client mock at module top)
  - Call `processMessage(chatId, userId, "today was about the team meeting")`
  - Assert returned string === ''
  - Assert `expect(mockAnthropicCreate).not.toHaveBeenCalled()` (cumulative, afterAll-style)
  - Assert exactly 1 row in `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` AND `metadata->>'source_subtype' = 'ritual_voice_note'`
  - Assert `ritual_pending_responses.consumed_at IS NOT NULL` post-call
  - Assert exactly 1 row in `ritual_responses` linking back

---

## Section 2 — Voice-note constants + shuffled-bag rotation primitive

### Constants module (Plan 26-01)

```typescript
// src/rituals/voice-note.ts (top of file):

/** PROMPT-SET v1 — exactly 6 prompts, spec order, frozen. */
export const PROMPTS = [
  'What mattered today?',
  "What's still on your mind?",
  'What did today change?',
  'What surprised you today?',
  'What did you decide today, even if it was small?',
  'What did you avoid today?',
] as const;

/** Bumping to 'v2' invalidates all stored prompt_bag indices. */
export const PROMPT_SET_VERSION = 'v1' as const;

/** Window after fire during which a free-text message is interpreted as a
 *  ritual response (PP#5). Tunable per OPEN-1 (research SUMMARY). */
export const RESPONSE_WINDOW_HOURS = 18;

/** Pre-fire suppression threshold (Pitfall 9). If today already has ≥N
 *  telegram JOURNAL entries, skip the fire and advance to tomorrow. */
export const RITUAL_SUPPRESS_DEPOSIT_THRESHOLD = 5;
```

### Shuffled-bag rotation (Plan 26-01 — pure function)

```typescript
/**
 * chooseNextPromptIndex — shuffled-bag rotation primitive.
 *
 * State stored in `rituals.config.prompt_bag: number[]` — an array of indices
 * not yet used in the current cycle. Each fire pops the first element; when
 * the bag empties, refill via Fisher-Yates shuffle of [0..PROMPTS.length-1].
 * To enforce "no consecutive duplicates" across cycle boundaries, the just-
 * used index is removed from the head of the new bag (placed at the back
 * with a swap, so distribution stays uniform).
 */
export function chooseNextPromptIndex(
  currentBag: number[],
  rng: () => number = Math.random,
): { index: number; newBag: number[] } {
  if (currentBag.length === 0) {
    // Refill: shuffle [0..5] via Fisher-Yates with injected RNG (testable).
    const fresh = [0, 1, 2, 3, 4, 5];
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j]!, fresh[i]!];
    }
    const idx = fresh.shift()!;
    return { index: idx, newBag: fresh };
  }
  const idx = currentBag[0]!;
  return { index: idx, newBag: currentBag.slice(1) };
}
```

**Edge case handled:** First fire (empty bag) refills + pops. Second fire (5-element bag from refill) just pops. After 6 fires, bag is empty and the next fire refills. The "no consecutive duplicates" invariant from spec floor is satisfied because (a) within a cycle, indices are unique, and (b) at cycle-boundary the just-used index is removed from the new bag's head — but for simplicity in v1, we omit the head-removal optimization since the property test catches consecutive duplicates and a 1-in-6 chance at cycle boundary is acceptable per Pitfall 7's "no-repeat-in-last-6 strong invariant" being ≤11 max gap.

**Property test (Plan 26-01) — `prompt-rotation-property.test.ts`:**
```typescript
import { describe, it, expect } from 'vitest';
import { chooseNextPromptIndex, PROMPTS } from '../voice-note.js';

describe('chooseNextPromptIndex shuffled-bag invariants (VOICE-03)', () => {
  it('600 fires produce uniform distribution + no consecutive dupes + max-gap ≤ 11', () => {
    let bag: number[] = [];
    const fires: number[] = [];
    // Use Math.random for ergonomic test; alternative: seeded RNG for full determinism.
    for (let i = 0; i < 600; i++) {
      const r = chooseNextPromptIndex(bag);
      fires.push(r.index);
      bag = r.newBag;
    }
    // (a) distribution within ±10% of expected 100/prompt
    const counts = [0, 0, 0, 0, 0, 0];
    for (const i of fires) counts[i]!++;
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(80);
      expect(c).toBeLessThanOrEqual(120);
    }
    // (b) no consecutive duplicates (spec floor)
    for (let i = 1; i < fires.length; i++) {
      expect(fires[i]).not.toEqual(fires[i - 1]);
    }
    // (c) max-gap between any same-index fires ≤ 11
    const lastSeen: Record<number, number> = {};
    let maxGap = 0;
    for (let i = 0; i < fires.length; i++) {
      const idx = fires[i]!;
      if (lastSeen[idx] !== undefined) {
        maxGap = Math.max(maxGap, i - lastSeen[idx]!);
      }
      lastSeen[idx] = i;
    }
    expect(maxGap).toBeLessThanOrEqual(11);
  });
});
```

**Edge-case caveat for the (b) consecutive-dupes invariant:** without head-removal at cycle boundary, a worst-case shuffle CAN produce consecutive dupes (cycle ends with index X, new cycle's shuffle puts X at head). Mitigation options for Plan 26-01 to choose:
- (i) Add head-removal: when bag empties, after refill+shuffle, if `fresh[0] === lastUsedIndex`, swap with `fresh[1]`. Test deterministically passes (b).
- (ii) Track `lastIndex` on the bag refill via a 2nd argument; same effect.
- (iii) Accept rare consecutive dupes; loosen test to "no more than 1 consecutive duplicate per 100 fires".

**Recommendation: option (i)** — `lastIndex` parameter to `chooseNextPromptIndex(bag, rng, lastIndex?)` lets the caller pass the prior fire's index. Caller is `fireVoiceNote` which has access to the prior bag state. Adds 3 LoC for full invariant satisfaction.

---

## Section 3 — Voice note handler + dispatch wiring

### `fireVoiceNote(ritual, cfg)` shape (Plan 26-02)

```typescript
// src/rituals/voice-note.ts:

export async function fireVoiceNote(
  ritual: typeof rituals.$inferSelect,
  cfg: RitualConfig,
): Promise<void> {
  // 0. Pre-fire suppression check (VOICE-04, Plan 26-03 wires this in).
  //    Plan 26-02 includes the call site as a no-op stub; Plan 26-03 fills.
  if (await shouldSuppressVoiceNoteFire(new Date())) {
    // Advance next_run_at to tomorrow's fire_at
    const tomorrow = computeNextRunAt(new Date(), 'daily', cfg);
    await db.update(rituals)
      .set({ nextRunAt: tomorrow })
      .where(eq(rituals.id, ritual.id));
    logger.info(
      { ritualId: ritual.id, nextRunAt: tomorrow.toISOString() },
      'rituals.voice_note.suppressed',
    );
    // No throw — but the scheduler interprets "no Telegram side-effect" as the
    // 'system_suppressed' outcome via a return value. Plan 26-03 details the
    // signature change to `Promise<{ outcome: 'fired' | 'system_suppressed' }>`.
    return;  // Plan 26-03 will refactor to return outcome
  }

  // 1. Pop next prompt from bag.
  const lastIdx = cfg.prompt_bag && cfg.prompt_bag.length > 0
    ? cfg.prompt_bag[cfg.prompt_bag.length - 1]
    : undefined;  // first fire — no last index
  const { index: promptIdx, newBag } = chooseNextPromptIndex(
    cfg.prompt_bag ?? [],
    Math.random,
    lastIdx,
  );
  const prompt = PROMPTS[promptIdx]!;

  // 2. Send Telegram message FIRST (per spec — fire-and-forget). Failure here
  //    means we don't insert the pending row, so PP#5 won't have a stale
  //    binding (we'd rather no fire than a fire with no record).
  const chatId = BigInt(config.telegramAuthorizedUserId);
  await bot.api.sendMessage(Number(chatId), prompt);

  // 3. Insert ritual_pending_responses row binding the fire to a chat.
  const firedAt = new Date();
  const expiresAt = new Date(firedAt.getTime() + RESPONSE_WINDOW_HOURS * 3600 * 1000);
  await db.insert(ritualPendingResponses).values({
    ritualId: ritual.id,
    chatId,
    firedAt,
    expiresAt,
  });

  // 4. Update rituals.config.prompt_bag with the new bag.
  const updatedCfg: RitualConfig = { ...cfg, prompt_bag: newBag };
  await db.update(rituals)
    .set({ config: updatedCfg })
    .where(eq(rituals.id, ritual.id));

  logger.info(
    { ritualId: ritual.id, promptIdx, prompt },
    'rituals.voice_note.fired',
  );
}
```

### Dispatch wiring (Plan 26-02 edit to `src/rituals/scheduler.ts`)

Replace the Phase 25 skeleton's throw at lines 260-266:

```typescript
// src/rituals/scheduler.ts — REPLACE the existing throwing skeleton:

import { fireVoiceNote } from './voice-note.js';

async function dispatchRitualHandler(
  ritual: typeof rituals.$inferSelect,
): Promise<void> {
  const cfg = parseRitualConfig(ritual.config);
  switch (ritual.name) {
    case 'daily_voice_note':
      return fireVoiceNote(ritual, cfg);
    // future Phases 27, 29:
    // case 'daily_wellbeing': return fireWellbeing(ritual, cfg);
    // case 'weekly_review':   return fireWeeklyReview(ritual, cfg);
    default:
      throw new Error(
        `rituals.dispatch: handler not implemented for ${ritual.name}`,
      );
  }
}
```

Note: the `parseRitualConfig` call moves from `runRitualSweep` to `dispatchRitualHandler` since the handler needs the parsed config — small refactor — OR keep the parse in `runRitualSweep` and pass `cfg` as a 2nd arg to `dispatchRitualHandler(ritual, cfg)`. **Recommendation: pass cfg** to avoid double-parse and to keep the scheduler's existing `'config_invalid'` outcome routing intact (the parse already happens at line 108 of scheduler.ts; the handler just consumes).

---

## Section 4 — Pre-fire suppression (VOICE-04)

### Day-start computation (Plan 26-03)

```typescript
// src/rituals/voice-note.ts (Plan 26-03 adds this):

import { dayBoundaryUtc } from '../episodic/sources.js';
import { config } from '../config.js';

export async function shouldSuppressVoiceNoteFire(now: Date): Promise<boolean> {
  const dayStart = dayBoundaryUtc(now, config.proactiveTimezone, 'start');
  const [{ count }] = await db.select({
    count: sql<number>`COUNT(*)::int`,
  })
    .from(pensieveEntries)
    .where(and(
      eq(pensieveEntries.source, 'telegram'),
      gte(pensieveEntries.createdAt, dayStart),
      sql`${pensieveEntries.metadata}->>'mode' = 'JOURNAL'`,
    ));
  return (count ?? 0) >= RITUAL_SUPPRESS_DEPOSIT_THRESHOLD;
}
```

### Outcome wiring (Plan 26-03)

`fireVoiceNote` signature changes to return `Promise<RitualFireOutcome>` so the scheduler can capture suppression as the right outcome literal. This requires a small refactor to `dispatchRitualHandler` to forward the return value, AND to `runRitualSweep` STEP 6 to consult the handler's return rather than always emitting `'fired'`. Concrete shape:

```typescript
// src/rituals/voice-note.ts:
export async function fireVoiceNote(...): Promise<RitualFireOutcome> {
  if (await shouldSuppressVoiceNoteFire(new Date())) {
    // ... advance next_run_at to tomorrow ...
    return 'system_suppressed';
  }
  // ... fire path ...
  return 'fired';
}

// src/rituals/scheduler.ts dispatchRitualHandler:
async function dispatchRitualHandler(ritual, cfg): Promise<RitualFireOutcome> {
  switch (ritual.name) {
    case 'daily_voice_note': return fireVoiceNote(ritual, cfg);
    default: throw new Error(...);
  }
}

// runRitualSweep STEP 6 consumes the outcome:
const outcome = await dispatchRitualHandler(ritual, ritualConfig);
results.push({
  ritualId: ritual.id,
  type: ritual.type,
  fired: outcome === 'fired',
  outcome,
});
```

**`'system_suppressed'` does NOT increment skip_count** — Phase 28 will formalize this via the `ritual_fire_events` table; Phase 26 just guarantees the literal is emitted and `runRitualSweep` doesn't write to `rituals.skip_count` directly (Phase 25 doesn't either; Phase 28 is the only writer).

### Real-DB integration test (Plan 26-03 — `voice-note-suppression.test.ts`)

```typescript
// Real Docker postgres pattern (mirrors Plan 25-02 idempotency.test.ts):
describe('voice note pre-fire suppression (VOICE-04)', () => {
  it('skips fire when ≥5 JOURNAL entries today', async () => {
    // 1. Seed 5 telegram JOURNAL Pensieve entries with created_at = today
    for (let i = 0; i < 5; i++) {
      await db.insert(pensieveEntries).values({
        content: `journal entry ${i}`,
        source: 'telegram',
        metadata: { mode: 'JOURNAL' },
        createdAt: new Date(),
      });
    }
    // 2. Seed daily_voice_note ritual row with next_run_at = now
    await db.insert(rituals).values({
      name: 'daily_voice_note',
      type: 'daily',
      nextRunAt: new Date(),
      config: { fire_at: '21:00', prompt_bag: [], skip_threshold: 3,
                mute_until: null, time_zone: 'Europe/Paris',
                prompt_set_version: 'v1', schema_version: 1 },
    });
    // 3. Spy on bot.api.sendMessage
    const sendSpy = vi.spyOn(bot.api, 'sendMessage').mockResolvedValue({ } as any);
    // 4. Run sweep
    const results = await runRitualSweep();
    // 5. Assert outcome
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('system_suppressed');
    expect(results[0]!.fired).toBe(false);
    // 6. Assert no Telegram send
    expect(sendSpy).not.toHaveBeenCalled();
    // 7. Assert no ritual_pending_responses inserted
    const pending = await db.select().from(ritualPendingResponses);
    expect(pending).toHaveLength(0);
    // 8. Assert next_run_at advanced to tomorrow's 21:00 Paris
    const [updatedRitual] = await db.select().from(rituals)
      .where(eq(rituals.name, 'daily_voice_note'));
    expect(updatedRitual!.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 12 * 3600 * 1000);
  });

  it('fires normally when <5 JOURNAL entries today', async () => {
    // ... seed 4 entries, assert fire happens
  });
});
```

---

## Section 5 — Polite-decline voice handler (VOICE-05)

### Handler shape (Plan 26-04)

```typescript
// src/bot/handlers/voice-decline.ts (NEW, ~30 LoC):
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';

const DECLINE_MESSAGES = {
  en: "I can only read text messages — try the microphone icon on your Android keyboard to dictate.",
  fr: "Je ne lis que les messages texte — essaie l'icône micro de ton clavier Android pour dicter.",
  ru: "Я понимаю только текстовые сообщения — попробуй значок микрофона на клавиатуре Android для диктовки.",
} as const;

const LANG_TO_KEY: Record<string, keyof typeof DECLINE_MESSAGES> = {
  English: 'en',
  French: 'fr',
  Russian: 'ru',
};

export async function handleVoiceMessageDecline(ctx: {
  chat: { id: number };
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  const chatIdStr = String(ctx.chat.id);
  const lastLang = getLastUserLanguage(chatIdStr);
  const langKey = (lastLang && LANG_TO_KEY[lastLang]) ?? 'en';
  await ctx.reply(DECLINE_MESSAGES[langKey]);
  logger.info({ chatId: chatIdStr, langKey }, 'bot.voice.declined');
}
```

### Bot wiring (Plan 26-04 edit to `src/bot/bot.ts`)

```typescript
// src/bot/bot.ts — append after the existing message:text registration:
import { handleVoiceMessageDecline } from './handlers/voice-decline.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('message:voice', handleVoiceMessageDecline as any);
```

The cast `as any` follows existing precedent (line 75: `bot.on('message:text', handleTextMessage as any);`).

### Handler test (Plan 26-04 — `voice-decline.test.ts`)

Pure unit test (no DB, no LLM); mocks `getLastUserLanguage` + `ctx.reply`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLastLang = vi.fn();
vi.mock('../../../chris/language.js', () => ({ getLastUserLanguage: mockGetLastLang }));
vi.mock('../../../utils/logger.js', () => ({ logger: { info: vi.fn() } }));

import { handleVoiceMessageDecline } from '../voice-decline.js';

describe('handleVoiceMessageDecline (VOICE-05)', () => {
  beforeEach(() => mockGetLastLang.mockReset());

  it('replies in English when last language is English', async () => {
    mockGetLastLang.mockReturnValue('English');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('text messages'));
  });

  it('replies in French when last language is French', async () => {
    mockGetLastLang.mockReturnValue('French');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('messages texte'));
  });

  it('replies in Russian when last language is Russian', async () => {
    mockGetLastLang.mockReturnValue('Russian');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('текстовые'));
  });

  it('defaults to English when no prior language', async () => {
    mockGetLastLang.mockReturnValue(null);
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123 }, reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('text messages'));
  });

  it('does NOT call processMessage / Pensieve write', async () => {
    // Coverage check: the handler imports nothing from src/chris/engine.ts
    // or src/pensieve/store.ts (verifiable at module-graph level).
    // This test just asserts the handler's surface is small.
    mockGetLastLang.mockReturnValue('English');
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleVoiceMessageDecline({ chat: { id: 123 }, reply });
    // Only side effect is reply — verified by reply being the only mock invoked.
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
```

---

## Section 6 — Migration 0007 SQL specifics

### File shape (Plan 26-01)

```sql
-- src/db/migrations/0007_daily_voice_note_seed.sql
--
-- Phase 26 (M009 v2.4) — Daily voice note ritual seed + PP#5 hot-path partial
-- index. Hand-authored per CONTEXT.md D-26-01 (Plan 25-01 D-25-01-A pattern).
-- ON CONFLICT DO NOTHING + IF NOT EXISTS guards make this idempotent under
-- the raw-psql apply path in scripts/test.sh and operator re-runs.
--
-- The seed insert's next_run_at uses a SQL-computed "tomorrow at 21:00 Paris"
-- value; the first cron tick will recompute via computeNextRunAt regardless,
-- so this is just a non-zero placeholder ensuring next_run_at is non-null
-- (NOT NULL constraint per RIT-01).

INSERT INTO "rituals" ("name", "type", "next_run_at", "enabled", "config")
VALUES (
  'daily_voice_note',
  'daily',
  ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris')
    + interval '1 day'
    + interval '21 hours') AT TIME ZONE 'Europe/Paris'),
  true,
  '{
    "fire_at": "21:00",
    "prompt_bag": [],
    "skip_threshold": 3,
    "mute_until": null,
    "time_zone": "Europe/Paris",
    "prompt_set_version": "v1",
    "schema_version": 1
  }'::jsonb
)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ritual_pending_responses_chat_id_active_idx"
  ON "ritual_pending_responses" USING btree ("chat_id", "expires_at")
  WHERE "consumed_at" IS NULL;
```

### `scripts/test.sh` extension (Plan 26-01)

After Plan 25-01's `6|1|3` substrate gate (lines confirming 6 tables + 1 enum value + 3 indexes), append a seed-row gate:

```bash
# Phase 26 (M009): voice note seed insert + PP#5 partial index
SEED_CHECK=$(docker compose -f docker-compose.local.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT name FROM rituals WHERE name = 'daily_voice_note' LIMIT 1;")

if [[ "$SEED_CHECK" != "daily_voice_note" ]]; then
  echo "FAIL: voice note seed row missing after migration 0007"
  exit 1
fi

# PP#5 hot-path partial index check
INDEX_CHECK=$(docker compose -f docker-compose.local.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT indexname FROM pg_indexes
   WHERE indexname = 'ritual_pending_responses_chat_id_active_idx';")

if [[ "$INDEX_CHECK" != "ritual_pending_responses_chat_id_active_idx" ]]; then
  echo "FAIL: PP#5 partial index missing after migration 0007"
  exit 1
fi

echo "PASS: Phase 26 migration 0007 substrate verified (seed + index)"
```

### `scripts/regen-snapshots.sh` extension (Plan 26-01)

Mirror Plan 25-01's hardcoded loop extension. The script's iterative replay loop must include 0007 in the migration list. The `meta/0007_snapshot.json` produced by `drizzle-kit introspect` will reflect the new partial index (the seed insert is a row-level change, not schema; drizzle-kit doesn't track seed inserts).

---

## Sources

### Primary (HIGH confidence — direct file inspection)
- `/home/claude/chris/.planning/research/SUMMARY.md` — TS-1..TS-3c voice note features; HARD CO-LOC #1 + #5; Disagreement #5 (shuffled-bag) + #8 (voice handling).
- `/home/claude/chris/.planning/research/PITFALLS.md` — Pitfall 6 lines 133-169 (PP#5 deposit-only; the load-bearing mitigation), Pitfall 7 lines 172-194 (shuffled-bag rotation), Pitfall 8 lines 197-218 (STT filler tagging — VOICE-06 source), Pitfall 9 lines 221-238 (pre-fire suppression — VOICE-04 source), Pitfall 24 lines 606-628 (mock-chain coverage — HARD CO-LOC #5 source).
- `/home/claude/chris/.planning/research/ARCHITECTURE.md` — §3 Daily voice note handler & PP#-1 problem (research uses "PP#-1" naming; CONTEXT/spec use "PP#5" — same concept, position 0).
- `/home/claude/chris/.planning/ROADMAP.md` — Phase 26 detail; 4 success criteria (line 46-50).
- `/home/claude/chris/.planning/REQUIREMENTS.md` — VOICE-01..06 verbatim (lines 38-43); traceability table (lines 156-161).
- `/home/claude/chris/.planning/STATE.md` — Spec interpretations #4 (voice handling polite-decline, no Whisper) + #5 (shuffled-bag rotation).
- `/home/claude/chris/.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` D-04 (3/day channel ceiling), D-08 (regen-snapshots.sh extension), D-09 (3-arg `computeNextRunAt`).
- `/home/claude/chris/.planning/phases/25-ritual-scheduling-foundation-process-gate/25-LEARNINGS.md` — Hybrid hand-SQL pattern, real-postgres concurrency tests, ESM entry-point guard, scope-reduction failure mode.
- `/home/claude/chris/src/chris/engine.ts` — full file (PP#5 insertion point identified at lines ~165-217).
- `/home/claude/chris/src/rituals/scheduler.ts` — `dispatchRitualHandler` skeleton at lines 260-266 (Plan 26-02 replaces).
- `/home/claude/chris/src/rituals/types.ts` — `RitualConfigSchema` at lines 42-55 (`prompt_bag` already declared at line 48; no schema change needed); `RitualFireOutcome` union at lines 84-90 (Plan 26-03 appends `'system_suppressed'`).
- `/home/claude/chris/src/rituals/cadence.ts` — `computeNextRunAt(now, cadence, config)` 3-arg signature confirmed (D-09 from Plan 25-02).
- `/home/claude/chris/src/db/schema.ts` — `ritualPendingResponses` table at lines 485-493 (already exists; Phase 26 adds partial index in migration 0007); `epistemicTagEnum` includes `'RITUAL_RESPONSE'` at line 38 (already extended by Plan 25-01).
- `/home/claude/chris/src/db/migrations/0006_rituals_wellbeing.sql` — full file (template for hand-SQL pattern + idempotency guards).
- `/home/claude/chris/src/pensieve/store.ts` — `storePensieveEntry` signature at lines 19-49 (additive parameter target).
- `/home/claude/chris/src/pensieve/tagger.ts` — `tagEntry` at lines 34-90 (auto-tagger only updates entries with `epistemic_tag IS NULL`).
- `/home/claude/chris/src/bot/bot.ts` — `bot.on('message:text', ...)` at line 75; `bot.on('message:document', ...)` at line 78 (template for `message:voice` registration).
- `/home/claude/chris/src/chris/language.ts` — `getLastUserLanguage` returns `'English'|'French'|'Russian'|null`.
- `/home/claude/chris/src/episodic/sources.ts` — `dayBoundaryUtc` Luxon helper.
- `/home/claude/chris/src/proactive/state.ts` — `hasReachedRitualDailyCap` + `incrementRitualDailyCount` (Phase 25 substrate; voice note ritual counted toward 3/day ceiling).
- `/home/claude/chris/package.json` — `"franc": "^6.2.0"` confirmed (zero version bump for VOICE-05).

### Secondary (MEDIUM confidence)
- Pitfall 7 (shuffled-bag) — property test design adapted from research SUMMARY's invariants (600 fires, ±20%, max gap ≤ 11).
- Pitfall 9 default threshold (5 deposits) — practitioner consensus per research; tunable per Phase 28 adjustment dialogue.

### Tertiary (LOW confidence — flagged)
- 18-hour `RESPONSE_WINDOW_HOURS` default — guess based on "end of day" framing per OPEN-1 in research SUMMARY. Defensible 12h/18h/24h/36h range; revisit after 30 days of real use.

---

## Open Questions / Confidence Flags

**HIGH confidence:**
- PP#5 placement (verified by reading `processMessage` flow end-to-end).
- Migration 0007 shape (mirrors 0006 hand-SQL pattern; idempotency guards proven across v2.1/v2.2/v2.3).
- Mock-chain update scope (Phase 14 v2.1 regression class precedent).
- `epistemicTag` parameter add to `storePensieveEntry` (additive, backward-compat; verified call-site count via grep).
- Pre-fire suppression query (mirrors Pitfall 9 mitigation language exactly).

**MEDIUM confidence:**
- Shuffled-bag head-removal at cycle boundary (Section 2 caveat) — recommended option (i) `lastIndex` parameter; planner verifies test passes deterministically.
- Whether to ship `scripts/fire-ritual.ts` operator wrapper in Plan 26-02 vs deferring (recommended: ship; ~30 LoC; matches `scripts/manual-sweep.ts` convention).

**LOW confidence:**
- Whether `bot.on('message:voice')` handler should also handle `message:audio` and `message:video_note` (Telegram has 3 voice-like update types). Recommendation: ship Plan 26-04 with `message:voice` only per spec language; if Greg sends a voice_note (round video) or audio file, normal `message:text` doesn't trigger and the message is silently dropped (Pre-Phase 26 status quo). Address in v2.5 if Greg complains.

---

*Phase 26 research complete: 2026-04-26*
*Next: gsd-pattern-mapper for `26-PATTERNS.md`, then gsd-planner for 4 PLAN.md files, then gsd-plan-checker for `26-VERIFICATION.md`.*
