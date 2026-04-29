# Phase 28: Skip-Tracking + Adjustment Dialogue — Research

**Researched:** 2026-04-29
**Domain:** rituals/synthesis layer — skip-tracking projection, Haiku-classified adjustment dialogue, ritual_pending_responses extension, audit append-only
**Confidence:** HIGH for substrate facts; MEDIUM for specific landmines on `ritual_config_events` schema (verified contradicts CONTEXT.md)

## Summary

Phase 28 builds the synthesis layer over substrate that Phases 25/26/27 already shipped. Most of the building blocks Phase 28 needs already exist as TypeScript symbols and database tables — but the planner must navigate **four high-impact reality gaps** between CONTEXT.md and the actual codebase before authoring plans.

**Primary recommendation:** Treat CONTEXT.md decisions as locked, but verify EACH against the cited file/line before plan authoring. Four CONTEXT.md decisions describe state that does NOT match the on-disk code: (1) `ritual_config_events` table schema, (2) `RitualFireOutcome` "10-variant final union", (3) cron registration shape for the 1-minute confirmation sweep, (4) seed-skip_threshold audit (already correct, no migration 0010 needed).

The four-plan split is sound. Plan 28-01 must do MORE than CONTEXT.md described — it must add `ritual_fire_events` writes to `voice-note.ts` AND `weekly-review.ts` (currently neither writes there; only `wellbeing.ts` does). The PP#5 detector at `src/chris/engine.ts:167-208` is the right extension point, and the `ritual_pending_responses.metadata` jsonb column does NOT exist as a typed field on the schema (the table has no `metadata` column at all per current schema.ts:485-505) — Plan 28-03 must either add the column via migration 0010 OR use a different storage strategy.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Outcome union extension + ritual_fire_events writes | API/Backend (`src/rituals/*.ts`) | Database (jsonb metadata) | Pure backend type/persistence; no UI, no engine reach |
| skip_count projection + cadence-aware threshold | API/Backend (`src/rituals/scheduler.ts` + new helper) | Database (denormalized `rituals.skip_count` + replay from `ritual_fire_events`) | Pure SQL projection; predicate runs in cron-tier sweep |
| Adjustment dialogue trigger | API/Backend (`scheduler.ts` predicate) | Telegram (bot.api.sendMessage) | Cron-driven; sends single message |
| Adjustment dialogue reply detection | Engine (`src/chris/engine.ts` PP#5 extension) | API/Backend (`src/rituals/adjustment-dialogue.ts` handler) | PP#5 is the single chokepoint for active-pending-response detection; must short-circuit BEFORE LLM call |
| Haiku 3-class classification | LLM/Anthropic SDK (`anthropic.messages.parse` + `zodOutputFormat`) | API/Backend (Zod schema) | Stateless LLM call; mirrors Phase 29 pattern |
| 60s confirmation window | Cron (NEW 1-minute tick in `src/cron-registration.ts`) | Database (`ritual_pending_responses.expires_at`) | Container-restart-resilient via DB row, NOT setTimeout |
| Self-protective 30-day pause | Cron (existing `runRitualSweep` extension) | Database (rituals.enabled + config.mute_until) | Sweep-tick-driven enable/disable; no UI |
| ritual_config_events audit | API/Backend (every config mutation site) | Database (append-only existing table — schema mismatch flagged) | Pure persistence; no LLM, no UI |
| M006 refusal pre-check | API/Backend (`detectRefusal` from `src/chris/refusal.ts`) | — | Pure regex function (already exists, zero LLM cost) |

## Standard Stack

### Core (already in codebase — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | (locked OOS-14) | Haiku 3-class classification via `messages.parse` + `zodOutputFormat` | Phase 29 already uses this pattern for Stage-2 judge — `src/rituals/weekly-review.ts:263-285` is the canonical analog [VERIFIED: file read] |
| `zod` (v3 + v4 dual) | (locked OOS-14) | Strict Zod schema for Haiku output | Same v3+v4 dual pattern as Phase 29 — v4 at SDK boundary, v3 for runtime re-validation [VERIFIED: `src/rituals/weekly-review.ts:131-160`] |
| `drizzle-orm` | (existing) | jsonb mutations via `sql\`jsonb_set(...)\`` + atomic UPDATE...RETURNING | Phase 27's `wellbeing.ts:228-233` and Phase 25's `idempotency.ts:74-90` are the canonical analogs [VERIFIED: file read] |
| `node-cron` | (existing) | 1-minute confirmation sweep cron | `src/cron-registration.ts:53-136` is the registration extension point [VERIFIED: file read] |
| `grammy` | (locked OOS-14) | Telegram message + reply | `bot.api.sendMessage` direct call (no inline keyboard needed per D-28-05 — text-reply contract) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 1-minute cron tick | JS `setTimeout` | REJECTED in D-28-06 — doesn't survive container restart |
| 1-minute cron tick | Wait until next 10:00/21:00 sweep | REJECTED in D-28-06 — too coarse for 60s window |
| Inline keyboard for confirmation | Plain text "yes"/"no" reply | LOCKED to text-reply per D-28-05 (single-turn structured Haiku is sufficient) |
| Pre-check refusal | Let Haiku classify refusals | REJECTED in D-28-08 — Haiku could mis-classify refusal as evasive → spurious 30-day pause |

**Installation:** None — all packages already present.

**Version verification:** Phase 28 adds zero new dependencies (per CONTEXT.md OOS-13/OOS-14 inheritance — locked at milestone).

## Architecture Patterns

### System Architecture Diagram

```
                     ┌──────────────────────────────────┐
                     │  Cron Tick (10:00 OR 21:00 Paris)│
                     └────────────┬─────────────────────┘
                                  │
                                  ▼
                     ┌──────────────────────────────────┐
                     │  runSweep (proactive/sweep.ts)   │
                     │  → invokes runRitualSweep        │
                     └────────────┬─────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  runRitualSweep (rituals/scheduler.ts)                      │
   │  ┌────────────────────────────────────────────────────────┐ │
   │  │ NEW STEP 0a: auto-re-enable expired mutes (D-28-07)    │ │
   │  │ NEW STEP 0b: skip_count projection rebuild (Plan 28-02)│ │
   │  │ NEW STEP 0c: shouldFireAdjustmentDialogue (Plan 28-02) │ │
   │  │      ├── true  → fireAdjustmentDialogue (Plan 28-03)   │ │
   │  │      └── false → continue to existing dispatch         │ │
   │  └────────────────────────────────────────────────────────┘ │
   │  ┌────────────────────────────────────────────────────────┐ │
   │  │ EXISTING: dispatchRitualHandler                        │ │
   │  │  → fireVoiceNote / fireWellbeing / fireWeeklyReview    │ │
   │  │  → NEW: each handler writes ritual_fire_events row     │ │
   │  └────────────────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────────┐
   │  NEW Cron Tick (* * * * *) — 1-minute confirmation sweep    │
   │  → ritual_confirmation_sweep helper                         │
   │  → SELECT FROM ritual_pending_responses WHERE              │
   │    metadata->>'kind'='adjustment_confirmation'             │
   │    AND expires_at <= now() AND consumed_at IS NULL          │
   │  → for each: applyConfirmedPatch + ritual_config_events     │
   └─────────────────────────────────────────────────────────────┘

   Greg sends Telegram message:
   ┌──────────────────────┐
   │ bot.on('message:text') → processMessage (chris/engine.ts)   │
   └────────────┬─────────────────────────────────────────────────┘
                │
                ▼
   ┌──────────────────────────────────────────────────────────┐
   │ PP#5 (engine.ts:167) — findActivePendingResponse         │
   │  EXISTING: kind = (untyped) → recordRitualVoiceResponse  │
   │  NEW Phase 28 dispatch by metadata.kind:                 │
   │   • 'adjustment_dialogue'    → handleAdjustmentReply     │
   │   • 'adjustment_confirmation' → handleConfirmationReply  │
   │   • (default/voice-note)     → recordRitualVoiceResponse │
   └────────────┬─────────────────────────────────────────────┘
                │ (return '' — IN-02 silent-skip; LLM never called)
                ▼
   ┌──────────────────────────────────────────────────────────┐
   │ handleAdjustmentReply (NEW Plan 28-03 + 28-04):          │
   │  1. detectRefusal (refusal.ts) — if refusal, route       │
   │     to refusalPath, write ritual_config_events, RETURN.  │
   │     [Refusals NEVER reach Haiku, NEVER count as evasive] │
   │  2. anthropic.messages.parse + 3-class Zod schema        │
   │  3. classification ∈ {change_requested, no_change,       │
   │                        evasive}                          │
   │  4. on change_requested: write adjustment_confirmation   │
   │     pending row + send "OK to apply?" Telegram msg       │
   │  5. on no_change: log + reset skip_count + return        │
   │  6. on evasive: write evasive marker to ritual_responses,│
   │     check hasReachedEvasiveTrigger → maybe auto-pause    │
   └──────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/rituals/
├── adjustment-dialogue.ts           # NEW — fireAdjustmentDialogue, handleAdjustmentReply,
│                                    #       confirmConfigPatch, hasReachedEvasiveTrigger,
│                                    #       shouldFireAdjustmentDialogue, computeSkipCount,
│                                    #       autoReEnableExpiredMutes, ritual_confirmation_sweep
├── types.ts                          # MODIFIED — extend RitualFireOutcome union
├── scheduler.ts                      # MODIFIED — wire predicates BEFORE dispatchRitualHandler
├── voice-note.ts                     # MODIFIED — emit ritual_fire_events on every fire
├── wellbeing.ts                      # MODIFIED — also emit on initial fire (currently only on tap completion)
├── weekly-review.ts                  # MODIFIED — emit ritual_fire_events on every fire
├── __tests__/
│   ├── adjustment-dialogue.test.ts  # NEW — unit tests
│   ├── adjustment-dialogue-integration.test.ts  # NEW — real-DB
│   └── scheduler.test.ts            # MODIFIED — predicate ordering tests

src/chris/
├── engine.ts                         # MODIFIED — PP#5 dispatch by metadata.kind

src/cron-registration.ts              # MODIFIED — add 1-minute confirmation sweep cron

src/db/
├── schema.ts                         # MODIFIED — add metadata jsonb column to
│                                    #            ritual_pending_responses (Plan 28-03)
├── migrations/
│   ├── 0010_*.sql                   # NEW — ritual_pending_responses.metadata + 
│                                    #       ritual_config_events schema FIX (see Landmines)
│                                    #       + RitualConfigSchema schema_version 2 (if needed)
```

### Pattern 1: PP#5 Dispatch by metadata.kind (extend existing)

**What:** Single chokepoint at engine position 0 dispatches by pending row's `metadata.kind` jsonb field.
**When to use:** ANY new ritual that needs a pending-response wait. Phase 28 introduces `adjustment_dialogue` and `adjustment_confirmation` kinds.

**Existing PP#5 shape** (verbatim from `src/chris/engine.ts:167-208`):
```typescript
// ── PP#5: Ritual-response detection (M009 Phase 26 VOICE-01; per D-26-02) ─
const chatIdStrPP5 = chatId.toString();
const pending = await findActivePendingResponse(chatIdStrPP5, new Date());
if (pending) {
  try {
    const result = await recordRitualVoiceResponse(pending, chatId, text);
    // ...
    return ''; // IN-02 silent-skip
  } catch (depositErr) {
    // race-loss handling
  }
}
```

**Phase 28 extension** (recommended — single chokepoint):
```typescript
if (pending) {
  // NEW: dispatch by metadata.kind. Voice-note pending rows currently lack
  // any metadata.kind (default behavior). Phase 28 adds new kinds.
  const kind = (pending.metadata as { kind?: string } | null)?.kind;
  if (kind === 'adjustment_dialogue') {
    return await handleAdjustmentReply(pending, chatId, text); // returns ''
  }
  if (kind === 'adjustment_confirmation') {
    return await handleConfirmationReply(pending, chatId, text); // returns ''
  }
  // default (no kind set) — existing voice-note path
  return await recordRitualVoiceResponse(pending, chatId, text);
}
```

### Pattern 2: Atomic UPDATE...RETURNING for state mutations
**Source:** `src/rituals/idempotency.ts:74-90` (RIT-10) [VERIFIED]
**When to use:** Any mutation where two concurrent invocations must produce exactly one winner. Adjustment dialogue confirmation uses this for the apply-or-fail on the confirmation row.

### Pattern 3: jsonb_set with postgres-js string-binding workaround
**Source:** `src/rituals/wellbeing.ts:148-150 + 228-233` [VERIFIED]
```typescript
metadata: sql`jsonb_set(${ritualResponses.metadata}, '{message_id}', ${String(sent.message_id)}::jsonb, true)`,
```
Per `wellbeing.ts:142-145` JSDoc: postgres-js cannot bind a JS number directly to a `jsonb` parameter; cast `String(value) → ::jsonb` instead.

### Pattern 4: Haiku messages.parse + zodOutputFormat with v3+v4 dual schema
**Source:** `src/rituals/weekly-review.ts:263-285` (Stage-2 judge) [VERIFIED]
```typescript
const response = await anthropic.messages.parse({
  model: HAIKU_MODEL,
  max_tokens: 150,
  system: [{ type: 'text' as const, text: judgePrompt }],
  messages: [{ role: 'user' as const, content: question }],
  output_config: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(StageTwoJudgeSchemaV4 as unknown as any),
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error('Stage-2 Haiku judge: parsed_output is null');
}
const parsed = StageTwoJudgeSchema.parse(response.parsed_output); // v3 re-validate
```
**Why dual:** SDK requires v4 schema (`zodOutputFormat`); v3 has `.refine()` semantics for retry-loop discrimination. Phase 29 explains this in `weekly-review.ts:144-156` JSDoc.

### Pattern 5: ritual_pending_responses with prompt_text NOT NULL
**Source:** `src/rituals/voice-note.ts:343-351` [VERIFIED]
```typescript
await db.insert(ritualPendingResponses).values({
  ritualId: ritual.id,
  chatId,
  firedAt,
  expiresAt,
  promptText: prompt,  // NOT NULL — Phase 26 amended D-26-02
});
```

### Anti-Patterns to Avoid
- **`setTimeout` for the 60s confirmation window** — REJECTED in D-28-06; doesn't survive container restart.
- **Letting Haiku classify refusals** — REJECTED in D-28-08; refusal MUST short-circuit BEFORE LLM call.
- **Multi-turn `@grammyjs/conversations`** — explicit OOS-11 milestone-level anti-feature; single-turn structured Haiku is sufficient.
- **Per-handler ritual_fire_events writes inconsistent** — current state: only `wellbeing.ts` writes (and only on completion/skip, not on initial fire). Plan 28-01 MUST homogenize this across all 3 handlers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 60s timer | JS `setTimeout` queue | DB row + 1-minute cron sweep | Container-restart-resilient (D-28-06) |
| Refusal regex | New refusal patterns | `detectRefusal` from `src/chris/refusal.ts` | 15 EN + 14 FR + 14 RU patterns already shipped + meta-reference guard [VERIFIED: file read] |
| Haiku JSON parsing | Custom JSON parser + retry | `anthropic.messages.parse` + `zodOutputFormat` (v3+v4 dual) | SDK boundary already proven in Phase 29 |
| Skip count projection | Manual SQL counting | Drizzle aggregator over `ritual_fire_events` | M007 `decision_events` precedent (D004 spirit) |
| Atomic state mutation | SELECT-then-UPDATE | `UPDATE...WHERE consumed_at IS NULL RETURNING` | Race-safe (Phase 26 atomic-consume precedent at `voice-note.ts:187-200`) |
| Local time math | Manual UTC ms arithmetic | Luxon `DateTime.now().setZone(tz)` | DST-safe (Phase 25 D-09 / RIT-08 lock) |

**Key insight:** Phase 28 introduces zero new packages. Every primitive Phase 28 needs already exists in the codebase from Phases 25/26/27/29 — the work is composition, not invention.

## Runtime State Inventory

> Phase 28 is greenfield additive (no rename/refactor/migration). Skipping per researcher protocol.

## Common Pitfalls

### Pitfall 1: PP#5 dispatch order regression (Pitfall 6 carry-over)

**What goes wrong:** Phase 28's PP#5 extension changes the metadata.kind branch but accidentally falls through to LLM mode-detection.
**Why it happens:** PP#5's load-bearing invariant is "ritual responses NEVER trigger LLM calls". Adding new kind branches without explicit short-circuit returns breaks Phase 26's HARD CO-LOC #1.
**How to avoid:** All adjustment-dialogue branches MUST `return ''` (IN-02 silent-skip). Add a regression test mirroring `engine-pp5.test.ts` HIT-path's `afterAll(() => expect(mockAnthropicCreate).not.toHaveBeenCalled())` pattern but for `metadata.kind === 'adjustment_dialogue'` and `'adjustment_confirmation'` paths.
**Warning signs:** Any failing assertion `expect(mockAnthropicMessagesCreate).not.toHaveBeenCalled()` in adjustment-dialogue integration tests.

### Pitfall 2: Refusal pre-check ordering (load-bearing for SKIP-06 invariant)

**What goes wrong:** Haiku classifies "drop it" as evasive → spurious 30-day auto-pause after 2 such replies.
**Why it happens:** Refusal patterns (`drop it`, `not now`, `disable`) fall in the semantic vicinity of evasive ("I don't want to engage"). Without a pre-check, classifier confidence on these inputs is unreliable.
**How to avoid:** `handleAdjustmentReply` MUST call `detectRefusal(text)` BEFORE `anthropic.messages.parse`. If `isRefusal: true`, route to refusal handler and RETURN — never reach Haiku.
**Warning signs:** ritual_config_events row with `change_kind = 'auto_pause'` triggered by 2 refusal-like replies.

### Pitfall 3: Cron-tick race between confirmation sweep and Greg's reply

**What goes wrong:** Greg replies "yes" at 60s 0ms; the 1-minute cron tick fires "auto-apply on timeout" at 60s 1ms. Result: patch applied twice, or with conflicting source attribution.
**Why it happens:** Both code paths apply the same patch, but they're independently triggered (PP#5 vs. cron sweep).
**How to avoid:** Use atomic UPDATE...RETURNING on the confirmation pending row's `consumed_at IS NULL` guard. Whichever path consumes the row first wins; the loser sees zero rows returned and silently logs.
**Warning signs:** ritual_config_events showing TWO rows for the same ritual_id in <2s window with different `actor` values.

### Pitfall 4: Outcome union <-> ritual_fire_events.outcome string drift

**What goes wrong:** Plan extends the TS union with `'fired_no_response'` but writes the wrong literal to `ritual_fire_events.outcome`.
**Why it happens:** `ritual_fire_events.outcome` is `text NOT NULL` (free-form), NOT a Postgres enum. The union and the write site are not coupled at the schema level. Already a problem TODAY: `wellbeing.ts:65-67` writes `'wellbeing_completed'` and `'wellbeing_skipped'` strings to ritual_fire_events that are NOT members of the typed `RitualFireOutcome` union.
**How to avoid:** Define a single source-of-truth string-literal const exported from `types.ts` and reuse at every write site. Add a type-level assertion that every `RitualFireOutcome` literal corresponds to an exported `RITUAL_OUTCOME_*` const.
**Warning signs:** A test inserting `outcome: 'firedNoResponse'` (camelCase typo) succeeds at SQL level but fails to count toward skip_count because the projection query filters by literal `'fired_no_response'`.

### Pitfall 5: `ritual_config_events` schema mismatch (CONTEXT.md vs reality)

**What goes wrong:** Plan author follows CONTEXT.md D-28-09 ("schema is `id, ritual_id, change_kind, old_value, new_value, source, source_metadata jsonb, created_at`") and writes code that fails at SQL execution.
**Why it happens:** The actual table (per `src/db/schema.ts:471-477` + `src/db/migrations/0006_rituals_wellbeing.sql:70-76`) has columns `id, ritual_id, actor varchar(32), patch jsonb, created_at`. NO `change_kind`, NO `old_value`, NO `new_value`, NO `source`, NO `source_metadata`.
**How to avoid:** Either (a) author migration 0010 to ADD the missing columns OR (b) treat `patch` as a discriminated jsonb envelope: `{ change_kind, old_value, new_value, source }` written into the existing `patch` jsonb column. Recommend (b) — minimizes migration churn, matches existing `actor varchar(32)` semantics ('system'|'user'|'auto_apply_on_timeout').
**Warning signs:** Type errors at compile time when Plan 28-04 tries to call `.values({ change_kind: ..., old_value: ... })` on `ritualConfigEvents`.

### Pitfall 6: ritual_pending_responses.metadata column does NOT exist

**What goes wrong:** Plan 28-03 writes `metadata: { kind: 'adjustment_dialogue', proposed_change: {...} }` to ritual_pending_responses and gets a SQL error "column metadata does not exist".
**Why it happens:** Per `src/db/schema.ts:485-505` + `src/db/migrations/0006_rituals_wellbeing.sql:78-86` + `0007_daily_voice_note_seed.sql:19-23`, the `ritual_pending_responses` table has columns: `id, ritual_id, chat_id, fired_at, expires_at, consumed_at, prompt_text, created_at`. NO `metadata` column.
**How to avoid:** Plan 28-03 (or a dedicated 28-00 substrate plan) MUST ship migration 0010 that adds `metadata jsonb` column to `ritual_pending_responses`. Mirror Phase 26's "DEFAULT-then-DROP-DEFAULT" pattern from `0007_daily_voice_note_seed.sql:19-23` for forward-compat with existing zero-row table on prod.
**Warning signs:** ANY plan task that does `.values({ ..., metadata: {...} })` on `ritualPendingResponses` will fail at runtime against a DB without migration 0010.

### Pitfall 7: skip_count reset ambiguity at handler boundary

**What goes wrong:** Voice-note `recordRitualVoiceResponse` (PP#5 deposit path) needs to reset `rituals.skip_count = 0` on `responded`, but currently it doesn't touch `rituals.skip_count` at all.
**Why it happens:** Phase 26's `recordRitualVoiceResponse` at `src/rituals/voice-note.ts:179-230` writes Pensieve + ritual_responses, but doesn't write ritual_fire_events and doesn't update rituals.skip_count. Plan 28-01 must extend it to emit a `'responded'` event AND reset skip_count.
**How to avoid:** Plan 28-01's per-handler audit MUST include the response-handling code paths (PP#5 voice-note deposit, wellbeing tap completion, weekly review which has no user-reply) — NOT just the firing paths.

### Pitfall 8: 1-minute cron is ALSO a peer to existing crons

**What goes wrong:** Plan 28-03 adds the 1-minute cron tick but forgets to handle the case where it overlaps with the 10:00 or 21:00 sweep (both will reach `runRitualSweep`, both will check the same pending rows).
**Why it happens:** `src/cron-registration.ts:100-115` registers `runRitualSweep` at 21:00; `src/proactive/sweep.ts:352-353` ALSO invokes `runRitualSweep` from the 10:00 sweep. Adding a 1-minute cron creates a third invocation site.
**How to avoid:** Make the 1-minute cron call ONLY a narrow `ritual_confirmation_sweep` helper (not full `runRitualSweep`). The narrow helper does a partial-index lookup for confirmation pending rows and returns immediately if zero. Cost: one SQL SELECT per minute, sub-millisecond when nothing's pending.
**Warning signs:** Logs showing `rituals.sweep.start` triggered every minute (instead of only at 10:00/21:00).

## Code Examples

Verified patterns from official sources (citations to local files):

### Atomic-consume race-safe pending-row mutation
```typescript
// Source: src/rituals/voice-note.ts:184-204 [VERIFIED file read]
const [consumed] = await db
  .update(ritualPendingResponses)
  .set({ consumedAt: new Date() })
  .where(
    and(
      eq(ritualPendingResponses.id, pending.id),
      isNull(ritualPendingResponses.consumedAt),
    ),
  )
  .returning({
    id: ritualPendingResponses.id,
    consumedAt: ritualPendingResponses.consumedAt,
    promptText: ritualPendingResponses.promptText,
  });

if (!consumed || !consumed.consumedAt) {
  throw new StorageError('ritual.pp5.race_lost');
}
```

### Refusal pre-check (reuse existing detector)
```typescript
// Source: src/chris/refusal.ts:131-156 [VERIFIED file read]
import { detectRefusal } from '../chris/refusal.js';

const refusalResult = detectRefusal(text);
if (refusalResult.isRefusal) {
  // route to refusal path; do NOT call Haiku
  // refusalResult.topic and refusalResult.originalSentence available for log
  return; // or whatever the adjustment-dialogue refusal-path semantics are
}
// otherwise proceed to Haiku classification
```

### Haiku 3-class structured output
```typescript
// Mirror of src/rituals/weekly-review.ts:263-285 [VERIFIED file read]
const AdjustmentClassificationSchemaV4 = zV4.object({
  classification: zV4.enum(['change_requested', 'no_change', 'evasive']),
  proposed_change: zV4.object({
    field: zV4.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
    new_value: zV4.union([zV4.string(), zV4.number(), zV4.null()]),
  }).nullable(),
  confidence: zV4.number().min(0).max(1),
});

const AdjustmentClassificationSchema = z.object({
  classification: z.enum(['change_requested', 'no_change', 'evasive']),
  proposed_change: z.object({
    field: z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
    new_value: z.union([z.string(), z.number(), z.null()]),
  }).nullable(),
  confidence: z.number().min(0).max(1),
});

const response = await anthropic.messages.parse({
  model: HAIKU_MODEL,
  max_tokens: 200,
  system: [{ type: 'text' as const, text: ADJUSTMENT_JUDGE_PROMPT }],
  messages: [{ role: 'user' as const, content: greg_text }],
  output_config: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(AdjustmentClassificationSchemaV4 as unknown as any),
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error('Adjustment dialogue: parsed_output is null');
}
const parsed = AdjustmentClassificationSchema.parse(response.parsed_output);
```

### Ritual_fire_events write (current pattern)
```typescript
// Source: src/rituals/wellbeing.ts:293-298 [VERIFIED file read]
await db.insert(ritualFireEvents).values({
  ritualId: openRow.ritualId,
  firedAt: new Date(),
  outcome: OUTCOME_COMPLETED,           // text — must match union literal
  metadata: { fireRowId: openRow.id, snapshotDate: today },
});
```

### Cron registration extension
```typescript
// Mirror of src/cron-registration.ts:100-115 [VERIFIED file read]
// Add inside registerCrons() after the 21:00 ritual sweep registration:
cron.schedule(
  '* * * * *', // every minute (D-28-06)
  async () => {
    try {
      await deps.ritualConfirmationSweep();
    } catch (err) {
      logger.error({ err }, 'rituals.confirmation_sweep.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
```
**Note:** the `RegisterCronsDeps` interface at `src/cron-registration.ts:29-42` MUST be extended with `ritualConfirmationSweep: () => Promise<void>` AND `src/index.ts` (the call site) updated to pass it.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single skip_count counter (no event log) | Append-only ritual_fire_events + denormalized projection | Phase 28 (this) | M007 D004 precedent — replayable; survives concurrent writes correctly |
| Multi-turn dialogue via grammy conversations | Single-turn structured Haiku 3-class | Locked OOS-11 at milestone | No new dependency; deterministic test surface |
| JS setTimeout for windowed callbacks | DB row + cron sweep | D-28-06 | Container-restart-resilient |
| Phase 27's hybrid wellbeing outcomes (`wellbeing_completed`/`wellbeing_skipped` as raw strings) | Phase 28 must homogenize ALL outcomes into the typed union OR document the carved-out wellbeing-specific strings | Phase 28 (this) | Type safety — see Pitfall 4 |

**Deprecated/outdated:**
- The CONTEXT.md D-28-02 claim of "Final union (10 variants) including wellbeing_skipped" is INCORRECT against current code. Current union is 7 variants per `src/rituals/types.ts:88-95`; `wellbeing_skipped` is currently only a free-form string written to `ritual_fire_events.outcome`, not a TypeScript union member.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x with @vitest/web-compat (existing) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `bash scripts/test.sh src/rituals/__tests__/<file>.test.ts` |
| Full suite command | `bash scripts/test.sh` (Docker postgres + all migrations + all tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKIP-01 | RitualFireOutcome union extended; only `fired_no_response` increments | unit | `bash scripts/test.sh src/rituals/__tests__/types.test.ts -x` | partial — extend |
| SKIP-01 | `system_suppressed` does NOT increment skip_count | integration | `bash scripts/test.sh src/rituals/__tests__/skip-count.test.ts -x` | ❌ Wave 0 |
| SKIP-01 | `wellbeing_skipped` does NOT increment skip_count | integration | (same file) | ❌ Wave 0 |
| SKIP-02 | rituals.skip_count rebuildable from ritual_fire_events by replay | integration | `bash scripts/test.sh src/rituals/__tests__/skip-count-projection.test.ts -x` | ❌ Wave 0 |
| SKIP-03 | daily=3 / weekly=2 cadence-aware threshold | unit + integration | `bash scripts/test.sh src/rituals/__tests__/should-fire-adjustment.test.ts -x` | ❌ Wave 0 |
| SKIP-04 | Adjustment dialogue Telegram + Haiku 3-class parse | mocked-Haiku | `bash scripts/test.sh src/rituals/__tests__/adjustment-dialogue.test.ts -x` | ❌ Wave 0 |
| SKIP-05 | 60s confirmation window — auto-apply on yes/no-reply, abort on no | integration + cron-mock | `bash scripts/test.sh src/rituals/__tests__/confirmation-window.test.ts -x` | ❌ Wave 0 |
| SKIP-06 | 2 evasive in 14d → 30-day pause + auto-re-enable | integration + clock-mock (`vi.setSystemTime`) | `bash scripts/test.sh src/rituals/__tests__/self-protective-pause.test.ts -x` | ❌ Wave 0 |
| SKIP-07 | M006 refusal short-circuits BEFORE Haiku; ritual_config_events on every mutation | integration | `bash scripts/test.sh src/rituals/__tests__/refusal-routing.test.ts -x` | ❌ Wave 0 |

### Falsifiable test plans for each Phase 28 success criterion

**SC-1 — Threshold trigger AND outcome filtering:**
- Setup: insert ritual `daily_voice_note` with skip_count=0; insert 3 `ritual_fire_events` rows with outcome=`'fired_no_response'`. Then insert 1 row with outcome=`'system_suppressed'` and 1 with outcome=`'window_missed'`.
- Run `shouldFireAdjustmentDialogue(ritual)` after each insert.
- Assert: returns false for first 2 fired_no_response rows; returns TRUE only after 3rd. Inserting `system_suppressed` or `window_missed` rows does NOT advance the count.
- Replay: call `computeSkipCount(ritualId)` and assert returned value matches `rituals.skip_count` denormalized column.

**SC-2 — Haiku 3-class parsing + 60s window apply/abort:**
- Mock `anthropic.messages.parse` to return `{ classification: 'change_requested', proposed_change: { field: 'fire_at', new_value: '19:30' }, confidence: 0.95 }`.
- Trigger adjustment dialogue, simulate Greg reply, assert (a) proposed_change is echoed in confirmation Telegram message, (b) `ritual_pending_responses` row created with `metadata.kind = 'adjustment_confirmation'` and `expires_at = firedAt + 60s`.
- Branch A (yes): Inject "yes" reply via PP#5; assert patch applied to `rituals.config.fire_at = '19:30'` AND `ritual_config_events` row written with `actor = 'user'` (or equivalent).
- Branch B (no): Inject "no" reply; assert patch NOT applied AND `ritual_config_events` row written with `actor = 'user'` and patch.change_kind = 'patch_aborted'.
- Branch C (timeout): `vi.setSystemTime(firedAt + 61s)`, run `ritual_confirmation_sweep()`; assert patch applied AND `ritual_config_events` row written with `actor = 'auto_apply_on_timeout'`.

**SC-3 — Self-protective 30-day pause:**
- Insert 2 `ritual_responses` rows with `metadata.kind='adjustment_dialogue_response'` and `metadata.classification='evasive'`, `created_at = now - 7 days` and `created_at = now - 1 day` respectively.
- Run `hasReachedEvasiveTrigger(ritualId)` → assert returns TRUE.
- Run the predicate once; assert `rituals.enabled` flips to false AND `rituals.config.mute_until` set to ~now + 30 days.
- Advance clock 30 days + 1 minute; run `runRitualSweep` once; assert `rituals.enabled` flips back to true AND `rituals.config.mute_until` cleared (set to null) AND `ritual_config_events` row with `change_kind = 'auto_unpause'`.

**SC-4 — M006 refusal pre-check ordering:**
- Mock `anthropic.messages.parse` to record any calls (using Pitfall 6 / engine-pp5.test.ts cumulative-not-called pattern).
- Insert adjustment-dialogue pending row; inject "drop it" reply via PP#5.
- Assert: `mockAnthropicMessagesParse.mock.calls.length === 0` (refusal pre-check short-circuited).
- Assert: `rituals.enabled` flipped to false (D-28-08 routing).
- Assert: `ritual_config_events` row with `actor='adjustment_dialogue_refusal'` (or equivalent) and patch.change_kind='manual_disable'.
- Insert SECOND "drop it" reply 7 days later; re-run; assert `rituals.enabled` STILL false, ritual NOT auto-paused via evasive-trigger (because refusals don't write evasive markers).

### Sampling Rate
- **Per task commit:** scoped suite `bash scripts/test.sh src/rituals/__tests__/<file>.test.ts`
- **Per wave merge:** full rituals + chris suites `bash scripts/test.sh src/rituals/ src/chris/`
- **Phase gate:** full suite `bash scripts/test.sh` green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/rituals/__tests__/adjustment-dialogue.test.ts` — covers SKIP-04 (Haiku mocked)
- [ ] `src/rituals/__tests__/adjustment-dialogue-integration.test.ts` — covers SKIP-04 + SKIP-05 + SKIP-06 + SKIP-07 (real-DB)
- [ ] `src/rituals/__tests__/skip-count.test.ts` — covers SKIP-01 outcome-filtering rules
- [ ] `src/rituals/__tests__/skip-count-projection.test.ts` — covers SKIP-02 replay invariant
- [ ] `src/rituals/__tests__/should-fire-adjustment.test.ts` — covers SKIP-03 cadence-aware predicate
- [ ] `src/rituals/__tests__/confirmation-window.test.ts` — covers SKIP-05 60s window
- [ ] `src/rituals/__tests__/self-protective-pause.test.ts` — covers SKIP-06 2-in-14d pause + auto-re-enable
- [ ] `src/rituals/__tests__/refusal-routing.test.ts` — covers SKIP-07 M006 pre-check ordering
- [ ] Engine-side regression: `src/chris/__tests__/engine-pp5-adjustment.test.ts` — assert `mockAnthropicMessagesCreate.not.toHaveBeenCalled()` cumulative invariant for adjustment-dialogue PP#5 hits (Pitfall 6 carry-over)
- [ ] No framework install needed — vitest 4.x already present.

## Risks / Landmines

### Landmine 1: `ritual_config_events` schema mismatch with CONTEXT.md
**Severity:** HIGH — blocks all of Plan 28-04 if planner copies CONTEXT.md schema verbatim.
**Reality:** Per `src/db/schema.ts:471-477` the columns are `id, ritual_id, actor varchar(32), patch jsonb, created_at`. CONTEXT.md D-28-09 describes a DIFFERENT shape (`change_kind, old_value, new_value, source, source_metadata`). One of three resolutions:
1. **Recommend:** Use existing `patch jsonb` as a discriminated envelope: `patch = { change_kind, old_value, new_value, source }` and use existing `actor varchar(32)` for the source ('system'|'user'|'auto_apply_on_timeout'|'adjustment_dialogue_refusal').
2. Author migration 0010 to add the missing columns (extra schema surface; deferred unless Phase 28 needs the columns to be SQL-queryable individually — they don't).
3. Drop the audit detail to a thinner shape ('ritual_id, actor, patch') and let Phase 28 not capture all D-28-09 fields. Not recommended — loses replay capability per SKIP-07 spec.

### Landmine 2: `ritual_pending_responses.metadata` column does NOT exist
**Severity:** HIGH — blocks all of Plan 28-03 if not addressed first.
**Reality:** Per `src/db/schema.ts:485-505` and `0006_rituals_wellbeing.sql:78-86` the columns are `id, ritual_id, chat_id, fired_at, expires_at, consumed_at, prompt_text, created_at`. **There is no `metadata` column.**
**Resolution:** Plan 28-03 (or a Plan 28-00 substrate plan) MUST author migration 0010 adding `metadata jsonb` column (default `'{}'::jsonb` to avoid NOT NULL backfill ambiguity, mirroring Phase 26's prompt_text DEFAULT-then-DROP-DEFAULT pattern at `0007_daily_voice_note_seed.sql:19-23`).
**Verification:** `grep -n "metadata" src/db/schema.ts | grep -i ritualPendingResponses` returns NOTHING currently.

### Landmine 3: RitualFireOutcome union vs ritual_fire_events.outcome string drift (PRE-EXISTING)
**Severity:** MEDIUM — already a problem in shipped code; Phase 28 should fix as a side effect.
**Reality:** `src/rituals/wellbeing.ts:65-67` defines `OUTCOME_COMPLETED = 'wellbeing_completed'` and `OUTCOME_SKIPPED = 'wellbeing_skipped'` as the strings written to `ritual_fire_events.outcome` (text NOT NULL). NEITHER string appears in the typed `RitualFireOutcome` union (`src/rituals/types.ts:88-95`). The union currently has 7 variants; CONTEXT.md D-28-02's "10-variant final union" inflated count is wrong (assumes wellbeing_skipped is in the union, it isn't).
**Resolution:** Plan 28-01 should add ALL outcome string literals — `responded`, `window_missed`, `fired_no_response`, AND the existing `wellbeing_completed`/`wellbeing_skipped` — to the union AND export a `RITUAL_OUTCOME` const map so write sites reference the const not the string literal. Final union becomes 12 variants (7 existing + 3 new + 2 wellbeing carve-outs).

### Landmine 4: Seed-skip_threshold audit task in Plan 28-02 may be a no-op
**Severity:** LOW — wasted plan budget if not verified first.
**Reality:** CONTEXT.md D-28-04 anticipates that seed migrations 0007/0008/0009 might have wrong `skip_threshold` for cadence type. Direct file read confirms ALL THREE seeds are CORRECT:
- `0007_daily_voice_note_seed.sql:33` — `"skip_threshold":3` ✓ (daily default = 3)
- `0008_wellbeing_seed.sql:29` — `"skip_threshold": 3` ✓ (daily default = 3)
- `0009_weekly_review_seed.sql:51` — `"skip_threshold": 2` ✓ (weekly default = 2)
**Resolution:** Plan 28-02's "audit + emit migration 0010 if needed" task should explicitly check first; the migration is unnecessary today. Documenting this in Plan 28-02 saves a task or converts it to a documentation-only verification.

### Landmine 5: `runRitualSweep` invocation already happens THREE places
**Severity:** MEDIUM — adding a fourth (1-minute confirmation sweep) requires care.
**Reality:** `runRitualSweep` is currently invoked from:
- `src/cron-registration.ts:100-115` — at 21:00 Paris (RIT-11)
- `src/proactive/sweep.ts:352-353` — inside the 10:00 Paris proactive sweep
- (manual) `scripts/manual-sweep.ts` for operator UAT
Adding a 4th invocation at every minute inside `runRitualSweep` itself would balloon to 1440 sweep ticks/day. **Phase 28 must add a NARROW NEW helper `ritualConfirmationSweep` (separate function, not full sweep)** that ONLY scans for expired confirmation pending rows. The 1-minute cron calls THIS new helper, NOT `runRitualSweep`.
**Resolution:** Plan 28-03 wires `cron.schedule('* * * * *', ritualConfirmationSweep)` in `cron-registration.ts`. The new helper does ONE indexed SELECT (`WHERE metadata->>'kind' = 'adjustment_confirmation' AND expires_at <= now() AND consumed_at IS NULL`) and returns immediately if zero rows. Cost: one round-trip per minute when nothing pending.

### Landmine 6: PP#5 metadata.kind dispatch — voice-note rows have NO kind
**Severity:** MEDIUM — silent breakage of Phase 26 voice-note flow if PP#5 is mis-extended.
**Reality:** Today, voice-note pending rows are inserted at `voice-note.ts:343-351` WITHOUT a `metadata` field (since the column doesn't exist; see Landmine 2). After Plan 28-03 adds the metadata column, voice-note rows will have `metadata = NULL` (column default). PP#5 dispatch logic must treat `metadata IS NULL` OR `metadata->>'kind' IS NULL` as the existing voice-note path, NOT as a no-op.
**Resolution:** Test pattern: `const kind = (pending.metadata as { kind?: string } | null)?.kind;` then explicit branch on `kind === 'adjustment_dialogue'` etc., with default fall-through to `recordRitualVoiceResponse`. After Plan 28-03 lands, optionally backfill voice-note inserts to set `metadata: { kind: 'voice_note' }` for explicit dispatch (cosmetic; not required for correctness if default branch is voice-note).

### Landmine 7: Sycophancy carry-over (Pitfall 17) on Sonnet-shaped patches
**Severity:** LOW for v1; deferred test in CONTEXT.md OOS list.
**Reality:** The 3-class Haiku output is structured (no free-form prose), so Pitfall 14 single-question enforcement does NOT apply, and Pitfall 17 sycophancy risk is bounded — Haiku's `confidence` field is a number, not a sentence. Deferred per CONTEXT.md "Live anti-flattery test for adjustment dialogue — Could be added to Phase 30 TEST-31 scope. Deferred unless real-use surfaces sycophancy gaps." Plan author should NOT proactively wire HARD CO-LOC #3 CONSTITUTIONAL_PREAMBLE injection unless the Haiku prompt becomes free-form.

### Landmine 8: Response-side outcome emission split between handlers
**Severity:** MEDIUM — easy to miss the response paths and only instrument the firing paths.
**Reality:** `'fired_no_response'` is emitted from a SWEEP-time scan (response window expired), not from a handler. `'responded'` is emitted from the response-handling code path (PP#5 voice-note deposit, wellbeing tap completion). `'window_missed'` is emitted from the same sweep helper as `'fired_no_response'`. CONTEXT.md Plan 28-01 mentions this ("ritual_response_window_sweep helper") but the planner must trace each outcome to its emit-site explicitly:
| Outcome | Emit site | Triggers |
|---------|-----------|----------|
| `fired` | `fireVoiceNote`, `fireWellbeing`, `fireWeeklyReview` | Successful Telegram send |
| `responded` | `recordRitualVoiceResponse` (PP#5), `completeSnapshot` (wellbeing) | User reply within window |
| `window_missed` | NEW `ritualResponseWindowSweep` (in `runRitualSweep`) | `expires_at < now()` AND `consumed_at IS NULL` |
| `fired_no_response` | NEW `ritualResponseWindowSweep` (same helper as above) | Same trigger; this is the policy-classification pair |
| `wellbeing_skipped` | `handleSkip` (wellbeing) | Greg taps Skip button |
| `wellbeing_completed` | `completeSnapshot` (wellbeing) | All 3 dims tapped |
| `system_suppressed` | `fireVoiceNote` | ≥5 JOURNAL deposits today |

## Open Questions

1. **`ritual_config_events.actor` cardinality.**
   - What we know: Column is `varchar(32)` per `0006_rituals_wellbeing.sql:73`.
   - What's unclear: Does Phase 28 introduce a new `actor` value (`'auto_apply_on_timeout'` is 23 chars, `'adjustment_dialogue_refusal'` is 27 chars — both fit) OR does it set `actor='system'` and put detail in patch?
   - Recommendation: Use `actor='system'|'user'` (existing semantics) and put the detailed source in `patch.source` jsonb. Avoids varchar(32) length surprises.

2. **`adjustment_mute_until` schema location.**
   - What we know: CONTEXT.md D-28-08 proposes adding to `RitualConfigSchema` as 9th optional field.
   - What's unclear: Does this require `schema_version` bump from 1 to 2 + a migration?
   - Recommendation: Add as 9th `.optional()` field. Existing seed jsonb blobs in 0007/0008/0009 will simply lack the field (parsed as undefined — fine). NO `schema_version` bump needed because the strict-mode reject-unknown-fields invariant is unchanged (`adjustment_mute_until` is a NEW recognized field, not unknown).

3. **PP#5 race between adjustment_dialogue reply and adjustment_confirmation pending row creation.**
   - What we know: `handleAdjustmentReply` writes a NEW pending row (kind='adjustment_confirmation') and the 1-minute cron sweeps for expired ones.
   - What's unclear: If Greg sends 2 messages within 1 second (e.g., "change to 19:30" then "wait, 20:00 actually"), the second message lands as the confirmation pending's "yes/no" reply BEFORE Haiku finishes classifying the first.
   - Recommendation: PP#5 already serializes per-chat by Postgres MVCC on `consumedAt IS NULL` consume. The second reply hits the `adjustment_dialogue` row (now consumed by first reply) and silently misses; this is acceptable. Document explicitly: "user races with themselves are not in scope for v1".

4. **What happens if two DIFFERENT rituals both reach adjustment-dialogue threshold on the same sweep tick?**
   - What we know: `runRitualSweep` per-tick max-1 cap (LIMIT 1 in SQL), so only one ritual fires per tick. The other waits for next tick (next minute? next 11h? depends on which cron).
   - What's unclear: Does the predicate-check happen BEFORE the LIMIT 1 ordering? If yes, the ritual ordered first by `next_run_at ASC` gets to fire its adjustment dialogue; the other waits until next tick.
   - Recommendation: Predicate check happens INSIDE the per-tick cycle (after the LIMIT 1 fetch, before dispatchRitualHandler). The other ritual genuinely waits — acceptable for the rare worst-case where 2 rituals happen to reach threshold simultaneously.

5. **`computeSkipCount` baseline event — what's the start anchor for replay?**
   - What we know: D-28-03 says "from the most recent reset event (or ritual creation) and counts `fired_no_response` outcomes since".
   - What's unclear: Does the ritual creation produce a `ritual_fire_events` row? Migration 0007 just inserts into `rituals` table directly with no audit row. So `computeSkipCount` against a fresh ritual must handle the "zero events ever" case.
   - Recommendation: Default-to-zero when no events found. Reset events emitted from this point forward via `'responded'` outcome OR explicit reset-on-adjustment-completion outcome (e.g., new outcome `'adjustment_completed'` written by `applyConfirmedPatch`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | scripts/test.sh real-DB integration | ✓ (memory: "Always run full Docker tests") | (existing) | None — never skip integration tests per project memory |
| node-cron | 1-minute confirmation sweep registration | ✓ (existing in package.json) | (existing) | None |
| @anthropic-ai/sdk Haiku model | 3-class classification | ✓ (HAIKU_MODEL exported from `src/llm/client.ts`) | (existing per OOS-14) | Skip dialogue → fall through to standard prompt (degraded UX) |
| ANTHROPIC_API_KEY | Real Sonnet/Haiku in tests (deferred to Phase 30) | env-dep | — | describe.skipIf gating per Phase 29 Plan 04 precedent |
| Live Telegram bot | Operator UAT (`scripts/fire-ritual.ts`) | env-dep | — | mock `bot.api.sendMessage` in tests |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None for code path; ANTHROPIC_API_KEY only relevant for live tests deferred to Phase 30.

## Sources

### Primary (HIGH confidence)
- `src/rituals/types.ts` lines 42-103 — RitualConfigSchema + RitualFireOutcome union (current 7 variants)
- `src/rituals/scheduler.ts` lines 82-292 — runRitualSweep + dispatchRitualHandler
- `src/rituals/voice-note.ts` lines 130-365 — PP#5 helpers, fireVoiceNote, recordRitualVoiceResponse atomic-consume
- `src/rituals/wellbeing.ts` lines 1-435 — fireWellbeing, handleWellbeingCallback, ritual_fire_events writes (only existing handler that writes there)
- `src/rituals/weekly-review.ts` lines 263-285 + 419-480 — Haiku messages.parse + zodOutputFormat pattern, retry-cap-2 + fallback
- `src/rituals/idempotency.ts` lines 1-100 — atomic UPDATE...RETURNING reference pattern
- `src/chris/engine.ts` lines 167-208 — PP#5 detector at engine position 0
- `src/chris/refusal.ts` lines 22-156 — detectRefusal (M006 — 15 EN + 14 FR + 14 RU patterns)
- `src/cron-registration.ts` lines 22-136 — cron registration pattern + RegisterCronsDeps interface
- `src/db/schema.ts` lines 367-505 — rituals/wellbeing_snapshots/ritual_responses/ritual_fire_events/ritual_config_events/ritual_pending_responses
- `src/db/migrations/0006_rituals_wellbeing.sql` — substrate DDL (table shapes are authoritative)
- `src/db/migrations/0007_daily_voice_note_seed.sql` lines 25-39 — seed pattern + DEFAULT-then-DROP-DEFAULT idiom
- `src/db/migrations/0008_wellbeing_seed.sql` lines 19-36 — seed pattern (skip_threshold=3 ✓)
- `src/db/migrations/0009_weekly_review_seed.sql` lines 37-58 — seed pattern (skip_threshold=2 ✓)
- `src/proactive/sweep.ts` lines 339-359 — runRitualSweep invocation from 10:00 sweep
- `src/proactive/state.ts` lines 169-204 — hasReachedRitualDailyCap + incrementRitualDailyCount
- `src/cron-registration.ts:32 + src/config.ts:67` — `ritualSweepCron` env var = `0 21 * * *` (only fires once per day!)
- `scripts/test.sh` lines 1-80 — Docker postgres test harness pattern; migrations 0006-0009 applied
- `.planning/phases/26-daily-voice-note-ritual/26-02-SUMMARY.md` — HARD CO-LOC #1 + #5 atomic plan precedent
- `.planning/phases/29-weekly-review/29-04-SUMMARY.md` — HARD CO-LOC #6 live test scaffolding pattern (skipIf-gated)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions D-28-01 through D-28-09 — locked decisions; verified against code (4 contradictions flagged in Landmines section)
- `.planning/phases/26-daily-voice-note-ritual/26-PATTERNS.md` — pattern map for Phase 26 work (re-applies to Phase 28)
- `.planning/phases/27-daily-wellbeing-snapshot/27-PATTERNS.md` — first-use callback_query / inline-keyboard pattern (NOT used by Phase 28 per locked text-reply contract)

### Tertiary (LOW confidence)
- None — all critical claims verified against codebase by direct file read.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in codebase, all patterns verified by file read
- Architecture: HIGH — every integration point verified by reading the actual file/lines
- Pitfalls: HIGH — 4 of 8 landmines surfaced via direct evidence of CONTEXT.md ≠ code

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days; codebase fast-moving; M009 active)

## RESEARCH COMPLETE
