# Phase 28: Skip-Tracking + Adjustment Dialogue — Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 14 (8 modify + 6 create)
**Analogs found:** 14 / 14 (100% coverage — Phase 28 is pure composition over Phase 25/26/27/29 substrate)

## File Classification

| New/Modified File | Wave | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/rituals/types.ts` | 28-01 | type / Zod schema | transform | (self — extend in place) | exact (own predecessor) |
| `src/rituals/voice-note.ts` | 28-01 | ritual handler | request-response + event-write | `src/rituals/wellbeing.ts:293-298` | exact |
| `src/rituals/wellbeing.ts` | 28-01 | ritual handler | event-driven | `src/rituals/wellbeing.ts:293-298` (own — verify only) | exact (no-op or minimal) |
| `src/rituals/weekly-review.ts` | 28-01 | ritual handler | request-response + event-write | `src/rituals/wellbeing.ts:293-298` | role-match |
| `src/rituals/skip-tracking.ts` (NEW) | 28-02 | service / projection | batch + event-replay | `src/decisions/lifecycle.ts:107-133` (decision_events replay precedent) + `src/proactive/state.ts:169-204` | role-match |
| `src/rituals/scheduler.ts` | 28-02 | scheduler / orchestrator | predicate-dispatch | `src/rituals/scheduler.ts:82-236` (own — extend) | exact (own predecessor) |
| `src/db/migrations/0010_adjustment_dialogue.sql` (NEW) | 28-03 | migration | DDL | `src/db/migrations/0007_daily_voice_note_seed.sql:19-23` (DEFAULT-then-DROP-DEFAULT for `prompt_text`) | exact |
| `src/db/schema.ts` | 28-03 | Drizzle TS schema | DDL mirror | `src/db/schema.ts:485-505` (`ritualPendingResponses`) — extend with `metadata` | exact |
| `src/rituals/adjustment-dialogue.ts` (NEW) | 28-03 + 28-04 | ritual handler + LLM caller | request-response + LLM-classify | `src/rituals/weekly-review.ts:263-285, 419-480, 517-652` (Haiku messages.parse + retry-cap-2 + fireWeeklyReview orchestrator) + `src/rituals/voice-note.ts:289-365` (fire side) + `src/rituals/voice-note.ts:179-230` (atomic-consume PP#5 deposit) | exact (Haiku) + exact (fire) + exact (consume) |
| `src/chris/engine.ts` | 28-03 + 28-04 | engine pre-processor | request-response | `src/chris/engine.ts:167-208` (PP#5 voice-note path — extend with `kind` switch) + `src/chris/refusal.ts:131-156` (refusal pre-check) | exact |
| `src/cron-registration.ts` | 28-03 | cron registration | event-driven | `src/cron-registration.ts:99-115` (21:00 ritual sweep registration) | exact |
| `src/rituals/__tests__/skip-tracking.integration.test.ts` (NEW) | 28-02 | integration test | test | `src/rituals/__tests__/wellbeing.test.ts:44-120` (real-DB harness + seed-fallback fixture) | exact |
| `src/rituals/__tests__/adjustment-dialogue.integration.test.ts` (NEW) | 28-03 | integration test | test (LLM-mocked) | `src/chris/__tests__/engine-pp5.test.ts:23-95` (cumulative `not.toHaveBeenCalled` invariant) + `src/rituals/__tests__/wellbeing.test.ts` | exact |
| `src/rituals/__tests__/refusal-pre-check.integration.test.ts` (NEW) | 28-04 | integration test | test (LLM-mocked) | `src/chris/__tests__/engine-pp5.test.ts:79-95` (HIT-path cumulative-not-called) | exact |

---

## Pattern Assignments

### `src/rituals/types.ts` (extend RitualFireOutcome union — Wave 28-01)

**Analog:** Self (Phase 25 → 26 → 27 incremental extension precedent)

**Current shape** (`src/rituals/types.ts:88-95`, 7-variant union — Phase 26 added `system_suppressed`):

```typescript
export type RitualFireOutcome =
  | 'fired'
  | 'caught_up'
  | 'muted'
  | 'race_lost'
  | 'in_dialogue'
  | 'config_invalid'
  | 'system_suppressed'; // ← Phase 26 VOICE-04 (Plan 26-03; D-26-06)
```

**Phase 28 final shape — 12 variants** (3 new + 2 carve-out homogenization per Landmine 3 in RESEARCH.md):

```typescript
export type RitualFireOutcome =
  | 'fired'
  | 'caught_up'
  | 'muted'
  | 'race_lost'
  | 'in_dialogue'
  | 'config_invalid'
  | 'system_suppressed'        // Phase 26 VOICE-04 (D-26-06)
  | 'wellbeing_completed'      // Phase 27 (homogenized in 28 — was free-form string only)
  | 'wellbeing_skipped'        // Phase 27 (homogenized in 28)
  | 'responded'                // Phase 28 — resets skip_count
  | 'window_missed'            // Phase 28 — emitted by ritualResponseWindowSweep
  | 'fired_no_response';       // Phase 28 — THE skip-counting outcome
```

**Companion exported const map** (mitigates Pitfall 4 string drift — RESEARCH.md):

```typescript
// Single source of truth for ritual_fire_events.outcome string writes.
// Ensures TS union and DB writes never diverge.
export const RITUAL_OUTCOME = {
  FIRED: 'fired',
  CAUGHT_UP: 'caught_up',
  MUTED: 'muted',
  RACE_LOST: 'race_lost',
  IN_DIALOGUE: 'in_dialogue',
  CONFIG_INVALID: 'config_invalid',
  SYSTEM_SUPPRESSED: 'system_suppressed',
  WELLBEING_COMPLETED: 'wellbeing_completed',
  WELLBEING_SKIPPED: 'wellbeing_skipped',
  RESPONDED: 'responded',
  WINDOW_MISSED: 'window_missed',
  FIRED_NO_RESPONSE: 'fired_no_response',
} as const satisfies Record<string, RitualFireOutcome>;
```

**RitualConfigSchema extension** (D-28-08 `adjustment_mute_until`; per RESEARCH Open Question 2 — no `schema_version` bump needed since strict-mode invariant unchanged):

Add as 9th `.optional()` field after line 50:
```typescript
adjustment_mute_until: z.string().datetime().nullable().optional(),
```

---

### `src/rituals/voice-note.ts` (add ritual_fire_events writes on fire + response paths — Wave 28-01)

**Analog:** `src/rituals/wellbeing.ts:293-298` (the ONLY current ritual_fire_events write site per RESEARCH Landmine 8).

**Current state (gap):** `fireVoiceNote` (`src/rituals/voice-note.ts:289-365`) sends Telegram + inserts pending row but writes ZERO `ritual_fire_events` rows. `recordRitualVoiceResponse` (lines 179-230) writes Pensieve + ritual_responses but ZERO `ritual_fire_events`.

**Pattern to copy** (`src/rituals/wellbeing.ts:293-298`):

```typescript
await db.insert(ritualFireEvents).values({
  ritualId: openRow.ritualId,
  firedAt: new Date(),
  outcome: RITUAL_OUTCOME.WELLBEING_COMPLETED, // homogenized via const map
  metadata: { fireRowId: openRow.id, snapshotDate: today },
});
```

**Phase 28 instrumentation points in voice-note.ts:**

1. **Fire-side (after STEP 3 pending-row insert at line 351):** emit `outcome: 'fired'`. Metadata: `{ promptIdx, prompt }`.
2. **Suppression-side (line 320, before `return 'system_suppressed'`):** emit `outcome: 'system_suppressed'`. Metadata: `{ reason: 'heavy_deposit_day', deposit_threshold: RITUAL_SUPPRESS_DEPOSIT_THRESHOLD }`.
3. **Response-side (in `recordRitualVoiceResponse` at line 227-228, after `db.insert(ritualResponses)`):** emit `outcome: 'responded'`. Metadata: `{ pendingResponseId: pending.id, pensieveEntryId: entry.id }`. Also: `UPDATE rituals SET skip_count = 0 WHERE id = pending.ritualId` (D-28-03 reset trigger).

**Imports to add to voice-note.ts** (line 32):
```typescript
import { ritualFireEvents } from '../db/schema.js';
import { RITUAL_OUTCOME } from './types.js';
```

---

### `src/rituals/wellbeing.ts` (verify existing writes; minimal change — Wave 28-01)

**Analog:** Self — already writes `ritual_fire_events` per `wellbeing.ts:293-298 + 335-340`.

**Phase 28 changes (minimal):**

1. Replace string literals `OUTCOME_COMPLETED = 'wellbeing_completed'` / `OUTCOME_SKIPPED = 'wellbeing_skipped'` (lines 65-67) with `RITUAL_OUTCOME.WELLBEING_COMPLETED` / `RITUAL_OUTCOME.WELLBEING_SKIPPED` const-map references.
2. **Verify fire-side write:** `fireWellbeing` (lines 106-159) does NOT currently write `ritual_fire_events` on the initial fire — only on completion/skip. **Add** a fire-side write after STEP 4 (line 156): `outcome: 'fired'`.
3. **Add `'responded'` outcome** in `completeSnapshot` (line 257-310) IF the design treats wellbeing completion as a full ritual response (homogenization with voice-note semantics). Discuss with planner: D-27 says `wellbeing_completed` is itself the responded-state, so a separate `'responded'` may be redundant. Recommendation: keep `wellbeing_completed` as the response signal; do NOT also emit `'responded'`.
4. Add `UPDATE rituals SET skip_count = 0 WHERE id = openRow.ritualId` in `completeSnapshot` (D-28-03 reset trigger).

---

### `src/rituals/weekly-review.ts` (add ritual_fire_events writes on fire path; deferred response writes — Wave 28-01)

**Analog:** `src/rituals/wellbeing.ts:293-298` (write pattern) + `src/rituals/weekly-review.ts:517-652` (existing fireWeeklyReview shape).

**Current state (gap):** `fireWeeklyReview` (`weekly-review.ts:517-652`) has no `ritual_fire_events` writes anywhere. The only audit happens via `ritual_responses.metadata` (line 596-602) and Pensieve.

**Phase 28 instrumentation points:**

1. **Fire-side success (after line 639 `bot.api.sendMessage`):** emit `outcome: 'fired'`. Metadata: `{ ritualResponseId: fireRow.id, isFallback: result.isFallback, weekStart: weekStartIso, weekEnd: weekEndIso }`.
2. **Sparse-data short-circuit (line 546-547, before `return 'fired'`):** emit `outcome: 'fired'` with metadata `{ reason: 'no_data_short_circuit' }`. Per D-28-02: weekly review with no substrate is still a 'fired' outcome — does NOT count as `fired_no_response` (the skip-counting outcome) because Greg saw no message and was not asked.
3. **NOTE: Weekly review has NO user-reply window** — `fireWeeklyReview` sets `respondedAt` to "system response time" (line 632, comment: "respondedAt here marks the system's response (Pensieve write completed), not Greg's textual reply"). So weekly review will NEVER emit `'responded'` or `'fired_no_response'` from the existing code path. Phase 28 may need to add a virtual-window mechanism for weekly review skip-tracking — RAISE TO PLANNER as an open question (RESEARCH OQ #5 cousin).

---

### `src/rituals/skip-tracking.ts` (NEW — Wave 28-02)

**Function exports:** `computeSkipCount(ritualId)`, `shouldFireAdjustmentDialogue(ritual)`, `hasReachedEvasiveTrigger(ritualId)`.

**Analog 1 — replay projection** (`src/decisions/lifecycle.ts:126-133`, M007 D004 precedent):

```typescript
// Source: src/decisions/lifecycle.ts:126-133 [VERIFIED file read]
// Pattern: append-only events table is the authority; projection rebuilt by replay.
await tx.insert(decisionEvents).values({
  decisionId: id,
  eventType: 'status_changed',
  fromStatus,
  toStatus,
  snapshot: snapshotForEvent(updated[0]!),
  actor,
});
```

**Analog 2 — KV projection helper shape** (`src/proactive/state.ts:169-204`):

```typescript
// Source: src/proactive/state.ts:169-176 [VERIFIED file read]
// Pattern for predicate that consults a denormalized counter:
export async function hasReachedRitualDailyCap(timezone: string): Promise<boolean> {
  const val = await getValue(RITUAL_DAILY_COUNT_KEY);
  if (val == null) return false;
  const { date, count } = val as { date: string; count: number };
  const todayKey = localDateKeyFor(timezone);
  if (date !== todayKey) return false;
  return count >= RITUAL_DAILY_CAP;
}
```

**Phase 28 `computeSkipCount(ritualId)` implementation pattern:**

```typescript
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { ritualFireEvents } from '../db/schema.js';

export async function computeSkipCount(ritualId: string): Promise<number> {
  // 1. Find most recent reset-event timestamp (responded OR adjustment_completed)
  //    to anchor the count baseline.
  const [lastReset] = await db
    .select({ firedAt: ritualFireEvents.firedAt })
    .from(ritualFireEvents)
    .where(and(
      eq(ritualFireEvents.ritualId, ritualId),
      // outcomes that reset the count:
      sql`${ritualFireEvents.outcome} IN ('responded', 'wellbeing_completed', 'adjustment_completed')`,
    ))
    .orderBy(desc(ritualFireEvents.firedAt))
    .limit(1);

  // 2. Count fired_no_response events since that anchor (or since beginning).
  const baseline = lastReset?.firedAt ?? new Date(0); // epoch if no reset
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(ritualFireEvents)
    .where(and(
      eq(ritualFireEvents.ritualId, ritualId),
      eq(ritualFireEvents.outcome, RITUAL_OUTCOME.FIRED_NO_RESPONSE),
      gte(ritualFireEvents.firedAt, baseline),
    ));
  return count;
}
```

**`shouldFireAdjustmentDialogue(ritual)` predicate signature:**

```typescript
export async function shouldFireAdjustmentDialogue(
  ritual: typeof rituals.$inferSelect,
): Promise<boolean> {
  const cfg = parseRitualConfig(ritual.config);
  // Per-ritual override; falls back to cadence default.
  const threshold = cfg.skip_threshold; // already 3 for daily, 2 for weekly per seeds
  // Also honor adjustment_mute_until (D-28-08 "not now" 7-day deferral)
  if (cfg.adjustment_mute_until && new Date(cfg.adjustment_mute_until) > new Date()) {
    return false;
  }
  return ritual.skipCount >= threshold;
}
```

**`hasReachedEvasiveTrigger(ritualId)` predicate:**

Pattern source — `src/proactive/state.ts:169-176` (rolling-window counter). Phase 28 query:
```sql
SELECT COUNT(*) FROM ritual_responses
WHERE ritual_id = $1
  AND metadata->>'kind' = 'adjustment_dialogue_response'
  AND metadata->>'classification' = 'evasive'
  AND created_at >= now() - interval '14 days'
```
Returns `count >= 2`.

---

### `src/rituals/scheduler.ts` (predicate injection in runRitualSweep — Wave 28-02)

**Analog:** Self (`src/rituals/scheduler.ts:82-236` is the existing runRitualSweep — extend in place).

**Existing dispatch order** (lines 82-236):
- STEP 0: channel-cap short-circuit (line 90)
- STEP 1: per-tick max-1 SQL fetch (line 99-104)
- STEP 2: parseRitualConfig (line 116)
- STEP 3: per-ritual `mute_until` check (line 120-135)
- STEP 4: catch-up ceiling (line 139-156)
- STEP 5: atomic fire (RIT-10) (line 161-176)
- STEP 6: dispatchRitualHandler (line 184)

**Phase 28 NEW steps to inject** (per RESEARCH §"Recommended runRitualSweep order"):

| Insert position | New step | Source |
|----------------|----------|--------|
| Before STEP 0 | **Auto-re-enable expired mutes** (D-28-07) — `SELECT id FROM rituals WHERE enabled = false AND (config->>'mute_until')::timestamptz <= now()`; for each, set enabled=true + clear mute_until + write `ritual_config_events` (`change_kind = 'auto_unpause'`) | NEW |
| Before STEP 0 | **Response window sweep** (Plan 28-01) — scan `ritual_pending_responses` for `expires_at < now() AND consumed_at IS NULL`, emit `window_missed` + `fired_no_response` events, increment `rituals.skip_count` | NEW |
| Between STEP 5 (atomic fire) and STEP 6 (dispatch) | **shouldFireAdjustmentDialogue predicate** — if true, dispatch `fireAdjustmentDialogue(ritual)` INSTEAD of standard handler | NEW (Wave 28-02) |

**Critical note:** The 1-minute confirmation sweep (D-28-06) is a SEPARATE narrow helper (`ritualConfirmationSweep`) — NOT bundled into runRitualSweep. RESEARCH Landmine 5 explicitly: "Phase 28 must add a NARROW NEW helper... that ONLY scans for expired confirmation pending rows."

---

### `src/db/migrations/0010_adjustment_dialogue.sql` (NEW — Wave 28-03)

**Analogs:**
- `src/db/migrations/0007_daily_voice_note_seed.sql:19-23` (DEFAULT-then-DROP-DEFAULT idiom for adding NOT NULL column to existing table)
- `src/db/migrations/0006_rituals_wellbeing.sql:78-86` (CREATE TABLE IF NOT EXISTS pattern + DO-block FK constraints at lines 88-107)

**Existing pattern** (`0007_daily_voice_note_seed.sql:19-23`):
```sql
-- DEFAULT-then-DROP-DEFAULT pattern for adding NOT NULL to existing table
ALTER TABLE "ritual_pending_responses"
  ADD COLUMN IF NOT EXISTS "prompt_text" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "ritual_pending_responses"
  ALTER COLUMN "prompt_text" DROP DEFAULT;
```

**Phase 28 migration 0010 contents** (per RESEARCH Landmine 2 — `metadata` column does NOT exist on ritual_pending_responses):

```sql
-- 0010_adjustment_dialogue.sql — Phase 28 (M009 v2.4) — adjustment dialogue substrate.
-- Adds metadata jsonb to ritual_pending_responses so PP#5 can dispatch by
-- metadata.kind ∈ {'adjustment_dialogue', 'adjustment_confirmation'}. Per RESEARCH
-- Landmine 2: column does NOT exist today (verified by grep -n "metadata" schema.ts
-- against ritualPendingResponses block at lines 485-505).
--
-- DEFAULT '{}'::jsonb avoids backfill ambiguity for existing voice-note rows
-- (zero on prod today; zero in dev fixtures). Mirrors Phase 26 prompt_text
-- DEFAULT-then-DROP-DEFAULT pattern (0007_daily_voice_note_seed.sql:19-23).
ALTER TABLE "ritual_pending_responses"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
-- NOTE: metadata is NULLABLE — PP#5 dispatch treats NULL as voice-note default
-- branch (RESEARCH Landmine 6). No DROP DEFAULT here.

-- Optional partial index for the 1-minute confirmation sweep (D-28-06).
-- Scoped to rows where expires_at <= now() AND consumed_at IS NULL AND
-- metadata->>'kind' = 'adjustment_confirmation' for cheap minute-scale scans.
CREATE INDEX IF NOT EXISTS "ritual_pending_responses_adjustment_confirmation_idx"
  ON "ritual_pending_responses" USING btree ("expires_at")
  WHERE "consumed_at" IS NULL AND "metadata"->>'kind' = 'adjustment_confirmation';
```

**drizzle-kit acceptance gate (per Phase 27 SUMMARY pattern referenced in Landmine notes):** Pure-DDL migration → `drizzle-kit generate` should detect the metadata column add. If drizzle-kit reports "No schema changes", manually clone `meta/0009_snapshot.json` to `meta/0010_snapshot.json` and re-chain `id`/`prevId` (mirrors Phase 27 0008 + Phase 29 0009 hand-cloned snapshot pattern).

**NO seed correction migration needed** — RESEARCH Landmine 4 confirms 0007/0008/0009 seeds already have correct `skip_threshold` values (3/3/2 = daily/daily/weekly). Plan 28-02's audit task converts to a documentation-only verification.

---

### `src/db/schema.ts` (mirror migration 0010 — Wave 28-03)

**Analog:** Self — extend `ritualPendingResponses` definition at lines 485-505.

**Current shape** (lines 485-505):
```typescript
export const ritualPendingResponses = pgTable(
  'ritual_pending_responses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    promptText: text('prompt_text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ritual_pending_responses_chat_id_active_idx')
      .on(table.chatId, table.expiresAt)
      .where(sql`${table.consumedAt} IS NULL`),
  ],
);
```

**Phase 28 add** (after line 494, before `createdAt`):
```typescript
metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
```

And in the index list, add (after line 503):
```typescript
index('ritual_pending_responses_adjustment_confirmation_idx')
  .on(table.expiresAt)
  .where(sql`${table.consumedAt} IS NULL AND ${table.metadata}->>'kind' = 'adjustment_confirmation'`),
```

---

### `src/rituals/adjustment-dialogue.ts` (NEW — Wave 28-03 + 28-04)

**Function exports:** `fireAdjustmentDialogue(ritual)`, `handleAdjustmentReply(pending, chatId, text)`, `handleConfirmationReply(pending, chatId, text)`, `confirmConfigPatch(patch, ritualId)`, `ritualConfirmationSweep()`, `autoReEnableExpiredMutes()`.

This file is the highest-LLM-surface plan in Phase 28. Patterns split into 5 sub-sections.

#### A. Fire-side (mirrors fireVoiceNote)

**Analog:** `src/rituals/voice-note.ts:289-365` (`fireVoiceNote`).

**Pattern to copy** (`src/rituals/voice-note.ts:339-351`):
```typescript
const chatId = BigInt(config.telegramAuthorizedUserId);
await bot.api.sendMessage(Number(chatId), prompt);

const firedAt = new Date();
const expiresAt = new Date(firedAt.getTime() + RESPONSE_WINDOW_HOURS * 3600 * 1000);
await db.insert(ritualPendingResponses).values({
  ritualId: ritual.id,
  chatId,
  firedAt,
  expiresAt,
  promptText: prompt,
  // Phase 28 NEW field:
  metadata: { kind: 'adjustment_dialogue', cadence: ritual.type, ritualName: ritual.name },
});
```

**Telegram message template** (per D-28-05): `"This [daily/weekly] [name] ritual isn't working — what should change? Reply with what to change, or 'no change' / 'drop it' if you'd prefer to keep skipping or stop entirely."`

#### B. Response side (mirrors recordRitualVoiceResponse atomic-consume)

**Analog:** `src/rituals/voice-note.ts:179-230` (`recordRitualVoiceResponse`).

**Atomic-consume pattern to copy** (`voice-note.ts:184-204` — verified):
```typescript
// VERIFIED file:line — copy this verbatim, replace return shape:
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
    metadata: ritualPendingResponses.metadata, // NEW for Phase 28
  });

if (!consumed || !consumed.consumedAt) {
  throw new StorageError('ritual.adjustment.race_lost');
}
```

#### C. M006 refusal pre-check (Wave 28-04 — load-bearing for SKIP-06)

**Analog:** `src/chris/refusal.ts:131-156` (`detectRefusal`).

**Function signature** (`refusal.ts:131`):
```typescript
export function detectRefusal(text: string): RefusalResult;

export type RefusalResult =
  | { isRefusal: false }
  | { isRefusal: true; topic: string; originalSentence: string };
```

**MUST be called BEFORE `anthropic.messages.parse`** (RESEARCH Pitfall 2 — load-bearing):
```typescript
import { detectRefusal } from '../chris/refusal.js';

export async function handleAdjustmentReply(pending, chatId, text) {
  // STEP 1 — atomic consume (mirrors voice-note.ts:184-204)
  const [consumed] = await db.update(...).returning({...});
  if (!consumed) throw new StorageError('ritual.adjustment.race_lost');

  // STEP 2 — M006 refusal pre-check (D-28-08, load-bearing for SKIP-06).
  // MUST run BEFORE Haiku call. Refusals NEVER reach Haiku, NEVER count as evasive.
  const refusalResult = detectRefusal(text);
  if (refusalResult.isRefusal) {
    // Route to refusal path: disable ritual, write ritual_config_events.
    await routeRefusal(pending.ritualId, refusalResult);
    return ''; // IN-02 silent-skip
  }

  // STEP 3 — Haiku 3-class classification (only on non-refusal text)
  const parsed = await classifyAdjustmentReply(text);
  // ... dispatch by parsed.classification
}
```

**Existing refusal phrases verified covered** (RESEARCH §Specific Ideas verified at refusal.ts:24-55):
- `drop it` (line 34) ✓
- `not now` (line 48 — standalone-only regex) ✓
- "stop" — variants covered via `arrête` / `прекрати` etc.

**Note:** `disable` is NOT in current EN_PATTERNS. Plan 28-04 should EITHER (a) add `disable` to refusal.ts EN_PATTERNS, OR (b) add an adjustment-specific refusal extension inside adjustment-dialogue.ts (preferred — keeps general refusal detector unchanged for non-adjustment contexts where "disable" might mean something else).

#### D. Haiku 3-class classification (Wave 28-03 — HIGH-LLM)

**Analog:** `src/rituals/weekly-review.ts:263-285` (`runStage2HaikuJudge`) — VERIFIED file read.

**Pattern to copy verbatim** (`weekly-review.ts:268-285`):
```typescript
const response = await anthropic.messages.parse({
  model: HAIKU_MODEL,
  max_tokens: 200,
  system: [{ type: 'text' as const, text: ADJUSTMENT_JUDGE_PROMPT }],
  messages: [{ role: 'user' as const, content: text }],
  output_config: {
    // SDK runtime requires zod/v4 schema; .d.ts surface types as v3.
    // Same cast pattern as weekly-review.ts:277.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(AdjustmentClassificationSchemaV4 as unknown as any),
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error('Adjustment dialogue: parsed_output is null');
}
const parsed = AdjustmentClassificationSchema.parse(response.parsed_output); // v3 re-validate
```

**v3+v4 dual schema** (mirrors `weekly-review.ts:131-160` + `:177-186`):
```typescript
import { z } from 'zod';
import * as zV4 from 'zod/v4';

// v3 (runtime contract; refines if needed for confidence-default-evasive)
export const AdjustmentClassificationSchema = z.object({
  classification: z.enum(['change_requested', 'no_change', 'evasive']),
  proposed_change: z.object({
    field: z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
    new_value: z.union([z.string(), z.number(), z.null()]),
  }).nullable(),
  confidence: z.number().min(0).max(1),
});

// v4 (SDK boundary; no refine)
export const AdjustmentClassificationSchemaV4 = zV4.object({
  classification: zV4.enum(['change_requested', 'no_change', 'evasive']),
  proposed_change: zV4.object({
    field: zV4.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
    new_value: zV4.union([zV4.string(), zV4.number(), zV4.null()]),
  }).nullable(),
  confidence: zV4.number().min(0).max(1),
});
```

**Confidence-defaulted-evasive** (per CONTEXT.md §Specific Ideas): if `parsed.confidence < 0.7`, override `classification = 'evasive'` (conservative — would rather over-trigger 30-day pause than under-trigger).

#### E. Confirmation sweep (Wave 28-03 — D-28-06)

**Analog:** Atomic-consume from `voice-note.ts:184-204` (above) + `runRitualSweep` STEP 1 SELECT pattern from `scheduler.ts:99-104`.

**Sweep helper signature:**
```typescript
export async function ritualConfirmationSweep(): Promise<void> {
  // SELECT expired adjustment_confirmation rows (D-28-06)
  const expired = await db
    .select()
    .from(ritualPendingResponses)
    .where(sql`
      ${ritualPendingResponses.consumedAt} IS NULL
      AND ${ritualPendingResponses.expiresAt} <= now()
      AND ${ritualPendingResponses.metadata}->>'kind' = 'adjustment_confirmation'
    `)
    .limit(10); // safety cap; in practice 0 or 1 per minute

  if (expired.length === 0) return; // hot path — sub-millisecond when nothing pending

  for (const row of expired) {
    // Atomic-consume per row (mirrors voice-note.ts:184-204)
    const [consumed] = await db.update(ritualPendingResponses)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(ritualPendingResponses.id, row.id),
        isNull(ritualPendingResponses.consumedAt),
      ))
      .returning();
    if (!consumed) continue; // race lost — peer (PP#5) consumed first

    // Apply patch + write ritual_config_events with actor='auto_apply_on_timeout'
    const proposedChange = (row.metadata as { proposed_change: ... }).proposed_change;
    await applyConfirmedPatch(row.ritualId, proposedChange, 'auto_apply_on_timeout');
  }
}
```

#### F. ritual_config_events writes (Wave 28-04 — D-28-09)

**Analog:** `src/decisions/lifecycle.ts:126-133` (decisionEvents insert pattern) + `src/db/schema.ts:471-477` (table shape).

**SCHEMA SHAPE** (verified — RESEARCH Landmine 1 — actual columns):
```typescript
export const ritualConfigEvents = pgTable('ritual_config_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
  actor: varchar('actor', { length: 32 }).notNull(),
  patch: jsonb('patch').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**CRITICAL — does NOT match CONTEXT.md D-28-09 description.** Per RESEARCH Landmine 1, use `actor='system'|'user'` (existing semantics) and put detail in `patch jsonb` envelope:

```typescript
// Phase 28 write pattern (envelope-in-patch — RESEARCH Landmine 1 resolution):
await db.insert(ritualConfigEvents).values({
  ritualId,
  actor: 'system', // OR 'user' — varchar(32) length-bounded
  patch: {
    change_kind: 'fire_at_change', // or 'auto_pause' / 'auto_unpause' / 'manual_disable' / 'patch_aborted' / 'auto_apply_on_timeout'
    old_value: previousFireAt,
    new_value: newFireAt,
    source: 'auto_apply_on_timeout', // or 'adjustment_dialogue_refusal' etc.
    source_metadata: { /* free-form */ },
  },
});
```

---

### `src/chris/engine.ts` (PP#5 dispatch by metadata.kind — Wave 28-03 + 28-04)

**Analog:** `src/chris/engine.ts:167-208` (existing PP#5 voice-note path).

**Existing shape** (verified — `engine.ts:167-208`):
```typescript
// ── PP#5: Ritual-response detection (M009 Phase 26 VOICE-01; per D-26-02) ─
const chatIdStrPP5 = chatId.toString();
const pending = await findActivePendingResponse(chatIdStrPP5, new Date());
if (pending) {
  try {
    const result = await recordRitualVoiceResponse(pending, chatId, text);
    logger.info({ pendingId: pending.id, ... }, 'chris.engine.pp5.hit');
    return ''; // IN-02 silent-skip
  } catch (depositErr) {
    if (depositErr instanceof Error && depositErr.message === 'ritual.pp5.race_lost') {
      return '';
    }
    // ... other-error fall-through
  }
}
```

**Phase 28 extension** (RESEARCH §Pattern 1 — single chokepoint, dispatch by metadata.kind):
```typescript
if (pending) {
  // NEW: dispatch by metadata.kind. Voice-note rows had no metadata pre-Phase-28
  // (column didn't exist). After migration 0010, rows default to '{}'::jsonb so
  // metadata->>'kind' returns NULL, falling through to voice-note path
  // (RESEARCH Landmine 6).
  const kind = (pending.metadata as { kind?: string } | null)?.kind;

  try {
    if (kind === 'adjustment_dialogue') {
      // Wave 28-03 + 28-04: refusal pre-check + Haiku classification
      await handleAdjustmentReply(pending, chatId, text);
      return ''; // IN-02 silent-skip — Pitfall 6 invariant preserved
    }
    if (kind === 'adjustment_confirmation') {
      // Wave 28-03: yes/no parse + apply or abort
      await handleConfirmationReply(pending, chatId, text);
      return '';
    }
    // Default branch — existing voice-note path (also handles kind === 'voice_note' if backfilled)
    const result = await recordRitualVoiceResponse(pending, chatId, text);
    return '';
  } catch (depositErr) {
    // ... existing race-loss + other-error handling preserved
  }
}
```

**Required imports** (engine.ts line 76):
```typescript
import { findActivePendingResponse, recordRitualVoiceResponse } from '../rituals/voice-note.js';
import { handleAdjustmentReply, handleConfirmationReply } from '../rituals/adjustment-dialogue.js';
```

**Pitfall 6 cumulative-not-called regression test required** — see Test Patterns below.

---

### `src/cron-registration.ts` (1-minute confirmation sweep — Wave 28-03)

**Analog:** `src/cron-registration.ts:99-115` (existing 21:00 ritual sweep).

**Existing pattern** (lines 100-115):
```typescript
cron.schedule(
  deps.config.ritualSweepCron,
  async () => {
    try {
      await deps.runRitualSweep();
    } catch (err) {
      logger.error({ err }, 'rituals.cron.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.ritual = 'registered';
```

**Phase 28 extension** — add a 4th cron AFTER the ritual sweep block (line 115):
```typescript
// Phase 28 D-28-06 — 1-minute confirmation sweep (every minute).
// Narrow helper (NOT runRitualSweep) per RESEARCH Landmine 5: ONLY scans for
// expired adjustment_confirmation pending rows. Sub-millisecond when no work.
cron.schedule(
  '* * * * *', // every minute (locked spec D-28-06)
  async () => {
    try {
      await deps.ritualConfirmationSweep();
    } catch (err) {
      logger.error({ err }, 'rituals.confirmation_sweep.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.ritualConfirmation = 'registered';
logger.info(
  { cron: '* * * * *', timezone: deps.config.proactiveTimezone },
  'rituals.confirmation_sweep.scheduled',
);
```

**RegisterCronsDeps interface extension** (line 29-42):
```typescript
export interface RegisterCronsDeps {
  // ... existing fields
  /** Phase 28 D-28-06 — 1-minute confirmation sweep handler. */
  ritualConfirmationSweep: () => Promise<void>;
}
```

**CronRegistrationStatus extension** (line 22-27):
```typescript
export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  ritualConfirmation: 'registered' | 'failed'; // NEW Phase 28
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
}
```

**Call-site update needed** (`src/index.ts:88-91` per grep result):
```typescript
cronStatus = registerCrons({
  config: ...,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep, // NEW Phase 28 — import from src/rituals/adjustment-dialogue.js
});
```

---

### Integration test patterns

#### `src/rituals/__tests__/skip-tracking.integration.test.ts` (NEW — Wave 28-02)

**Analog:** `src/rituals/__tests__/wellbeing.test.ts:44-120` (real-DB harness with seed-fallback fixture).

**Pattern to copy** — fixture lifecycle (`wellbeing.test.ts:88-120`):
```typescript
// Mock Telegram bot to avoid real network
const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }));
vi.mock('../../bot/bot.js', () => ({ bot: { api: { sendMessage: mockSendMessage } } }));

import { db, sql } from '../../db/connection.js';
import { rituals, ritualResponses, ritualFireEvents } from '../../db/schema.js';
import { fireWellbeing } from '../wellbeing.js';

const FIXTURE_NAME = 'daily_wellbeing'; // matches production seed (migration 0008)

beforeEach(async () => {
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({ message_id: 12345 });

  // FK order: child tables first
  await db.delete(ritualFireEvents);
  await db.delete(ritualResponses);

  // Use seeded ritual; fallback to inserted fixture if missing
  const [existing] = await db.select().from(rituals).where(eq(rituals.name, FIXTURE_NAME)).limit(1);
  if (!existing) {
    const [r] = await db.insert(rituals).values({ ... }).returning();
    testRitualId = r!.id;
  } else {
    testRitualId = existing.id;
  }
});
```

**Test cases per RESEARCH Wave 0 gap list:**
1. `system_suppressed` does NOT increment skip_count
2. `wellbeing_skipped` does NOT increment skip_count
3. `responded` outcome resets skip_count to 0
4. `computeSkipCount(ritualId)` matches `rituals.skip_count` denormalized column after replay
5. `shouldFireAdjustmentDialogue` returns false until `skip_count >= threshold` (3 daily, 2 weekly)

#### `src/rituals/__tests__/adjustment-dialogue.integration.test.ts` (NEW — Wave 28-03)

**Analog:** `src/chris/__tests__/engine-pp5.test.ts:23-95` (HIT-path cumulative-not-called pattern).

**Pattern to copy** — Anthropic mock + cumulative invariant (`engine-pp5.test.ts:30-41 + 79-95`):
```typescript
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockAnthropicCreate, parse: mockAnthropicParse } },
  HAIKU_MODEL: 'claude-haiku',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));
```

**Branch tests** (per RESEARCH §SC-2):
- Branch A (yes): mock `mockAnthropicParse.mockResolvedValueOnce({ parsed_output: { classification: 'change_requested', proposed_change: { field: 'fire_at', new_value: '19:30' }, confidence: 0.95 } })`. Inject "yes" via PP#5 → assert patch applied + ritual_config_events row.
- Branch B (no): inject "no" → assert patch NOT applied + ritual_config_events row with `patch.change_kind = 'patch_aborted'`.
- Branch C (timeout): `vi.setSystemTime(firedAt + 61_000)`, run `ritualConfirmationSweep()` → assert auto-apply + `actor = 'auto_apply_on_timeout'`.

#### `src/rituals/__tests__/refusal-pre-check.integration.test.ts` (NEW — Wave 28-04)

**Analog:** `src/chris/__tests__/engine-pp5.test.ts:79-95` (cumulative `mockAnthropicParse.not.toHaveBeenCalled()` pattern).

**Critical assertion** (mirrors `engine-pp5.test.ts:83`):
```typescript
afterAll(async () => {
  // LOAD-BEARING: refusal pre-check MUST short-circuit BEFORE Haiku call.
  // Mirror Pitfall 6 cumulative-not-called pattern from engine-pp5.test.ts:83.
  expect(mockAnthropicParse).not.toHaveBeenCalled();
  await cleanup();
});
```

Per RESEARCH §SC-4: insert adjustment-dialogue pending row, inject "drop it" reply, assert (a) `mockAnthropicParse.mock.calls.length === 0`, (b) `rituals.enabled = false`, (c) ritual_config_events row with `patch.change_kind = 'manual_disable'`. SECOND "drop it" 7 days later: assert ritual NOT auto-paused via evasive trigger (refusals don't write evasive markers).

---

## Shared Patterns

### Atomic UPDATE...RETURNING for state mutations
**Source:** `src/rituals/voice-note.ts:184-204` + `src/rituals/idempotency.ts:84-100` (RIT-10 precedent)
**Apply to:** `recordRitualVoiceResponse` extension (skip_count reset), `handleAdjustmentReply` (atomic-consume pending row), `handleConfirmationReply` (atomic-consume confirmation row), `confirmConfigPatch` (atomic apply)

```typescript
// VERIFIED at src/rituals/voice-note.ts:187-204
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
  throw new StorageError('ritual.pp5.race_lost'); // → engine PP#5 catches + returns ''
}
```

### jsonb_set for nested mutation (postgres-js string-binding workaround)
**Source:** `src/rituals/wellbeing.ts:148-150 + 228-233` — VERIFIED
**Apply to:** `applyConfirmedPatch` (when patching `rituals.config.fire_at` etc.), auto-pause/auto-unpause (`config.mute_until` mutation)

```typescript
// VERIFIED — src/rituals/wellbeing.ts:228-233
await db
  .update(ritualResponses) // OR rituals for config patches
  .set({
    metadata: sql`jsonb_set(coalesce(${ritualResponses.metadata}, '{}'::jsonb), ${path}, ${String(value)}::jsonb, true)`,
  })
  .where(eq(ritualResponses.id, openRow.id));
```
**postgres-js gotcha** (`wellbeing.ts:142-145` JSDoc): cannot bind JS number directly to jsonb param — cast `String(value) → ::jsonb` instead.

### Haiku messages.parse + zodOutputFormat (v3+v4 dual)
**Source:** `src/rituals/weekly-review.ts:263-285` — VERIFIED
**Apply to:** `classifyAdjustmentReply` (Haiku 3-class judge call)

[Pattern in §D above — pasted verbatim from `weekly-review.ts:268-285`.]

### M006 refusal pre-check (BEFORE LLM call)
**Source:** `src/chris/refusal.ts:131-156` (`detectRefusal`) — VERIFIED
**Apply to:** `handleAdjustmentReply` (Wave 28-04) — load-bearing for SKIP-06

```typescript
import { detectRefusal } from '../chris/refusal.js';

const refusalResult = detectRefusal(text);
if (refusalResult.isRefusal) {
  // route to refusal path; do NOT call Haiku
  // refusalResult.topic and refusalResult.originalSentence available for log
  return; // never reach Haiku → never count as evasive (SKIP-06 invariant)
}
// otherwise proceed to anthropic.messages.parse
```

### CRON-01 try/catch wrap pattern
**Source:** `src/cron-registration.ts:65-72 + 84-90 + 102-108 + 120-126` — VERIFIED
**Apply to:** Phase 28's new 1-minute `ritualConfirmationSweep` cron registration

```typescript
cron.schedule(
  '* * * * *',
  async () => {
    try {
      await deps.ritualConfirmationSweep();
    } catch (err) {
      // CRON-01 belt-and-suspenders: thrown handler must NOT crash node-cron timer
      logger.error({ err }, 'rituals.confirmation_sweep.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
```

### Append-only event-table replay projection (M007 D004 spirit)
**Source:** `src/decisions/lifecycle.ts:126-133` (decisionEvents insert in transaction with UPDATE) — VERIFIED
**Apply to:** `ritual_fire_events` writes — must be in SAME TRANSACTION as the `rituals.skip_count` UPDATE per D-28-03

```typescript
// Pattern source — src/decisions/lifecycle.ts:107-133:
return await db.transaction(async (tx) => {
  // 1. Atomic UPDATE on the projection table
  const updated = await tx.update(rituals)
    .set({ skipCount: sql`${rituals.skipCount} + 1` })
    .where(eq(rituals.id, ritualId))
    .returning();
  // 2. Append event in the SAME transaction
  await tx.insert(ritualFireEvents).values({
    ritualId,
    firedAt: new Date(),
    outcome: RITUAL_OUTCOME.FIRED_NO_RESPONSE,
    metadata: { /* fire-row context */ },
  });
});
```

### PP#5 short-circuit invariant (Pitfall 6 — load-bearing)
**Source:** `src/chris/engine.ts:167-208` + `src/chris/__tests__/engine-pp5.test.ts:83` (cumulative not-called)
**Apply to:** All Phase 28 PP#5 extension branches MUST `return ''` (IN-02 silent-skip). All Phase 28 integration tests MUST add a parallel `expect(mockAnthropicParse).not.toHaveBeenCalled()` cumulative-afterAll assertion to prove no LLM call leaks into the engine path.

---

## No Analog Found

None. Every Phase 28 file has at least a role-match analog in Phase 25/26/27/29 substrate.

**Specifically resolved gaps:**

| Concern | Resolution |
|---------|------------|
| `ritual_pending_responses.metadata` does not exist | Migration 0010 adds it (analog: `0007_daily_voice_note_seed.sql:19-23` DEFAULT-then-DROP-DEFAULT) |
| `ritual_config_events` schema mismatch with CONTEXT.md | Use envelope-in-`patch` jsonb (RESEARCH Landmine 1 resolution) |
| Skip-tracking projection has no analog | M007 `decision_events` replay precedent at `src/decisions/lifecycle.ts:107-133` |
| 1-minute cron has no analog | `cron-registration.ts:99-115` ritual sweep registration extends linearly |
| Adjustment dialogue handler has no analog | Composes 3 existing patterns: fireVoiceNote (fire-side) + recordRitualVoiceResponse (atomic-consume) + runStage2HaikuJudge (LLM call) |

---

## Wave Coverage Summary

| Wave | Plan | Pattern Count | Net New Code |
|------|------|---------------|--------------|
| 28-01 (substrate) | 1 plan | 4 patterns (types union extend, fire_events writes ×3) | ~150 LoC + tests |
| 28-02 (synthesis) | 1 plan | 3 patterns (computeSkipCount projection, shouldFireAdjustmentDialogue predicate, scheduler injection) | ~120 LoC + tests |
| 28-03 (HIGH-LLM) | 1 plan | 6 patterns (migration, schema, fire-side, atomic-consume, Haiku 3-class, confirmation sweep, cron registration, PP#5 extension) | ~250 LoC + tests |
| 28-04 (closing) | 1 plan | 3 patterns (refusal pre-check, hasReachedEvasiveTrigger, ritual_config_events writes) | ~80 LoC + tests |

**Total estimated new code:** ~600 LoC (matches CONTEXT.md D-28-01 estimate).

---

## Metadata

**Analog search scope:** `/home/claude/chris/src/rituals/`, `/home/claude/chris/src/chris/`, `/home/claude/chris/src/db/`, `/home/claude/chris/src/cron-registration.ts`, `/home/claude/chris/src/decisions/lifecycle.ts`, `/home/claude/chris/src/proactive/state.ts`
**Files scanned:** 14 source files + 4 migration files + 4 test files (8 read in full, 6 partial)
**Pattern extraction date:** 2026-04-29
**RESEARCH.md cross-checks honored:** Landmines 1 (config_events schema), 2 (metadata column), 3 (outcome string drift), 4 (seed audit no-op), 5 (cron isolation), 6 (PP#5 NULL-metadata fall-through), 7 (sycophancy LOW), 8 (response-side outcome split)
**Confidence:** HIGH — all cited file:line ranges verified by direct file read in this session.
