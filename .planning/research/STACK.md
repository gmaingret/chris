# Stack Research — v2.4 M009 Ritual Infrastructure

**Domain:** Ritual scheduling + daily voice note + daily wellbeing snapshot + weekly review
**Researched:** 2026-04-26
**Confidence:** HIGH (every recommendation either uses a dep already in `package.json` at the version installed, or is a no-op)
**Scope:** STACK additions / version bumps for M009 *only*. Core stack (Node 22 / TS / Drizzle / Grammy / @anthropic-ai/sdk / bge-m3 / node-cron / Luxon / Zod) is already correct — see `.planning/codebase/STACK.md`.

---

## Headline

**No new direct dependencies. No version bumps required.**

Every M009 capability — `rituals`/`wellbeing_snapshots` schema, inline-keyboard wellbeing UI, voice-note ritual, cadence advancement, single-question runtime enforcement, skip-tracking adjustment dialogue — composes from packages already installed at versions ≥ what's needed:

| Capability | Mechanism | Dep status |
|---|---|---|
| `rituals` + `wellbeing_snapshots` tables | `drizzle-orm` 0.45.2 + 7th migration `0006_*.sql` | already installed |
| 6th proactive trigger (ritual scheduler) | New peer trigger inside `src/proactive/triggers/` | pure code, no dep |
| Telegram inline keyboard (3×5 wellbeing buttons) | `grammy` 1.31's built-in `InlineKeyboard` class + `bot.callbackQuery()` | already installed |
| Voice note ingest | `bot.on('message:text')` (Greg dictates via Android STT keyboard locally — see Resolution §4) | no code change to bot wiring |
| Cadence advancement (daily/weekly/monthly/quarterly) | `luxon` 3.7.2 `DateTime.plus({ days/weeks/months })` + zone-aware `setZone(tz)` | already installed |
| Single-question runtime enforcement | Existing `zodOutputFormat()` pattern from `src/episodic/consolidate.ts` + `z.array().length(1)` schema | already installed |
| Skip-tracking adjustment dialogue | Existing `callLLM()` Haiku wrapper from `src/llm/client.ts` + `zodOutputFormat()` for structured config delta | already installed |

Latest npm versions (verified 2026-04-26): `@anthropic-ai/sdk@0.91.1` (we have ^0.90.0 — no bump needed; the parse-helpers used by M008 work identically in 0.90+), `grammy@1.42.0` (we have ^1.31.0 — no bump needed; `InlineKeyboard` class has been stable since 1.0), `luxon@3.7.2` (exact match), `node-cron@4.2.1` (exact match), `zod@4.3.6` (we have ^3.24.0 — keep, see §Anti-recommendations).

---

## Itemized — what M009 actually needs from the stack

### 1. `rituals` table — Drizzle migration only, no new dep

Schema additions live in `src/db/schema.ts` and a new `src/db/migrations/0006_rituals.sql`. Nothing exotic:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | matches existing pattern (decisions, episodic_summaries) |
| `type` | new `ritual_cadence_enum` (`daily`/`weekly`/`monthly`/`quarterly`) | follow `epistemic_tag_enum` pattern in `src/db/schema.ts` |
| `last_run_at` | `timestamptz` nullable | nullable so first-fire schedule from `next_run_at` only |
| `next_run_at` | `timestamptz` NOT NULL | sweep predicate is `WHERE enabled AND next_run_at <= now()` — must be NOT NULL for index efficiency |
| `enabled` | `boolean` NOT NULL default `true` | |
| `config` | `jsonb` NOT NULL default `'{}'::jsonb` | per-ritual settings — prompt list for daily, day-of-week + local time for weekly, etc. Skip-tracking dialogue writes here. |
| `skip_count` | `integer` NOT NULL default `0` | reset on successful response or after adjustment dialogue closes |
| `created_at` | `timestamptz` NOT NULL default `now()` | |

**Indexes (must ship in 0006, not retrofitted — D034 precedent):**
- `btree(enabled, next_run_at)` for the sweep's hot-path predicate.
- Optional `UNIQUE(type)` if (and only if) the design forbids two rituals of the same cadence; the M009 spec implies one daily-voice + one daily-wellbeing + one weekly, so `UNIQUE(type)` would be wrong — instead seed three deterministic UUIDs and look up by id. **Recommendation: no UNIQUE on type. Use a separate `name` text column or just trust the seeded IDs.** Add `UNIQUE(name)` if name is added.

**Why:** Drizzle's `pgEnum`, `jsonb`, `timestamp({ withTimezone: true })` are all already used in `src/db/schema.ts`. No drizzle-kit version bump (0.31.10 supports all of this).

### 2. `wellbeing_snapshots` table — Drizzle migration only

```
id uuid pk default gen_random_uuid()
snapshot_date date NOT NULL
energy smallint NOT NULL CHECK (energy BETWEEN 1 AND 5)
mood smallint NOT NULL CHECK (mood BETWEEN 1 AND 5)
anxiety smallint NOT NULL CHECK (anxiety BETWEEN 1 AND 5)
notes text
created_at timestamptz NOT NULL default now()
UNIQUE(snapshot_date)  -- one snapshot per local day; matches episodic_summaries idiom
```

**Why `smallint` not `numeric(1,0)`:** Drizzle's `integer()` maps to PG `integer` (4 bytes). For 1–5 scale a 2-byte `smallint` is the right type and Drizzle exposes it via `smallint()`. CHECK constraint enforced at SQL layer (Drizzle 0.45 supports `.check()` on column builders).

**Why UNIQUE(snapshot_date):** mirrors the M008 `episodic_summaries.summary_date` idempotency pattern (D034). Same DST-safety story applies — `snapshot_date` is the local-tz `YYYY-MM-DD` computed via `DateTime.fromJSDate(now, { zone }).toISODate()`.

### 3. Telegram inline keyboard (3 rows × 5 buttons) — Grammy built-in

**Verified surface** (Grammy 1.31 installed; checked `node_modules/grammy/out/convenience/keyboard.d.ts`):

```ts
import { InlineKeyboard } from 'grammy';

const kb = new InlineKeyboard()
  .text('1', 'wb:e:1').text('2', 'wb:e:2').text('3', 'wb:e:3').text('4', 'wb:e:4').text('5', 'wb:e:5').row()
  .text('1', 'wb:m:1').text('2', 'wb:m:2').text('3', 'wb:m:3').text('4', 'wb:m:4').text('5', 'wb:m:5').row()
  .text('1', 'wb:a:1').text('2', 'wb:a:2').text('3', 'wb:a:3').text('4', 'wb:a:4').text('5', 'wb:a:5');

await ctx.reply('How are you today?\nEnergy / Mood / Anxiety (1–5):', { reply_markup: kb });
```

Callback handler:
```ts
bot.callbackQuery(/^wb:([ema]):([1-5])$/, async (ctx) => {
  const [, dim, val] = ctx.match!;
  await upsertWellbeingDraft(snapshotDate, dim, Number(val));
  await ctx.answerCallbackQuery({ text: 'OK' });
});
```

**Anti-recommendation: do NOT add `grammy/menu` plugin.** `@grammyjs/menu` is a separate package designed for stateful navigable menus (next/back, dynamic re-render). The wellbeing snapshot is three independent radio-button rows that write to one row in `wellbeing_snapshots` — a stateless `InlineKeyboard` + a single regex `bot.callbackQuery()` handler is strictly simpler. The menu plugin would require a session middleware and would persist menu state outside the DB row that already is the source of truth.

**Anti-recommendation: do NOT add `@grammyjs/conversations`.** The skip-tracking adjustment dialogue is a single Haiku call on Greg's next free-text message after the "what should change?" prompt — the existing `decision_capture_state` chokepoint pattern (`src/decisions/capture-state.ts`) is the precedent: store a small per-chat state row, intercept the next message in the engine pre-processor, route to the Haiku parser, write the result, clear state. Adding `@grammyjs/conversations` introduces a new state model parallel to the one M007 already established.

**Concurrency caveat (must be designed-in):** Telegram delivers callback queries via the SAME webhook as text messages. Grammy serialises updates per-update but NOT per-chat. The wellbeing draft is three independent button taps — the engine MUST use either (a) `INSERT ... ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>`, or (b) a single composite-key query that updates one column at a time. This mirrors the M007 `transitionDecision()` optimistic-concurrency pattern at the SQL level and avoids a "last write wins" race when Greg taps energy=3, mood=4, anxiety=2 in rapid succession.

### 4. Voice message handling — RESOLVED: no `bot.on('message:voice')` handler in M009

**Spec evidence audit:**

| Source | Quote | Status |
|---|---|---|
| `PLAN.md` §Out of Scope and Deferred (line 240) | *"**Voice message transcription via Whisper** — risk of transcription errors polluting the Pensieve is too high. Android keyboard STT (dictation) is the pragmatic alternative: free, accurate, user reviews/edits before sending. Revisit only if a review/confirm-before-storage flow is built first."* | **Authoritative — Whisper transcription is OUT** |
| `PRD_Project_Chris.md` line 316 | *"single voice note, deposit-only, 6 rotating prompts."* | "voice note" is the *ritual name*, not a Telegram-modality requirement |
| `M009_Ritual_Infrastructure.md` Acceptance line 41 | *"John receives a daily prompt every evening on his real phone, responds by voice (via Telegram), the transcript appears in the Pensieve"* | "responds by voice (via Telegram)" — ambiguous but reconciled below |
| Codebase | `bot.on('message:text')` and `bot.on('message:document')` only — no `message:voice` handler exists | Confirms current architecture is text-only |

**Reconciliation (the spec phrasing is reconcilable, not contradictory):** The voice ritual's UX *as Greg lives it* is "speak into Android keyboard's STT mic icon -> keyboard inserts the transcribed text into Telegram's compose field -> Greg reviews/edits -> sends as plain text". From the bot's perspective the message arrives as `message:text`. The phrase "responds by voice (via Telegram)" describes Greg's modality of input, not Telegram's modality of delivery.

**Decision: M009 ships zero `message:voice` handling code.** The "daily voice note ritual" is just a ritual that fires a prompt and stores Greg's `message:text` reply as a Pensieve entry. No `@huggingface/transformers` Whisper model, no `node-fetch` voice download, no `ffmpeg` shim. If Greg sends an actual Telegram voice message, the bot drops it on the floor (it falls through `bot.on('message:text')` and `bot.on('message:document')` — no handler matches). **Recommendation: explicit `bot.on('message:voice')` reply** that says one of: *"I don't transcribe voice yet — try the keyboard's mic icon instead, your transcript reviews on-screen before sending"* (in EN/FR/RU per existing `franc`-detected language). This costs ~10 LOC and prevents silent drops which would feel like Chris ignoring Greg.

**Anti-recommendation: do NOT add `@huggingface/transformers` Whisper inference, `whisper.cpp`, `node-whisper`, or any OpenAI/Anthropic transcription API.** The Deferred-section gate is a *review/confirm-before-storage flow first*, not transcription quality. That flow is itself a multi-message UX milestone, not an M009 inclusion.

### 5. Cadence advancement — `luxon` only, no new lib

Luxon 3.7.2 already in use in `src/episodic/`, `src/decisions/resolve-by.ts`, `src/proactive/`. It handles all four cadences cleanly.

```ts
import { DateTime } from 'luxon';
import { config } from '../config.js';

function advanceNextRunAt(
  cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly',
  lastRunAt: Date,
  ritualConfig: { localTime?: string; weekday?: number },  // weekday: 1=Mon..7=Sun (ISO)
): Date {
  const tz = config.proactiveTimezone;
  const last = DateTime.fromJSDate(lastRunAt, { zone: tz });
  switch (cadence) {
    case 'daily':
      // Tomorrow's local-time slot. plus({ days: 1 }) is DST-safe (Luxon
      // adjusts wall-clock across spring-forward/fall-back).
      return last.plus({ days: 1 }).toJSDate();
    case 'weekly':
      // "Sunday evening" -> ISO weekday 7. Advance to the next instance.
      return nextWeekdayAt(last, ritualConfig.weekday ?? 7, ritualConfig.localTime ?? '20:00').toJSDate();
    case 'monthly':
      // Same day-of-month next month. Luxon clamps Jan 31 -> Feb 28/29 cleanly.
      return last.plus({ months: 1 }).toJSDate();
    case 'quarterly':
      return last.plus({ months: 3 }).toJSDate();
  }
}
```

**Week-boundary semantics for "Sunday evening" weekly review:** Luxon's `DateTime.weekday` returns 1=Mon..7=Sun (ISO 8601). For weekly review:

```ts
function nextWeekdayAt(from: DateTime, isoWeekday: number, hhmm: string): DateTime {
  const [h, m] = hhmm.split(':').map(Number);
  const target = from.set({ hour: h!, minute: m!, second: 0, millisecond: 0 });
  const daysToAdd = ((isoWeekday - target.weekday + 7) % 7) || 7;
  return target.plus({ days: daysToAdd });  // always strictly future
}
```

**Why `|| 7` (the subtle bit):** if it's Sunday 20:01 and the ritual just fired, `(7-7+7)%7 = 0` would schedule the same Sunday — wrong. The `|| 7` forces a 7-day jump when the modulo is zero, guaranteeing the next ritual is *next* Sunday.

**DST safety:** Luxon's `plus({ days })` and `plus({ weeks })` are wall-clock-preserving across DST. The 2026-03-29 spring-forward in Paris collapses 02:00->03:00; a 20:00 ritual scheduled the day before still fires at 20:00. Same story for 2026-10-25 fall-back. This is the exact pattern `src/episodic/cron.ts` (Phase 22 CRON-02) and `src/decisions/resolve-by.ts` already use — replicating, not inventing.

**Recommendation: ritual `next_run_at` is stored as UTC** (timestamptz, as scheduled). Sweep predicate `WHERE enabled AND next_run_at <= now()` is timezone-agnostic at the comparison. Wall-clock semantics are encoded *inside* `advanceNextRunAt` via Luxon's `setZone`. This isolates DST math to one function.

**No new lib.** `date-fns`, `dayjs`, or `rrule` are unnecessary — Luxon covers cadence advancement, weekday-of-week, and DST. `rrule` would be over-fit (it's iCal RRULE strings — useful for "every other Tuesday at 14:00 except holidays"; M009 has four enum cadences).

### 6. Single-question runtime enforcement — `zodOutputFormat()`, not token counting

The M009 spec says *"multi-question responses are rejected and regenerated"* and proposes "token-count check" — but the right tool is the structured-output pattern M008 already established.

**Recommended pattern** (mirrors `src/episodic/consolidate.ts:75-81`):

```ts
import * as zV4 from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const WeeklyReviewOutputSchemaV4 = zV4.object({
  observation: zV4.string().min(20).max(400),
  socratic_question: zV4.string()
    .min(10).max(200)
    .refine(s => (s.match(/\?/g) ?? []).length === 1, {
      message: 'socratic_question must contain exactly one "?"',
    }),
});

// Same one-retry-on-parse-failure pattern as runConsolidate's callSonnetWithRetry.
```

**Why this beats a token-count check:**
- The "multi-question" failure mode is *semantic* (two interrogatives) not *token-count* (token count varies wildly with EN/FR/RU and topic). A 500-token observation with one well-formed question is correct; a 60-token output with three questions is wrong.
- The Zod refinement is deterministic and runs in microseconds.
- It uses the existing one-retry-on-parse-failure scaffolding from `callSonnetWithRetry`, so the "regenerate" semantics are free.
- Integrates with M006 constitutional preamble via the same `system: [{ type: 'text', text: ..., cache_control: { type: 'ephemeral' } }]` shape.

**Anti-recommendation: do NOT add a tokenizer (`tiktoken`, `gpt-tokenizer`, or `@anthropic-ai/tokenizer`).** Token counts are a poor proxy for "question count" (the actual constraint). Adding a tokenizer dep doubles the install size for zero behavioral guarantee.

**Defence-in-depth option (cheap, optional):** if the Zod refinement *also* permits an interrogative-clause guard at the prompt level (`"You will produce exactly ONE Socratic question. Do not nest sub-questions or rhetorical follow-ons."`), the system has prompt-level + runtime-level enforcement. Both layers, no new deps.

### 7. Skip-tracking adjustment dialogue — `callLLM()` + `zodOutputFormat()` again

**Pattern (mirrors `src/decisions/capture.ts` + `src/episodic/consolidate.ts`):**

1. After 3 consecutive `skip_count` increments, the proactive sweep instead of firing the standard prompt fires *"This ritual isn't working — what should change about when, what it asks, or whether to keep it at all?"*.
2. Set a `ritual_adjustment_state` row (small KV table or JSONB on `proactive_state`) with `chat_id`, `ritual_id`, `stage='AWAITING_RESPONSE'`.
3. Engine pre-processor (PP#0/PP#1 precedent from M007) checks for this state on next text message and routes to `parseRitualAdjustment(text)`.
4. `parseRitualAdjustment` calls Haiku via `messages.parse({ output_config: { format: zodOutputFormat(...) } })` — structured config delta:

```ts
const RitualAdjustmentSchema = zV4.object({
  action: zV4.enum(['disable', 'change_time', 'change_prompts', 'change_cadence', 'keep']),
  new_local_time: zV4.string().regex(/^\d{2}:\d{2}$/).optional(),
  new_cadence: zV4.enum(['daily', 'weekly']).optional(),
  new_prompts: zV4.array(zV4.string()).max(10).optional(),
  user_rationale: zV4.string(),  // captured for audit
});
```

5. Apply the delta to `rituals.config` (or `rituals.enabled` for action=disable), reset `skip_count`, clear adjustment state.

**Why `messages.parse` not `callLLM`:** the existing `callLLM` wrapper hardcodes Haiku + temp 0 + max_tokens 100 (`src/llm/client.ts:23-37`) and returns raw text. For structured-output Haiku you need `messages.parse({ output_config: { format: zodOutputFormat(...) } })` directly — same pattern as `src/episodic/consolidate.ts:128-183`. `callLLM` is for unstructured Haiku output (mode detection, tag extraction). The skip-adjustment parse is structured ⇒ use `messages.parse` against `HAIKU_MODEL`.

**Anti-recommendation: do NOT add `langchain` / `langchain-core` / `@anthropic-ai/sdk-tools` for "agent tooling" or "function calling".** The skip-adjustment is a single-turn parse, not a multi-step agent. The native SDK helpers + Zod cover the entire surface.

---

## Confirmed: zero new dependencies

```jsonc
// package.json — no diff under "dependencies" or "devDependencies"
```

**What is added is internal code only:**
- `src/db/migrations/0006_rituals_wellbeing.sql` (one migration with both tables)
- `src/db/schema.ts` additions (`ritualCadenceEnum`, `rituals`, `wellbeingSnapshots`)
- `src/rituals/` (new subsystem dir — schedule/advance/seed/skip-track helpers, mirroring `src/episodic/` shape)
- `src/proactive/triggers/ritual.ts` (6th trigger, peer to silence/commitment/deadline/pattern/thread)
- `src/bot/handlers/wellbeing.ts` (callback-query handler for the inline keyboard)
- `src/rituals/__tests__/` (unit + 14-day synthetic fixture; primed-fixture pipeline per D041)

---

## Version-bump assessment (none required)

| Dep | Installed | Latest (2026-04-26) | Bump needed? |
|---|---|---|---|
| `@anthropic-ai/sdk` | ^0.90.0 | 0.91.1 | **No.** `messages.parse` + `helpers/zod`'s `zodOutputFormat` shipped well before 0.90; behaviour stable across the 0.90→0.91 window. M008 ships against this version. |
| `grammy` | ^1.31.0 | 1.42.0 | **No.** `InlineKeyboard` and `bot.callbackQuery(regex|literal, handler)` are pre-1.0 surface; nothing in 1.31→1.42 affects M009. Bump optional, NOT required for M009. If a bump happens, it should be its own tech-debt phase, not bundled with M009. |
| `luxon` | ^3.7.2 | 3.7.2 | Exact match. |
| `node-cron` | ^4.2.1 | 4.2.1 | Exact match. M008 already proves the `timezone` option is DST-safe. |
| `drizzle-orm` | ^0.45.2 | (current) | **No.** `pgEnum`, `jsonb`, `smallint`, `.check()`, `timestamp({ withTimezone: true })` all present in 0.45.2. |
| `zod` | ^3.24.0 | 4.x | **No bump.** Project uses v3 as the source-of-truth schema and `zod/v4` sub-path import only at the SDK boundary, exactly as documented in `src/episodic/consolidate.ts:33-81`. M009 follows the same dual-schema pattern. Bumping the top-level `zod` to v4 is a separate cross-cutting refactor, NOT in M009 scope. |

---

## Anti-recommendations (DO NOT add)

| Package / Pattern | Why not |
|---|---|
| `@grammyjs/menu` | Wellbeing snapshot is stateless 3-row keyboard; native `InlineKeyboard` + regex `callbackQuery` is strictly simpler. Menu plugin requires session middleware. |
| `@grammyjs/conversations` | Skip-adjustment + ritual-config dialogue is single-turn (Haiku parses one user message). Use existing `decision_capture_state` chokepoint precedent (M007), not a parallel state model. |
| `@huggingface/transformers` Whisper / `whisper.cpp` / `node-whisper` / OpenAI Whisper API | PLAN.md D-Deferred is explicit — Whisper transcription is OUT until a review/confirm-before-storage UX is built first. M009 does not ship that flow. Greg dictates via Android STT keyboard locally. |
| `tiktoken` / `gpt-tokenizer` / `@anthropic-ai/tokenizer` | Token-count is a poor proxy for "exactly one question". Use a Zod `.refine()` on the structured output instead — runtime-deterministic and free. |
| `rrule` / `cron-parser` | Four enum cadences (daily/weekly/monthly/quarterly) with one wall-clock slot do not need iCal RRULE expressivity. Luxon `DateTime.plus({ days/weeks/months })` covers it cleanly with DST safety. |
| `date-fns` / `dayjs` | Project standardised on Luxon for timezone-aware day-boundary math (CONVENTIONS.md §Timezone Handling). Adding a second date library splits the convention. |
| `bullmq` / `agenda` / any cron-job-queue library | Project's discipline is independent `cron.schedule()` peers (M008 episodic cron + M004 proactive sweep + M003 source sync — all independent peers, not a queue). M009's ritual scheduler is a 6th trigger *inside* the existing proactive sweep, not a new cron and not a queue. |
| `langchain` / `@langchain/anthropic` / `@anthropic-ai/sdk-tools` agent surface | Single-turn structured Haiku parse — direct `anthropic.messages.parse()` + `zodOutputFormat()` is the established pattern. No agent framework. |
| Bumping `@anthropic-ai/sdk` from ^0.90.0 to ^0.91.x as part of M009 | Pre-1.0 SDK; minor bumps may shift the helpers/zod surface. Keep bump as its own phase if needed; don't bundle with M009 capability work. |
| Bumping `grammy` from ^1.31.0 to ^1.42.x as part of M009 | Same reason — orthogonal to M009 capabilities. |
| Bumping top-level `zod` from ^3.24.0 to ^4.x as part of M009 | The v3/v4 dual-schema pattern in `src/episodic/consolidate.ts` is *intentional* (CONVENTIONS.md §Typing Discipline). M009 follows it. Migrating the whole codebase to v4 is a separate, cross-cutting refactor. |
| `node-fetch` / `axios` / any HTTP client | Telegram I/O is via Grammy's `bot.api`; LLM I/O is via the Anthropic SDK. M009 has no other HTTP surface. |

---

## Integration with existing M008 cron pattern + M004 proactive sweep

**Decision: ritual scheduler is the 6th trigger inside `runSweep()`, not a new cron job.**

**Why:**
- M008 already established that *consolidation* is its own cron (23:00 local, peer to proactive sweep) because it's a daily batch job with a fixed wall-clock slot.
- *Rituals*, in contrast, are continuously schedulable (next_run_at can be any future timestamp) and need to coexist with reactive triggers (silence/commitment/pattern/thread). Putting them inside `runSweep()` reuses:
  - Existing 10:00 sweep cadence (the same tick that checks reactive triggers also checks `next_run_at <= now()`).
  - Mute gate (rituals respect `isMuted()` exactly like reactive triggers do).
  - Daily cap (independent or shared — design decision per ritual; default = independent so wellbeing+voicenote can both fire on the same day, but reactive cap stays at 1).
  - Per-trigger try/catch (a ritual fire failure cannot starve reactive triggers, mirroring WR-02 from M007).

**Required additions to `src/proactive/sweep.ts`:**
- New triggered phase between accountability and reflective channels (or after both), checking `rituals` table via a new `createRitualTrigger()` import from `src/proactive/triggers/ritual.ts`.
- Rituals fire BEFORE the reflective sweep's Phase-1 SQL triggers (silence/commitment), because Greg gets more value from a scheduled ritual than from an opportunistic reflective nudge — but AFTER accountability (D-05 priority preserved).
- On fire, ritual handler updates `last_run_at = now()` and `next_run_at = advanceNextRunAt(...)` atomically with the Telegram send (write-before-send precedent from M007 `upsertAwaitingResolution`).

**Required additions to `src/index.ts`:** none. The cron registration already covers proactive sweep at the existing `PROACTIVE_SWEEP_CRON` cadence.

**Frequency tradeoff:** if `PROACTIVE_SWEEP_CRON` is `0 10 * * *` (once daily at 10am), a 20:00 weekly ritual won't fire until 10am the next morning. For M009 acceptance ("Sunday evening") this is wrong. **Recommendation: tighten the sweep cron to hourly** (`0 * * * *`) so any ritual can fire within an hour of its scheduled time. This is a config change, not a code change. Hourly sweep is still cheap (the reactive triggers' SQL-first short-circuit means most ticks are zero-cost). This is the single concrete *operational* change M009 requires beyond the new tables + code.

---

## Sources

- `package.json` — installed deps + versions.
- `.planning/codebase/STACK.md` — current stack inventory (Apr 2026).
- `.planning/codebase/CONVENTIONS.md` §Timezone Handling, §Typing Discipline, §LLM Tier Discipline, §Idempotency Patterns — the patterns M009 mirrors.
- `src/episodic/consolidate.ts` — v3/v4 Zod dual-schema + `messages.parse({ output_config })` + one-retry-on-parse-failure precedent.
- `src/episodic/cron.ts` — DST-safe cron + `Intl.DateTimeFormat` + double-catch belt-and-suspenders precedent.
- `src/proactive/sweep.ts` — accountability + reflective dual-channel architecture; 6th trigger slots in here.
- `src/decisions/capture.ts` + `src/decisions/capture-state.ts` — single-turn dialogue state precedent for skip-adjustment.
- `src/llm/client.ts` — `callLLM` Haiku wrapper.
- `node_modules/grammy/out/convenience/keyboard.d.ts` — verified `InlineKeyboard` class surface in installed v1.31.0.
- `PLAN.md` line 240 (D-Deferred Whisper) — authoritative source for "no voice transcription in M009".
- `M009_Ritual_Infrastructure.md` — milestone spec.
- `PRD_Project_Chris.md` line 316 — ritual taxonomy framing.
- npm registry checks (verified 2026-04-26): `@anthropic-ai/sdk@0.91.1`, `grammy@1.42.0`, `luxon@3.7.2`, `node-cron@4.2.1`, `zod@4.3.6`. Confidence: HIGH (registry data, real-time).

---

*Stack research for M009: 2026-04-26. No deps added, no version bumps. Six new code surfaces (migration, schema, rituals subsystem, ritual trigger, wellbeing handler, tests). One operational change (sweep cron → hourly).*
