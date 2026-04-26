# Architecture Research — M009 Ritual Infrastructure + Daily Note + Weekly Review

**Domain:** M009 — Ritual Infrastructure + Daily Voice Note + Daily Wellbeing + Weekly Review
**Type:** Subsequent-milestone integration mapping (NOT greenfield ecosystem research)
**Researched:** 2026-04-26
**Confidence:** HIGH (direct codebase inspection of every named module)

---

## Section 0 — Reading-context summary

The existing architecture is well-described in `/home/claude/chris/.planning/codebase/ARCHITECTURE.md`. M009 work concentrates in **two new modules** plus **focused edits** to four existing modules. The integration surface is small. The hard architectural questions are sequencing of pre-processors in `engine.ts`, ownership of the firing cron, and whether the daily voice-note response routes through the engine at all.

**New modules introduced by M009:**

| Path | Role |
|------|------|
| `src/rituals/index.ts` | Barrel — public surface: `runRitualSweep`, `recordRitualResponse`, `RitualType`, `Ritual` |
| `src/rituals/types.ts` | `RitualType` enum, `RitualConfig` Zod v3 schema, internal types |
| `src/rituals/scheduler.ts` | `runRitualSweep()` — query rituals.next_run_at <= now, dispatch per-type handler, advance cadence |
| `src/rituals/cadence.ts` | `computeNextRunAt(ritual, lastFired)` — pure cadence math (daily/weekly/monthly/quarterly), DST-safe via Luxon |
| `src/rituals/voice-note.ts` | Daily voice note ritual handler (fire + response binding) |
| `src/rituals/wellbeing.ts` | Daily wellbeing snapshot handler (fire keyboard + callback parser) |
| `src/rituals/weekly-review.ts` | Weekly review handler (Sonnet generation + single-question enforcement) |
| `src/rituals/prompt-rotation.ts` | 6-prompt rotation state with no-consecutive-duplicates invariant |
| `src/rituals/skip-tracking.ts` | Skip detection + 3-strike adjustment dialogue |
| `src/rituals/__tests__/*` | Unit + integration tests (cadence math, rotation, skip tracking, wellbeing parser) |
| `src/rituals/__tests__/m009-fixture.test.ts` | The 14-day mock-clock + primed-fixture integration test (7 spec assertions) |

**Modified files:**

| Path | Edit |
|------|------|
| `src/db/schema.ts` | Add `rituals`, `wellbeing_snapshots`, `ritual_responses` tables; add `RITUAL_RESPONSE` to `epistemicTagEnum` |
| `src/db/migrations/0006_rituals.sql` | New migration |
| `src/proactive/triggers/types.ts` | Add `'ritual-fire'` to `triggerType` union |
| `src/proactive/sweep.ts` | Add ritual channel between accountability and reflective channels |
| `src/chris/engine.ts` | Add **PP#-1** (ritual-response detection) BEFORE PP#0 |
| `src/bot/bot.ts` | Register `bot.on('callback_query:data', handleRitualCallback)` for the wellbeing keyboard |
| `src/bot/handlers/` | New file: `ritual-callback.ts` |
| `src/index.ts` | NO new cron — ritual scheduler lives inside the existing proactive sweep cron (decision rationale Q6 below) |
| `scripts/test.sh` | Add `psql` line for `0006_rituals.sql` |
| `src/__tests__/fixtures/` | Add `m009-21days` fixture variant (or extend `m008-14days`) — Q8 below |

---

## Section 1 — `rituals` table: schema design and migration sequencing

### Migration number

**Migration `0006_rituals.sql`.** D034 locked migration `0005` for `episodic_summaries` and shipped it; the next slot is 0006. M009 ships a **single combined migration** for both `rituals` and `wellbeing_snapshots` (and `ritual_responses` — see below) — they are co-introduced and reverting M009 reverts both together. Splitting them into 0006/0007 buys nothing.

### Confirmed schema

```sql
CREATE TYPE ritual_type AS ENUM ('daily_voice_note', 'daily_wellbeing', 'weekly_review');
CREATE TYPE ritual_response_kind AS ENUM ('voice_note', 'wellbeing', 'weekly_observation');

CREATE TABLE rituals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            ritual_type NOT NULL,
  cadence         text NOT NULL,                    -- 'daily' | 'weekly' | 'monthly' | 'quarterly'
  enabled         boolean NOT NULL DEFAULT true,
  last_run_at     timestamptz,                      -- nullable; null until first fire
  next_run_at     timestamptz NOT NULL,             -- always UTC, never tz-anchored
  skip_count      integer NOT NULL DEFAULT 0
                   CHECK (skip_count >= 0),
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rituals_type_unique UNIQUE (type)      -- exactly one row per ritual type for single-user
);

CREATE INDEX rituals_next_run_at_idx
  ON rituals (next_run_at)
  WHERE enabled = true;                             -- partial index: sweep only reads enabled rows

CREATE TABLE wellbeing_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date   date NOT NULL,
  energy          smallint NOT NULL CHECK (energy   BETWEEN 1 AND 5),
  mood            smallint NOT NULL CHECK (mood     BETWEEN 1 AND 5),
  anxiety         smallint NOT NULL CHECK (anxiety  BETWEEN 1 AND 5),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wellbeing_snapshots_snapshot_date_unique UNIQUE (snapshot_date)  -- idempotent per day
);

CREATE INDEX wellbeing_snapshots_snapshot_date_idx
  ON wellbeing_snapshots (snapshot_date);          -- M010 monthly aggregation

CREATE TABLE ritual_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ritual_id       uuid NOT NULL REFERENCES rituals(id),
  fired_at        timestamptz NOT NULL,
  responded_at    timestamptz,                      -- nullable: null = skipped
  prompt_text     text NOT NULL,                    -- exact prompt sent (rotation memory)
  pensieve_entry_id uuid REFERENCES pensieve_entries(id),  -- voice note → Pensieve link
  metadata        jsonb,                            -- weekly: observation_id; wellbeing: snapshot_id
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ritual_responses_ritual_id_fired_at_idx
  ON ritual_responses (ritual_id, fired_at DESC);   -- skip-tracking + rotation memory
```

### Decision: separate `ritual_responses` table — YES

The question text raised whether wellbeing snapshots should double-write to Pensieve as a `WELLBEING` epistemic-tag entry. **Answer: no, but voice notes DO write to Pensieve.** The clean separation:

| Ritual | Where the data lives | Why |
|--------|----------------------|-----|
| Daily voice note | `pensieve_entries` (verbatim) + `ritual_responses` (fire/response link) | Voice-note text is **content**. Pensieve is authoritative (D004, D035). Tagged `RITUAL_RESPONSE` (new enum value, see below). |
| Daily wellbeing | `wellbeing_snapshots` (numeric) + `ritual_responses` (fire/response link) | Numeric scores are **metric data**, not narrative. Pensieve is the wrong store — D031 forbids dumping prose into the context window, and 3 integers as text would actively pollute retrieval. M010 monthly review reads `wellbeing_snapshots` directly. |
| Weekly review | `ritual_responses.metadata.observation_text` + Pensieve entry tagged `RITUAL_RESPONSE` | Observation persists for longitudinal "show me past weekly observations". Q5 below resolves this. |

### Decision: add `RITUAL_RESPONSE` to `epistemicTagEnum` — YES

Voice note responses are tagged `RITUAL_RESPONSE` (new enum value) so retrieval can filter them out of routine semantic search but include them when explicitly requested ("what have I been thinking about lately?"). The 12-existing-categories enum (`FACT`, `EMOTION`, `BELIEF`, `INTENTION`, `EXPERIENCE`, `PREFERENCE`, `RELATIONSHIP`, `DREAM`, `FEAR`, `VALUE`, `CONTRADICTION`, `OTHER`, `DECISION`) already has `DECISION` as the precedent for "ritual-system-generated tag". Following that precedent: `RITUAL_RESPONSE` joins as the 14th value.

The migration adds the enum value with `ALTER TYPE epistemic_tag ADD VALUE 'RITUAL_RESPONSE';`. PostgreSQL allows enum extension without `RECREATE` since pg11; it must run **outside a transaction block** in psql, but `drizzle-kit` and `scripts/test.sh`'s `psql -v ON_ERROR_STOP=1` invocation handles each statement sequentially without an explicit BEGIN, so this works.

### Column-by-column rationale

| Column | Type | Rationale |
|--------|------|-----------|
| `next_run_at` | `timestamptz` (UTC) | Always UTC. Cadence math computes the next fire instant in `config.proactiveTimezone` via Luxon, then `.toUTC()` for storage. Querying `WHERE next_run_at <= now()` is timezone-agnostic and correct across DST. |
| `last_run_at` | `timestamptz` nullable | Timestamp, not date. The skip-tracking logic ("3 consecutive skips") needs to know the last *fire* time, not the last calendar day; a Sunday weekly review fired at 19:00 Paris is a single tz-anchored instant. |
| `cadence` | `text` ('daily'/'weekly'/'monthly'/'quarterly') | Stored as text not enum because cadence is a property of the **schedule**, while `type` is a property of the **ritual**. M013 will add monthly + quarterly rituals; their cadences are 'monthly'/'quarterly'. Keeping cadence separate from type allows reuse. |
| `enabled` | `boolean` | Skip-tracking adjustment dialogue may temporarily disable a ritual. Soft-disable via flag, not delete (D004 spirit). |
| `skip_count` | `integer` (consecutive) | **Resets to 0 on any response.** The "3 consecutive skips" trigger reads this directly — no need to scan `ritual_responses` history at sweep time. |
| `config` | `jsonb` | See Zod shape below. |

### Decision: lock `config` jsonb shape with Zod NOW

Per the v2.2 lesson (Sonnet output schema drift), JSONB freedom causes downstream pain. Lock `RitualConfig` shape in `src/rituals/types.ts`:

```typescript
// src/rituals/types.ts
import { z } from 'zod';

export const RitualConfigSchema = z.object({
  // Time-of-day for firing (HH:mm in proactiveTimezone). Daily voice note: '21:00'; weekly: '19:00'
  fireTime: z.string().regex(/^\d{2}:\d{2}$/),
  // Day-of-week for weekly cadence (0=Sunday, 6=Saturday). Required for cadence='weekly'.
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  // Voice-note-specific: rotation state (last 2 prompt indices to enforce no-consecutive-duplicates)
  recentPromptIndices: z.array(z.number().int().min(0).max(5)).max(2).default([]),
  // Skip-tracking adjustment: when set, sweep skips firing until this instant.
  muteUntil: z.string().datetime().nullable().default(null),
  // Awaiting-response binding: voice-note response window (see Q3).
  awaitingResponse: z.object({
    fireRowId: z.string().uuid(),         // ritual_responses.id of the open prompt
    firedAt: z.string().datetime(),       // ISO timestamp
    expiresAt: z.string().datetime(),     // firedAt + RESPONSE_WINDOW_HOURS
  }).nullable().default(null),
});
export type RitualConfig = z.infer<typeof RitualConfigSchema>;
```

Use `RitualConfigSchema.parse(row.config)` at every read boundary. The Zod schema is the contract; jsonb is the storage.

---

## Section 2 — Proactive sweep extension: the ritual channel (NOT the 6th trigger)

### Critical reframing: ritual firing is a CHANNEL, not a trigger

The question framed ritual firing as "the 6th trigger". After tracing `runSweep`, the right model is **a third channel**, not a sixth trigger. Existing channels:

1. **ACCOUNTABILITY channel** (deadline trigger) — fires AWAITING_RESOLUTION prompts. Dual-channel separation pattern from M007 / D-05.
2. **REFLECTIVE channel** (silence + commitment + pattern + thread triggers, winner-take-all by priority)
3. **(NEW) RITUAL channel** — fires user-promised cadence prompts.

Why a channel, not a trigger:
- Triggers compete for one outbound message slot in a winner-take-all priority sort. Rituals do **not** compete with reflective sweeps — they are user-promised cadence, not opportunistic.
- The reflective channel has a daily cap (one message per day, `hasSentTodayReflective`). Rituals have **per-ritual** cadence and may legitimately produce multiple sends in one sweep tick (daily voice note **and** wellbeing snapshot fire together).
- Skip tracking is per-ritual; it has no analog in the reflective channel.
- The 5 existing triggers all share `PROACTIVE_SYSTEM_PROMPT` (Sonnet, generative). Rituals use **fixed prompts** (no Sonnet for voice-note delivery; only the weekly review uses Sonnet).

### Concrete edit to `src/proactive/sweep.ts`

Add a new section between the accountability channel (line ~94) and the escalation-scan section (line ~182), or — cleaner — between the escalation scan and the reflective channel (line ~338). Recommended placement: **after escalation, before reflective**, because both accountability and rituals are user-promised cadence and should fire together; reflective is opportunistic and runs last.

```typescript
// In src/proactive/sweep.ts after the escalation loop, before REFLECTIVE CHANNEL:

// ── RITUAL CHANNEL (M009) ──────────────────────────────────────────────
// Independent of the reflective daily cap. Each ritual has its own cadence;
// firing the daily voice note does NOT consume the reflective channel slot.
let ritualResults: RitualFireResult[] = [];
try {
  ritualResults = await runRitualSweep(); // src/rituals/scheduler.ts
} catch (err) {
  logger.error({ err }, 'proactive.sweep.ritual.error');
  // Per-ritual isolation lives inside runRitualSweep — this catch is the last-line
  // defence so a ritual-system bug does not block the reflective channel.
}
```

### `runRitualSweep` shape (`src/rituals/scheduler.ts`)

```typescript
export interface RitualFireResult {
  ritualId: string;
  type: RitualType;
  fired: boolean;
  skippedReason?: 'muted' | 'in_adjustment_dialogue' | 'config_invalid';
  error?: unknown;
}

export async function runRitualSweep(): Promise<RitualFireResult[]> {
  // 1. CHEAP SQL gate: WHERE enabled = true AND next_run_at <= now()
  //    Uses partial index `rituals_next_run_at_idx WHERE enabled = true`
  const due = await db
    .select()
    .from(rituals)
    .where(and(eq(rituals.enabled, true), lte(rituals.nextRunAt, new Date())))
    .orderBy(asc(rituals.nextRunAt));

  const results: RitualFireResult[] = [];
  for (const ritual of due) {
    try {
      // 2. Per-ritual try/catch — one ritual error must not starve the others
      //    (mirrors the WR-02 pattern in sweep.ts escalation loop)
      const cfg = RitualConfigSchema.parse(ritual.config);

      // 3. Per-ritual mute check (skip-tracking adjustment may have set this)
      if (cfg.muteUntil && new Date(cfg.muteUntil) > new Date()) {
        results.push({ ritualId: ritual.id, type: ritual.type, fired: false, skippedReason: 'muted' });
        continue;
      }

      // 4. Skip-strike check: 3 consecutive skips → adjustment dialogue, not standard prompt
      if (ritual.skipCount >= 3) {
        await fireAdjustmentDialogue(ritual);
        // Adjustment dialogue does NOT advance next_run_at — wait for Greg's response
        // (handled by PP#-1 in engine.ts).
        results.push({ ritualId: ritual.id, type: ritual.type, fired: true });
        continue;
      }

      // 5. Type-dispatch to handler
      switch (ritual.type) {
        case 'daily_voice_note':  await fireVoiceNote(ritual, cfg); break;
        case 'daily_wellbeing':    await fireWellbeing(ritual, cfg); break;
        case 'weekly_review':      await fireWeeklyReview(ritual, cfg); break;
      }

      // 6. Advance cadence
      const next = computeNextRunAt(ritual, new Date());
      await db.update(rituals)
        .set({ lastRunAt: new Date(), nextRunAt: next, updatedAt: new Date() })
        .where(eq(rituals.id, ritual.id));

      results.push({ ritualId: ritual.id, type: ritual.type, fired: true });
    } catch (err) {
      logger.error({ err, ritualId: ritual.id, type: ritual.type }, 'proactive.sweep.ritual.row.error');
      results.push({ ritualId: ritual.id, type: ritual.type, fired: false, error: err });
    }
  }
  return results;
}
```

**Key point on priority:** there is no priority sort. Rituals fire in `nextRunAt ASC` order. A daily voice note and a daily wellbeing snapshot can BOTH fire in a single tick — that is desired behavior, and the spec confirms it ("delivered alongside the daily voice note").

### Skip-tracking — how does Chris know Greg "skipped"?

**Answer:** No timer, no scan. Skip is detected at fire time, not at response time.

When `runRitualSweep` fires a ritual, it consults the most recent `ritual_responses` row for that `ritual_id`:
- If `responded_at IS NOT NULL` → previous response received → reset `skip_count = 0`
- If `responded_at IS NULL` AND prior fire's `expiresAt < now` → skipped → increment `skip_count`

Concretely, before firing a new prompt:

```typescript
async function checkPriorResponse(ritualId: string): Promise<'responded' | 'skipped' | 'first_fire'> {
  const [prior] = await db
    .select()
    .from(ritualResponses)
    .where(eq(ritualResponses.ritualId, ritualId))
    .orderBy(desc(ritualResponses.firedAt))
    .limit(1);
  if (!prior) return 'first_fire';
  if (prior.respondedAt) return 'responded';
  return 'skipped';  // fired but never responded
}
```

This is **fire-and-forget for the response itself**: the ritual scheduler does not wait. Greg's window to respond is bounded by `awaitingResponse.expiresAt` (default 18h for daily, 36h for weekly). If a new fire happens before that window expires AND the prior is unresponded, that's still a skip — the awaiting binding gets cleared and replaced with the new one.

### Channel: NEW `ritual_outreach` cap key in `proactive_state`?

**No — rituals do NOT need a global daily cap.** The existing reflective + accountability daily caps are heuristic safety nets to prevent the random sweep from spamming Greg. Rituals are user-promised: he asked for a daily voice note, he gets one daily.

What rituals need instead is **per-ritual idempotency**: a single sweep tick that runs twice (e.g., manual restart) must not double-fire. This is achieved by `last_run_at` + `next_run_at` advancement: after firing, `next_run_at` jumps forward by the cadence interval, so the next sweep's `WHERE next_run_at <= now()` query returns zero rows for that ritual. Idempotent without a separate cap.

---

## Section 3 — Daily voice note handler & the PP#-1 problem

### Module location

`src/rituals/voice-note.ts`. Lives in the new `src/rituals/` module, NOT in `src/proactive/triggers/`. Reasoning: triggers in `src/proactive/triggers/` follow the `TriggerDetector` interface and return `TriggerResult`; voice-note firing is **not a detector**, it is an **action** dispatched by the ritual scheduler.

### Fire-side: simple

```typescript
// src/rituals/voice-note.ts
const PROMPTS = [
  'What mattered today?',
  "What's still on your mind?",
  'What did today change?',
  'What surprised you today?',
  'What did you decide today, even if it was small?',
  'What did you avoid today?',
];
const RESPONSE_WINDOW_HOURS = 18;

export async function fireVoiceNote(ritual: Ritual, cfg: RitualConfig): Promise<void> {
  const promptIndex = chooseNextPromptIndex(cfg.recentPromptIndices);
  const prompt = PROMPTS[promptIndex]!;

  // 1. Insert ritual_responses row BEFORE sending (write-before-send, mirrors M007 D-28)
  const fireRow = await db.insert(ritualResponses).values({
    ritualId: ritual.id,
    firedAt: new Date(),
    promptText: prompt,
  }).returning();

  // 2. Update config: rotation state + awaiting binding
  const newCfg: RitualConfig = {
    ...cfg,
    recentPromptIndices: [promptIndex, ...cfg.recentPromptIndices].slice(0, 2),
    awaitingResponse: {
      fireRowId: fireRow[0]!.id,
      firedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + RESPONSE_WINDOW_HOURS * 3600_000).toISOString(),
    },
  };
  await db.update(rituals).set({ config: newCfg }).where(eq(rituals.id, ritual.id));

  // 3. Send via Telegram
  await bot.api.sendMessage(config.telegramAuthorizedUserId, prompt);
  // No saveMessage — the response (not the prompt) is what gets stored as a Pensieve entry
}
```

### Response-side: PP#-1 in the engine — the hardest question

**The problem:** Greg responds via Telegram with a free-text message. The existing `handleTextMessage` → `processMessage` pipeline runs JOURNAL by default. JOURNAL stores to Pensieve AND generates a Sonnet response. The spec says **Chris does NOT respond to voice notes** — and we want the response stored without any LLM round-trip.

**The resolution: PP#-1 — ritual-response detection, runs BEFORE PP#0.**

Pre-processor ordering in `src/chris/engine.ts:processMessage`:

| Order | Pre-processor | Source | Action |
|-------|---------------|--------|--------|
| **PP#-1 (NEW)** | Ritual-response detection | M009 | Check active `awaitingResponse` bindings; if found, write to Pensieve as `RITUAL_RESPONSE`, update `ritual_responses.respondedAt`, **return empty string** to suppress reply |
| PP#0 | Decision capture (active flow) | M007 | Routes AWAITING_RESOLUTION/POSTMORTEM/CAPTURING to handlers |
| PP#1 | Decision trigger detection | M007 | Detects "I've decided to..." opens capture |
| PP#2 | Mute intent | M004 | "quiet for a week" → setMuteUntil |
| PP#3 | Refusal | M006 | "don't talk about X" → addDeclinedTopic |
| PP#4 | Language detection | M006 | franc + stickiness |

**Why PP#-1 (BEFORE PP#0), not PP#0.5 or after:**

1. A ritual response can arrive WHILE a decision capture is open (Greg might respond to last night's voice note this morning, after starting a fresh decision capture an hour ago — though the open capture would be for an unrelated topic). The ritual binding is per-ritual, not per-chat-state, so it's orthogonal to PP#0's chat-state machine. The cleanest invariant: **if a ritual-response window is open, a free-text message inside that window IS the response** — even if a decision capture is also open. Decision capture stays alive (the user can resume it) and the ritual binding is consumed.

2. PP#0/PP#1 have heavy semantics (Haiku stakes classification, regex trigger phrases, abort-phrase detection). PP#-1 is one cheap SQL read — it should run first and short-circuit cleanly.

3. The "Chris does NOT respond" requirement maps directly to `processMessage` returning empty string, which triggers `handleTextMessage`'s silent-skip path (IN-02 in `src/bot/bot.ts`). This is the existing escape hatch.

### Concrete PP#-1 implementation

```typescript
// In src/chris/engine.ts:processMessage, BEFORE the PP#0 block (~line 165):

// ── PP#-1: Ritual-response detection (M009) ────────────────────────────
// Runs FIRST: if a ritual-response window is open, this message is the response.
// Writes to Pensieve as RITUAL_RESPONSE, updates ritual_responses.respondedAt,
// and returns empty string to suppress Chris's reply (deposit-only).
const ritualBinding = await findActiveRitualBinding(new Date());
if (ritualBinding) {
  await recordRitualResponse(ritualBinding, chatId, text);
  // saveMessage to conversations is intentionally SKIPPED — the response
  // belongs in Pensieve as authoritative, not in the conversation history.
  // (Mirrors how decision-capture skips conversation save for AWAITING_RESOLUTION.)
  return '';  // Triggers IN-02 silent-skip in handleTextMessage
}
```

`findActiveRitualBinding` queries:
```sql
SELECT id, type, config FROM rituals
WHERE enabled = true
  AND config ? 'awaitingResponse'
  AND (config->'awaitingResponse'->>'expiresAt')::timestamptz > $1  -- now
  AND config->'awaitingResponse' IS NOT NULL
LIMIT 1
```

`recordRitualResponse` does:
1. Type-dispatch on ritual.type (voice_note → Pensieve write; wellbeing → no-op for text since it uses callbacks; weekly_review → no-op for text since the user replies via callback or via free-text appended observation).
2. For voice notes: `storePensieveEntry(text, 'telegram', { epistemic_tag: 'RITUAL_RESPONSE', ritual_response_id: bindingRowId })` + fire-and-forget `embedAndStore` + `tagEntry` (override the auto-tagger by passing `RITUAL_RESPONSE` directly — the auto-tagger normally re-tags, so we need a code path that respects an explicit tag).
3. Update `ritual_responses.respondedAt = now()` and `ritual_responses.pensieve_entry_id = newEntryId`.
4. Clear the `awaitingResponse` binding in `rituals.config`.
5. Reset `rituals.skip_count = 0`.

**Tag override for the auto-tagger:** the existing `tagEntry` (in `src/pensieve/tagger.ts`) calls Haiku to classify. For ritual responses, we want to skip Haiku and force `RITUAL_RESPONSE`. Add a `metadata.preTagged: true` flag check in `tagEntry` early-return, or — cleaner — add an explicit `epistemicTag` parameter to `storePensieveEntry` that sets the tag directly without invoking Haiku.

### Interaction with existing PP#0 / PP#1 — explicit resolution

| Scenario | What happens |
|----------|--------------|
| Voice note sent at 21:00, Greg responds at 22:00 with no other state active | PP#-1 fires → Pensieve write → empty reply. Done. |
| Voice note sent at 21:00, Greg responds at 22:00 with "I've decided to quit my job" | PP#-1 fires (the ritual binding wins). The decision-trigger phrase is **not detected** because PP#-1 returns before PP#1. **Trade-off accepted:** if Greg wants to capture a decision, he sends it as a separate message. The ritual response is the higher-priority interpretation when the ritual window is open. |
| Decision capture in progress (PP#0 active), voice note also fired | PP#-1 still wins. The decision capture state stays alive (we don't `clearCapture`); Greg's next message resumes capture if no new ritual fires in between. |
| Voice note window expired (>18h since fire), Greg responds | PP#-1 finds no active binding → falls through to PP#0/PP#1/normal engine. Chris responds normally as JOURNAL. The ritual is treated as skipped at the next sweep tick. |

### Epistemic tag

`RITUAL_RESPONSE` — new value added to `epistemicTagEnum` in migration 0006. Distinguishes ritual deposits from organic thoughts so retrieval can choose to include or exclude them (M013 monthly review may want to weight them differently). The 12 existing tags don't fit cleanly: `EXPERIENCE` is too generic, `INTENTION` already means "I plan to do X" (M004 commitment trigger).

---

## Section 4 — Daily wellbeing snapshot handler & the callback_query architecture

### First-time use of inline keyboards in this codebase

**Confirmed via grep: zero existing usage of `callback_query`, `inline_keyboard`, or `reply_markup` in `src/`.** This is a new Grammy idiom for the project. Source: [grammY InlineKeyboard reference](https://grammy.dev/ref/core/inlinekeyboard).

### Module location

`src/rituals/wellbeing.ts` (fire side) + `src/bot/handlers/ritual-callback.ts` (callback handler).

### Fire side: build and send

```typescript
// src/rituals/wellbeing.ts
import { InlineKeyboard } from 'grammy';

export async function fireWellbeing(ritual: Ritual, cfg: RitualConfig): Promise<void> {
  const fireRow = await db.insert(ritualResponses).values({
    ritualId: ritual.id,
    firedAt: new Date(),
    promptText: 'wellbeing-snapshot',
  }).returning();
  const fireRowId = fireRow[0]!.id;

  // Encode partial state in callback_data: 'wb|<fireRowId>|<dim>|<value>'
  const kb = new InlineKeyboard();
  kb.text('Energy 1', `wb|${fireRowId}|e|1`).text('2', `wb|${fireRowId}|e|2`).text('3', `wb|${fireRowId}|e|3`).text('4', `wb|${fireRowId}|e|4`).text('5', `wb|${fireRowId}|e|5`).row();
  kb.text('Mood 1',   `wb|${fireRowId}|m|1`).text('2', `wb|${fireRowId}|m|2`).text('3', `wb|${fireRowId}|m|3`).text('4', `wb|${fireRowId}|m|4`).text('5', `wb|${fireRowId}|m|5`).row();
  kb.text('Anxiety 1', `wb|${fireRowId}|a|1`).text('2', `wb|${fireRowId}|a|2`).text('3', `wb|${fireRowId}|a|3`).text('4', `wb|${fireRowId}|a|4`).text('5', `wb|${fireRowId}|a|5`).row();
  kb.text('Skip',      `wb|${fireRowId}|skip|0`);

  const msg = await bot.api.sendMessage(config.telegramAuthorizedUserId,
    'Wellbeing snapshot — tap energy, mood, anxiety:', { reply_markup: kb });

  // Bind: track which message ID hosts this keyboard so we can edit it on each tap
  await db.update(ritualResponses)
    .set({ metadata: { messageId: msg.message_id, partial: {} } })
    .where(eq(ritualResponses.id, fireRowId));
}
```

### Callback handler

Register in `src/bot/bot.ts` (alongside the existing `bot.on('message:text', ...)`):

```typescript
// src/bot/bot.ts
import { handleRitualCallback } from './handlers/ritual-callback.js';
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith('wb|')) await handleRitualCallback(ctx);
  else { await ctx.answerCallbackQuery(); }  // unknown payload — silent ack
});
```

### Decision: where does partial state live?

**Answer: in `ritual_responses.metadata` jsonb, NOT in the callback_data string and NOT in `proactive_state`.**

| Option | Trade-off |
|--------|-----------|
| Encode full state in `callback_data` (e.g. `wb|fireRowId|e=4&m=3&a=2`) | Fails: Telegram limits `callback_data` to 64 bytes. Three numbers fit, but the encoding becomes baroque. |
| Store in `proactive_state` table (key-value) | Works, but pollutes the proactive_state namespace which is currently focused on cron-anchored last-sent timestamps + escalation tracking. Wrong table for "partial form data". |
| Store in `ritual_responses.metadata` (CHOSEN) | Already exists for this purpose. The fire row is the single source of truth for one ritual fire's lifecycle (fire → partial answers → completion). FK from metadata back to fire row is implicit (it's the same row). |

### Handler logic

```typescript
// src/bot/handlers/ritual-callback.ts
export async function handleRitualCallback(ctx: Context): Promise<void> {
  const [, fireRowId, dim, valStr] = ctx.callbackQuery.data.split('|');
  const value = Number(valStr);

  if (dim === 'skip') {
    // OPTIONAL skip per spec — no adjustment dialogue trigger (RIT-06: optional skip allowed)
    await db.update(ritualResponses)
      .set({ respondedAt: new Date(), metadata: { skipped: true } })
      .where(eq(ritualResponses.id, fireRowId));
    // Note: do NOT increment skip_count (spec: "without triggering adjustment dialogue").
    // This is wellbeing-specific. Voice note skips DO increment (Q3).
    await ctx.editMessageText('Skipped wellbeing snapshot.');
    await ctx.answerCallbackQuery();
    return;
  }

  // Fetch current partial state
  const [row] = await db.select().from(ritualResponses).where(eq(ritualResponses.id, fireRowId)).limit(1);
  const partial = (row?.metadata as { partial?: { e?: number; m?: number; a?: number } })?.partial ?? {};
  partial[dim as 'e' | 'm' | 'a'] = value;

  // Persist partial
  await db.update(ritualResponses).set({ metadata: { ...row!.metadata, partial } }).where(eq(ritualResponses.id, fireRowId));

  // Complete?
  if (partial.e !== undefined && partial.m !== undefined && partial.a !== undefined) {
    const today = formatLocalDate(new Date(), config.proactiveTimezone);
    await db.insert(wellbeingSnapshots).values({
      snapshotDate: today,
      energy: partial.e, mood: partial.m, anxiety: partial.a,
    }).onConflictDoNothing();  // UNIQUE(snapshot_date) idempotency

    await db.update(ritualResponses)
      .set({ respondedAt: new Date(), metadata: { ...row!.metadata, snapshotComplete: true } })
      .where(eq(ritualResponses.id, fireRowId));

    // Reset skip_count on completion
    await db.update(rituals).set({ skipCount: 0 })
      .where(eq(rituals.id, row!.ritualId));

    await ctx.editMessageText(`Logged: energy ${partial.e}, mood ${partial.m}, anxiety ${partial.a}.`);
  } else {
    // Update keyboard to show progress
    await ctx.editMessageText(`Wellbeing — ${formatPartial(partial)}`, {
      reply_markup: rebuildKeyboard(fireRowId, partial),
    });
  }
  await ctx.answerCallbackQuery();
}
```

---

## Section 5 — Weekly review handler

### Module location

`src/rituals/weekly-review.ts`. Reads via:
- `getEpisodicSummariesRange(weekStart, weekEnd)` — already exported, zero current consumers (per STATE.md "M009 weekly review will pick it up"). M009 is the first consumer. Confirmed via grep.
- M007 resolved decisions for the week — direct query against `decisions WHERE resolved_at BETWEEN $start AND $end`.

### Sonnet call shape

```typescript
// src/rituals/weekly-review.ts
async function fireWeeklyReview(ritual: Ritual, cfg: RitualConfig): Promise<void> {
  // Compute week boundary in proactiveTimezone
  const now = DateTime.now().setZone(config.proactiveTimezone);
  const weekStart = now.minus({ days: 7 }).startOf('day').toJSDate();
  const weekEnd = now.endOf('day').toJSDate();

  // Pull substrate
  const summaries = await getEpisodicSummariesRange(weekStart, weekEnd);
  const resolvedDecisions = await db.select().from(decisions)
    .where(and(
      eq(decisions.status, 'resolved'),
      gte(decisions.resolvedAt, weekStart),
      lte(decisions.resolvedAt, weekEnd),
    ));

  // Sparse-data guard (mirrors CONS-02 entry-count gate)
  if (summaries.length === 0 && resolvedDecisions.length === 0) {
    logger.info({ weekStart, weekEnd }, 'rituals.weekly.skipped.no_data');
    return;
  }

  // Generate via Sonnet with constitutional preamble + single-question schema
  const observation = await generateWeeklyObservation(summaries, resolvedDecisions);

  // Persist BEFORE sending (write-before-send pattern from M007 D-28)
  const fireRow = await db.insert(ritualResponses).values({
    ritualId: ritual.id,
    firedAt: new Date(),
    promptText: observation.text,
    metadata: { observationText: observation.text, weekStart, weekEnd },
  }).returning();

  // Persist as Pensieve entry too (longitudinal recall)
  await storePensieveEntry(observation.text, 'telegram',
    { epistemic_tag: 'RITUAL_RESPONSE', ritual_response_id: fireRow[0]!.id, kind: 'weekly_review' });

  await bot.api.sendMessage(config.telegramAuthorizedUserId, observation.text);
}
```

### Single-question enforcement

**Decision: Zod schema with refinement + retry-once, fall back to TRUNCATE.**

```typescript
// src/rituals/weekly-review.ts
import * as zV4 from 'zod/v4';

const WeeklyReviewSchema = zV4.object({
  observation: zV4.string().min(20).max(800),
  question: zV4.string().min(5).max(300)
    .refine((s) => (s.match(/\?/g) ?? []).length === 1, 'must contain exactly one question mark'),
});

async function generateWeeklyObservation(summaries: Summary[], decisions: Decision[]) {
  const systemPrompt = buildSystemPrompt('REFLECT') + '\n\n' + WEEKLY_REVIEW_PROMPT;
  const userContext = formatWeekContext(summaries, decisions);

  // Retry once if Zod validation fails (matches consolidate.ts retry-once pattern)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await anthropic.messages.parse({
        model: SONNET_MODEL,
        max_tokens: 800,
        system: [{ type: 'text', text: systemPrompt }],
        messages: [{ role: 'user', content: userContext }],
        response_format: zodOutputFormat(WeeklyReviewSchema, 'weekly_review'),
      });
      return { text: `${result.observation}\n\n${result.question}` };
    } catch (err) {
      if (attempt === 0) {
        logger.warn({ err }, 'rituals.weekly.parse.retry');
        continue;
      }
      throw err;
    }
  }
  throw new LLMError('weekly_review_parse_failed_twice');
}
```

The Zod refinement is the runtime gate. Combined with the `parse` SDK helper that retries on validation failure (matches `consolidate.ts` retry-once pattern), the multi-question failure mode is contained to one extra LLM call, then bubbles up. **No silent-truncate fallback** — silently dropping a malformed weekly review is worse than skipping the week and logging an alert (CONS-12 pattern).

### Does the observation become a Pensieve entry?

**Yes. Tagged `RITUAL_RESPONSE` with `metadata.kind = 'weekly_review'`.** Rationale:

- Longitudinal recall: "Show me the last 4 weekly observations" → grep on `epistemic_tag = 'RITUAL_RESPONSE' AND metadata->>'kind' = 'weekly_review'`
- Embedded into pgvector for semantic recall (the spec implies these should be retrievable)
- Boundary-audit consideration: D035 forbids episodic_summaries text from entering Pensieve. Weekly observations are NOT episodic summary text — they are Sonnet-generated commentary ON the summaries. So the boundary holds.

The `ritual_responses` row is the **operational** record (was-the-prompt-fired, was-it-completed); the Pensieve entry is the **content** record (what was said).

---

## Section 6 — Cron strategy: ONE recommendation

**Recommendation: SHARE the existing 10:00 proactive sweep cron — but tighten the cadence model.**

### Three options analyzed

| Option | Pros | Cons |
|--------|------|------|
| (a) Per-ritual `cron.schedule()` (one cron per row) | Most flexible per-ritual timing | Fragile: dynamic crons for DB-driven schedules, hard to test, no idempotency story across restarts, bloats `src/index.ts` |
| (b) Single high-frequency cron (every hour) checking `next_run_at` | Cleanest separation, predictable, idempotent | Adds a new cron peer + new schedule env var; 24× more sweep ticks per day; battery + Telegram rate ceiling concerns are nil for single-user but feels heavy |
| **(c) Reuse existing 10:00 sweep, add a SECOND 21:00 (evening) tick — chosen** | Reuses proven plumbing; respects D-05 dual-channel separation; matches user reality (morning sweep + evening rituals); zero new cron infrastructure | Slightly less generic than option (b); two cron schedules to manage instead of one |

### Why (c) wins

The morning 10:00 sweep already exists for accountability + reflective triggers. **Add a second `cron.schedule()` registration in `src/index.ts` at 21:00 Europe/Paris** with the same handler (`runSweep`). The handler is idempotent — if a 10:00 tick already fired the daily voice note, the 21:00 tick's `WHERE next_run_at <= now()` query returns nothing because the morning fire advanced `next_run_at` to tomorrow.

This solves:
- **Voice note must fire at end of day** (spec: "end of John's day"): the 21:00 tick handles it
- **Wellbeing snapshot fires alongside voice note**: same 21:00 tick
- **Weekly review fires Sunday evening**: the Sunday 21:00 tick checks if today is the weekly fire day; if so, runs it
- **Accountability + reflective sweeps stay at 10:00**: unchanged behavior, no regression risk
- **Idempotency**: the same `next_run_at <= now()` SQL gate works regardless of how many ticks per day

### Concrete `src/index.ts` edit

```typescript
// In src/index.ts main(), AFTER the existing proactive cron registration:

// Second proactive sweep tick at 21:00 — primarily for ritual firing.
// Same handler as the 10:00 tick; rituals are gated by next_run_at, accountability +
// reflective channels are gated by their daily caps, so duplicate-firing is impossible.
cron.schedule(config.ritualSweepCron, async () => {
  try { await runSweep(); }
  catch (err) { logger.error({ err }, 'proactive.cron.evening.error'); }
}, { timezone: config.proactiveTimezone });
```

Add to `src/config.ts`:
```typescript
ritualSweepCron: process.env.RITUAL_SWEEP_CRON || '0 21 * * *',
```

**Per-ritual `fireTime` in config.fireTime** is informational only — it sets when `computeNextRunAt` advances `next_run_at` to (e.g., next day at 21:00). The cron itself is fixed. If a ritual's `fireTime` is 21:00 and the cron runs at 21:00 daily, the SQL gate fires it. If a future ritual wants 09:00 firing, the morning 10:00 tick catches it.

---

## Section 7 — Build order recommendation

Carry-ins must land first to unblock everything else. The substantive work then sequences from data → infrastructure → handlers → integration → tests.

| Phase | Scope | Why this ordering | Files touched | Lines (est) |
|-------|-------|-------------------|---------------|-------------|
| **25** | Carry-in: gsd-verifier wiring + SUMMARY.md frontmatter template | Process gate — every subsequent phase needs this. Tiny, self-contained. | `.gsd-skills/`, template files | <100 |
| **26** | Carry-in: HARN-03 fixture refresh (`--target-days 21`) | Data substrate for the M009 14-day fixture test must exist before tests can run. Operator UAT. | `scripts/regenerate-primed.ts` invocation; new fixture under `tests/fixtures/primed/` | 0 code |
| **27** | Migration 0006 + Drizzle schema + Zod RitualConfig + skeleton `src/rituals/` directory | Schema must land first so all subsequent code compiles against typed tables. Add `RITUAL_RESPONSE` enum value. Empty placeholder files for `scheduler.ts`, `voice-note.ts`, `wellbeing.ts`, `weekly-review.ts`. | `src/db/schema.ts`, `src/db/migrations/0006_rituals.sql`, `src/rituals/types.ts`, `scripts/test.sh` | ~250 |
| **28** | `src/rituals/cadence.ts` + `src/rituals/scheduler.ts` (no handlers yet) + cron registration in `src/index.ts` + ritual_outreach channel skeleton in `src/proactive/sweep.ts` | Infrastructure phase. `runRitualSweep` exists but dispatches to `throw new Error('not implemented')` per ritual type. Cron fires; nothing runs. Tests cover cadence math only. | `src/rituals/cadence.ts`, `src/rituals/scheduler.ts`, `src/rituals/__tests__/cadence.test.ts`, `src/index.ts`, `src/proactive/sweep.ts`, `src/config.ts` | ~400 |
| **29** | Daily voice note handler + PP#-1 in engine.ts + `RITUAL_RESPONSE` tag override in tagger | Voice note is the first real ritual. PP#-1 is the highest-risk integration point (engine pre-processor ordering). Ship + UAT first because every subsequent ritual depends on this binding mechanism. | `src/rituals/voice-note.ts`, `src/rituals/prompt-rotation.ts`, `src/chris/engine.ts`, `src/pensieve/store.ts`/`tagger.ts`, `src/rituals/__tests__/voice-note.test.ts` | ~400 |
| **30** | Daily wellbeing snapshot + callback_query handler + `wellbeing_snapshots` writes | First use of inline keyboards in the project. Self-contained — does not interact with PP#-1 (callbacks bypass `processMessage` entirely). M010 needs `wellbeing_snapshots` populated to start producing data, so this lands before weekly review. | `src/rituals/wellbeing.ts`, `src/bot/handlers/ritual-callback.ts`, `src/bot/bot.ts`, `src/rituals/__tests__/wellbeing.test.ts` | ~350 |
| **31** | Weekly review handler + Sonnet call with single-question Zod refinement + Pensieve persistence | Only depends on episodic summaries (M008) and resolved decisions (M007) — both exist. Skip-tracking adjustment dialogue lands here too (cross-cuts all rituals but the trigger is at sweep time). | `src/rituals/weekly-review.ts`, `src/rituals/skip-tracking.ts`, `src/llm/prompts.ts` (add WEEKLY_REVIEW_PROMPT), `src/rituals/__tests__/weekly-review.test.ts` + skip-tracking test | ~450 |
| **32** | 14-day primed-fixture integration test (the 7 spec assertions) + live-LLM weekly-review test (TEST-23 equivalent, 3-of-3) + end-to-end UAT | Integration phase. Loads `m009-21days` fixture, simulates 14 days via `vi.setSystemTime`, asserts all 7 spec behaviors. Live test against real Sonnet for the single-question constraint. | `src/rituals/__tests__/m009-fixture.test.ts`, `src/rituals/__tests__/live-weekly-review.test.ts`, fixture extensions in `src/__tests__/fixtures/` | ~600 |

**Phase size discipline:** each phase ships ≤ ~600 LOC + tests. Phases 27–32 each have a clean acceptance criterion and a single-purpose deliverable. No phase combines schema + handlers + tests — the lessons from v2.2 Phase 22.1 (decimal-phase gap closure) and v2.3 Phase 24 (audit-trail gaps) are explicit in the recommendation.

**Why wellbeing (30) before weekly review (31):** M010 needs real wellbeing data to start producing. If wellbeing lands in Phase 30 and Greg uses it for the M009→M010 pause window (the spec's "1 month of real daily use", though D041 means M010 will primed-fixture validate), there's a month of real numeric series to validate against. Weekly review only generates 4–5 observations during the same month — much less data signal for M010 work.

**Why PP#-1 in Phase 29 (with voice note), not earlier or later:** PP#-1 is logically separable from the voice note handler, but in practice they need each other to test end-to-end. Splitting them into "PP#-1 phase" then "voice note phase" creates an orphan-code phase (PP#-1 with no consumer). Combining them gives a single deliverable: the daily voice note works end-to-end.

---

## Section 8 — Test architecture

### Fixture variant: extend `m008-14days` OR create `m009-21days`?

**Recommendation: NEW `m009-21days` fixture.**

Reasoning:
- M008's `m008-14days` is locked as the validation substrate for episodic consolidation. Modifying it risks regressing M008 tests.
- M009's 14-day mock-clock simulation needs ~21 days of real prior history (so the silence trigger and weekly review have prior context — the simulation is "14 days of NEW activity on top of an organic base").
- The primed-fixture pipeline (`scripts/regenerate-primed.ts --milestone m009 --target-days 21`) is designed for exactly this: each milestone gets its own variant.
- HARN-03 sanity gate currently asserts ≥7 summaries / ≥200 entries. With 21 days of fresh organic + delta, both thresholds clear comfortably.

### Mock clock: `vi.setSystemTime` day-by-day, not week-step

`vi.setSystemTime(new Date('2026-04-01T21:00:00+02:00'))` — start at evening of day 1. Then loop:

```typescript
for (let day = 0; day < 14; day++) {
  vi.setSystemTime(new Date(`2026-04-${String(day + 1).padStart(2, '0')}T21:00:00+02:00`));
  await runRitualSweep();
  // Simulate Greg's response ~75% of days for the daily voice note
  if (day % 4 !== 3) {  // skip every 4th day to test skip-strike
    await processMessage(CHAT_ID, 99999, `Day ${day} voice note response`);
  }
  // Wellbeing snapshot via direct callback simulation (bypass Telegram)
  await handleRitualCallback(buildMockCallback(`wb|${fireRowId}|e|3`));
  // ...
}
```

**Day-by-day**, not week-step, because:
- Skip tracking needs to verify increment per missed day (assertion 3)
- Adjustment dialogue triggers after 3 *consecutive* skips (assertion 4) — needs 3 distinct day boundaries
- Weekly review triggers on a specific day-of-week (assertion 6) — needs the loop to cross a Sunday

**`vi.setSystemTime` ONLY, NEVER `vi.useFakeTimers`** — D-02 rule from `TESTING.md`. postgres.js connection keep-alive timers must continue to run.

### Test type per spec assertion

| # | Spec assertion | Test type | Why |
|---|----------------|-----------|-----|
| 1 | Daily prompts fire on schedule with correct rotation (no consecutive duplicates) | Integration (mock clock + real DB) | Needs real `runRitualSweep` + `rituals.config.recentPromptIndices` round-trip |
| 2 | Responses store correctly as Pensieve entries | Integration | Needs real `storePensieveEntry` + tagger + `RITUAL_RESPONSE` tag verification |
| 3 | Skip tracking increments on missed days | Integration | Needs real `ritual_responses.respondedAt = NULL` + sweep-time detection |
| 4 | Adjustment dialogue triggers after 3 consecutive skips | Integration | Needs real `skip_count` increment + sweep-time branching |
| 5 | Wellbeing snapshots store correctly when John responds | Integration | Needs real callback parser + partial-state lifecycle + `wellbeing_snapshots` insert |
| 6 | Weekly review fires at week boundary with exactly one observation and one Socratic question | **Integration + Live** (split into 2 tests) | Mock-clock integration test asserts firing/persistence; **live test** (TEST-26 equivalent, 3-of-3 against real Sonnet) asserts the single-question constraint actually holds with real generation. The Zod refinement is the runtime safety net but live-test verifies it doesn't constantly trigger the retry loop. |
| 7 | Weekly review references specific episodic summaries and decisions from the simulated week | **Live** (3-of-3) | Citation grounding is a Sonnet-prompt-level behavior; mocked Sonnet output can't validate it. Use a Haiku judge to verify the observation references concrete content from the seeded week. |

### Live-LLM file additions

New live test files to add to the excluded-suite list in `scripts/test.sh`:
- `src/rituals/__tests__/live-weekly-review.test.ts` (assertions 6 + 7, 3-of-3)

### Unit tests (no DB, no LLM)

- `src/rituals/__tests__/cadence.test.ts` — pure cadence math: daily/weekly/monthly/quarterly + DST boundaries (2026-03-29 spring-forward, 2026-10-25 fall-back)
- `src/rituals/__tests__/prompt-rotation.test.ts` — `chooseNextPromptIndex` with various recent histories, no-consecutive-duplicates invariant, uniform distribution check
- `src/rituals/__tests__/skip-tracking.test.ts` — strike counter + reset semantics

---

## Open questions / Confidence flags

**HIGH confidence (verified via code inspection):**
- Schema design (matches existing patterns in `episodic_summaries` and `decisions`)
- PP#-1 placement (verified by reading `processMessage` flow end-to-end)
- Channel separation (matches D-05 dual-channel pattern from M007)
- Cron strategy (existing two-cron pattern from `src/index.ts:73,89` is the precedent)
- `getEpisodicSummariesRange` ready for M009 (zero current consumers, exported and tested)
- `RITUAL_RESPONSE` enum extension (precedent: `DECISION` added in migration 0003)

**MEDIUM confidence:**
- callback_query is FIRST USE in this codebase. Pattern source: [grammY InlineKeyboard reference](https://grammy.dev/ref/core/inlinekeyboard). The pattern is well-established in Grammy ecosystem; integration risk is in the bot router (does the `bot.on('callback_query:data')` wire correctly when added alongside the existing `message:text` handler — should work, but needs phase-29 UAT).
- 18-hour response window for voice note is a guess based on "end of day" framing. Could be 12h, 24h, or 36h. Recommend defaulting to 18h and exposing as `RESPONSE_WINDOW_HOURS` constant in `src/rituals/voice-note.ts` for easy adjustment after live testing.

**LOW confidence (flagged for phase-level research):**
- The "skip vs response window" semantics get subtle when multiple rituals overlap (voice note window from yesterday still open + wellbeing fire today). The proposed model — `findActiveRitualBinding` returns the first active binding by `firedAt DESC` — is the simplest, but a concurrent voice note + wellbeing on the same evening could lead to a wellbeing-intended free-text reply being misclassified as a voice-note reply. **Mitigation:** the wellbeing-snapshot delivery does NOT set `awaitingResponse` because wellbeing replies come via callback_query, not free text. Only voice-note delivery sets `awaitingResponse`. This sidesteps the conflict cleanly.

---

## Sources

- Direct codebase inspection (HIGH confidence sources):
  - `/home/claude/chris/PLAN.md` (current milestone state, decisions D001–D041)
  - `/home/claude/chris/M009_Ritual_Infrastructure.md` (spec)
  - `/home/claude/chris/.planning/codebase/ARCHITECTURE.md` (existing layered monolith map)
  - `/home/claude/chris/.planning/codebase/CONVENTIONS.md` (ESM `.js` suffix, kebab-case files, fire-and-forget discipline)
  - `/home/claude/chris/.planning/codebase/TESTING.md` (Docker test gate, `fileParallelism: false`, primed-fixture pipeline)
  - `/home/claude/chris/src/proactive/sweep.ts` (dual-channel structure, accountability + reflective)
  - `/home/claude/chris/src/proactive/triggers/{deadline,silence,types}.ts` (TriggerDetector pattern, priority sort)
  - `/home/claude/chris/src/proactive/state.ts` (proactive_state KV pattern, escalation tracking)
  - `/home/claude/chris/src/chris/engine.ts` (PP#0 / PP#1 / PP#2 / PP#3 / PP#4 ordering)
  - `/home/claude/chris/src/episodic/{cron,consolidate}.ts` (independent cron + idempotency pattern)
  - `/home/claude/chris/src/db/schema.ts` (Drizzle schema, enum extension precedent)
  - `/home/claude/chris/src/db/migrations/0005_episodic_summaries.sql` (latest migration shape)
  - `/home/claude/chris/src/index.ts` (cron registration site)
  - `/home/claude/chris/src/bot/handlers/summary.ts` (CMD pattern, EN/FR/RU localization, Luxon ISO validity gate)
  - `/home/claude/chris/src/pensieve/retrieve.ts:390` (`getEpisodicSummariesRange` signature, M009-ready)
  - `/home/claude/chris/src/config.ts` (cron schedule env-var pattern)

- External docs (MEDIUM confidence):
  - [grammY InlineKeyboard reference](https://grammy.dev/ref/core/inlinekeyboard)
  - [grammY callback_query handling pattern](https://grammy.dev/ref/types/callbackquery)
  - [grammY keyboard plugin docs](https://github.com/grammyjs/website/blob/main/site/docs/plugins/keyboard.md)
