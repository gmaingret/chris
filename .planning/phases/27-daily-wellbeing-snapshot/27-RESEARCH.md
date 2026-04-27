# Phase 27: Daily Wellbeing Snapshot — Research

**Researched:** 2026-04-26
**Domain:** First inline-keyboard surface in codebase (callback_query router + 3-row × 5-button keyboard for energy/mood/anxiety + skip), per-dim partial-state staging in `ritual_responses.metadata` jsonb, completion-gated single-atomic write to `wellbeing_snapshots`, anchor-bias defeat (Pitfall 11/13)
**Confidence:** HIGH — every recommendation either grounded in existing v2.0–v2.4 code (Phase 25 substrate verified by direct file inspection) or in the milestone-level research synthesis already validated during M009 kickoff.
**Mode:** `--auto` follow-up to `/gsd-discuss-phase --auto` (CONTEXT.md decisions D-27-01..D-27-10 are LOCKED)

---

## Summary

Phase 27 ships the **daily wellbeing snapshot ritual end-to-end** in 3 plans across 5 requirements (WELL-01..05). Zero new dependencies. Zero version bumps. Migration 0008 is a single idempotent INSERT seeding the `daily_wellbeing` row. The wellbeing handler module (`src/rituals/wellbeing.ts`) ships fire-side (initial keyboard send + ritual_responses row creation) + callback-side (per-tap jsonb_set merge + keyboard redraw + completion-gated wellbeing_snapshots write + skip handling). The bot router gets its first `bot.on('callback_query:data', handleRitualCallback)` registration + a thin `src/bot/handlers/ritual-callback.ts` dispatcher (prefix-match `r:w:*` → wellbeing; future-proofed for Phase 28's `r:adj:*` + Phase 29's `r:wr:*`).

**Primary recommendation:** Plan 27-02 ships migration 0008 + handler module + scheduler dispatch wiring as ONE atomic plan (D-27-06). Plan 27-01 ships the bot router infrastructure (NO ritual semantics, pure routing). Plan 27-03 ships the operator UAT script + co-located behavior tests. Atomic landing of seed + handler prevents the runtime dispatch bug where `runRitualSweep` finds the seeded row but `dispatchRitualHandler` throws (Phase 25 skeleton path).

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-27-01:** Migration `0008_wellbeing_seed.sql` (Phase 26 takes 0007 voice note seed). Single idempotent `INSERT INTO rituals (name, type, next_run_at, config) VALUES ('daily_wellbeing', 'daily', <next 09:00 Paris>, $config_jsonb) ON CONFLICT (name) DO NOTHING;`. Seed config jsonb has 6 of 8 RitualConfigSchema fields populated (omits `fire_dow` + `prompt_bag` as optional). drizzle-kit snapshot regen via `scripts/regen-snapshots.sh`. `scripts/test.sh` extended with psql gate `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'` returns 1.

**D-27-02:** Compact callback_data `r:w:<dim>:<value>` (e.g., `r:w:e:3` for energy=3, `r:w:skip` for skip). Edit-message-in-place via `ctx.editMessageReplyMarkup` (NOT new messages). Tapped values rendered as `[N]` ASCII (no emoji). 4 Telegram round-trips total per snapshot (3 tap edits + 1 final summary).

**D-27-03:** Skip button is 4th row, full-width, English-labeled `Skip`. Sends `r:w:skip` callback_data. Writes `metadata.skipped = true` + `metadata.adjustment_eligible = false` + `responded_at = now()`. Does NOT increment `rituals.skip_count`. Emits `'wellbeing_skipped'` outcome (NOT `fired_no_response`).

**D-27-04:** Two-pronged anchor-bias defeat. (1) Keyboard surface NEVER queries `wellbeing_snapshots` or prior `ritual_responses` for historical values. (2) Message text is constant prompt with no historical reference. Both prongs are negative requirements (don't render X).

**D-27-05:** Completion-gated insert via metadata staging. Partial state lives in `ritual_responses.metadata.partial: { e?, m?, a? }` jsonb. Per-dim merge via `UPDATE ritual_responses SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{partial,e}', '3'::jsonb) WHERE id = $1` — atomic at Postgres column level. wellbeing_snapshots write deferred until all 3 dims captured: single `INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET energy=EXCLUDED.energy, mood=EXCLUDED.mood, anxiety=EXCLUDED.anxiety`.

**D-27-06:** Migration 0008 + handler module + dispatch wiring ship in ONE plan (Plan 27-02). Splitting creates a runtime dispatch gap (seed without handler dispatches to throwing skeleton).

**D-27-07:** **3 plans**:
- **27-01 Callback router infrastructure** — bot.on('callback_query:data') wiring + ritual-callback.ts dispatcher (prefix-match) + answerCallbackQuery discipline + unit test for unknown-prefix silent ack. Requirements: WELL-01 (partial), WELL-02 (partial — bot.on registration only).
- **27-02 Wellbeing handler + seed migration (atomic)** — migration 0008 + `src/rituals/wellbeing.ts` (fireWellbeing + handleWellbeingCallback) + dispatcher wiring in `src/rituals/scheduler.ts`. Requirements: WELL-01..05 (terminal).
- **27-03 Operator UAT + behavior tests** — `scripts/fire-wellbeing.ts` + `src/rituals/__tests__/wellbeing.test.ts` (real DB). Requirements: integration coverage for WELL-01..05.

**D-27-08:** English-only labels for v2.4. EN/FR/RU localization deferred (~5 LOC delta if requested).

**D-27-09:** Existing 10:00 morning sweep tick catches the 09:00 fire (with up to 60min latency, accepted per Disagreement #1). NO third cron tick added.

**D-27-10:** Real Docker Postgres (port 5433) for behavior tests; Telegram API stubbed via minimal Grammy Context builder.

### Claude's Discretion

- Exact `outcome` strings: `'wellbeing_completed'` / `'wellbeing_skipped'` / `'wellbeing_partial'`
- Exact metadata jsonb shape: `{ message_id, partial: { e?, m?, a? }, completed?, skipped?, adjustment_eligible? }`
- Exact button labels (recommendation: plain `1`/`2`/`3`/`4`/`5` + `Skip`; optional first-button label per row)
- Whether to extract `wellbeing-state.ts` helper or co-locate in `wellbeing.ts` (recommended: co-locate; ~20 LOC)
- Test file location: `src/rituals/__tests__/wellbeing.test.ts` per existing convention

### Deferred Ideas (OUT OF SCOPE)

- Single-composite (1-tap) wellbeing alternative — defer v2.5
- Optional 1-line "why" follow-up on extreme values — defer v2.5
- Reverse-anchor nudges — defer v2.5 if Phase 29 variance gate fires
- Random dimension order each day — defer v2.5
- EN/FR/RU button label localization — defer
- Third cron tick at 09:00 — defer
- DIFF-2 Wellbeing trajectory in weekly observation (Phase 29 source) — defer v2.5
- `/wellbeing` query command — defer; M013 may revisit
- `wellbeing_snapshots.notes` column population — schema column exists from Phase 25; Phase 27 does not write it

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WELL-01 | Single Telegram message with 3-row × 5-button `InlineKeyboard` (energy / mood / anxiety, 1–5 each) + 4th-row skip button. First use of inline keyboards in this codebase. | §1 (Grammy InlineKeyboard surface) — `new InlineKeyboard().text('1', 'r:w:e:1').text('2', 'r:w:e:2')...row().text('Skip', 'r:w:skip')` shape; verified `grammy@1.31` exports `InlineKeyboard` from package root; `bot.api.sendMessage(chatId, text, { reply_markup: kb })` pattern |
| WELL-02 | `bot.on('callback_query:data', handleRitualCallback)` registered in `src/bot/bot.ts`. Each tap upserts the corresponding column in `wellbeing_snapshots` per-dimension via `INSERT ... ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>` to avoid last-write-wins race under rapid taps. | §2 (callback_query router pattern) + §3 (jsonb_set partial-state SQL + completion-gated wellbeing_snapshots upsert). Per-dim atomicity at Postgres column level via jsonb_set; final wellbeing_snapshots write is single atomic insert per D-27-05. |
| WELL-03 | Partial-state in `ritual_responses.metadata` jsonb survives across taps. UI redraws keyboard with current selections HIGHLIGHTED + previous days HIDDEN (anchor-bias defeat). Snapshot complete when 3 dims tapped or skip pressed. | §4 (anchor-bias defeat — two-pronged D-27-04). Real-DB rapid-tap concurrency test asserts metadata.partial has all 3 keys after Promise.all(3 callbacks). |
| WELL-04 | Skip button (`adjustment_eligible: false`) — optional skip without triggering adjustment dialogue. Distinct from `fired_no_response`. | §5 (skip outcome semantics). Phase 28 reads `ritual_fire_events.outcome`; `'wellbeing_skipped'` outcome filtered out of 3-strikes counter. |
| WELL-05 | Default fire 09:00 Europe/Paris, configurable via `rituals.config.fire_at`. Separate from voice note (21:00) per D026 + Pitfall 13. | §6 (10:00 sweep tick alignment per D-27-09). Seed migration's `next_run_at` computed at 09:00 Paris in jsonb config. |

</phase_requirements>

---

## §1 — Grammy InlineKeyboard surface (FIRST USE in codebase)

**Confirmed:** Grammy 1.31 exports `InlineKeyboard` from the package root. Verified at `node_modules/grammy/out/convenience/keyboard.d.ts`. Existing codebase grep for `InlineKeyboard|callback_query|reply_markup|callbackQuery` returns ZERO hits in `src/` — Phase 27 IS the first.

**API shape** (from grammY docs + node_modules verification):

```typescript
import { InlineKeyboard } from 'grammy';

const kb = new InlineKeyboard()
  .text('1', 'r:w:e:1').text('2', 'r:w:e:2').text('3', 'r:w:e:3').text('4', 'r:w:e:4').text('5', 'r:w:e:5').row()
  .text('1', 'r:w:m:1').text('2', 'r:w:m:2').text('3', 'r:w:m:3').text('4', 'r:w:m:4').text('5', 'r:w:m:5').row()
  .text('1', 'r:w:a:1').text('2', 'r:w:a:2').text('3', 'r:w:a:3').text('4', 'r:w:a:4').text('5', 'r:w:a:5').row()
  .text('Skip', 'r:w:skip');

await bot.api.sendMessage(chatId, 'Wellbeing snapshot — tap energy, mood, anxiety:', { reply_markup: kb });
```

**Edit-in-place after each tap** uses `ctx.editMessageReplyMarkup`:

```typescript
await ctx.editMessageReplyMarkup({ reply_markup: rebuiltKb });
```

OR (for completion / skip — clears keyboard):

```typescript
await ctx.editMessageText('Logged: energy 3, mood 4, anxiety 2.');  // no reply_markup → keyboard cleared
```

**`callback_data` byte limit:** 64 bytes per Telegram Bot API. Phase 27's payloads (`r:w:e:3` = 7 bytes, `r:w:skip` = 8 bytes) are well within budget.

**`ctx.answerCallbackQuery()` discipline:** Telegram requires the bot to acknowledge every callback within 30s OR the loading spinner hangs on the user's button. Plan 27-01's dispatcher MUST call `ctx.answerCallbackQuery()` for every callback — even unknown prefixes (silent ack).

---

## §2 — Callback_query router pattern + dispatch table

**Existing `src/bot/bot.ts` shape** (verified):

```typescript
bot.use(auth);
bot.command('sync', ...);
bot.command('decisions', ...);
bot.command('summary', ...);
bot.on('message:text', handleTextMessage);
bot.on('message:document', handleDocument);
bot.catch((err) => { ... });
```

**Phase 27 addition** (Plan 27-01) — register BEFORE `bot.catch`:

```typescript
import { handleRitualCallback } from './handlers/ritual-callback.js';

// First inline-keyboard surface in this codebase (M009 Phase 27 WELL-02).
// Future ritual callback prefixes: r:adj:* (Phase 28 adjustment dialogue),
// r:wr:* (Phase 29 weekly review confirmation).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('callback_query:data', handleRitualCallback as any);
```

**Dispatcher shape** (`src/bot/handlers/ritual-callback.ts`):

```typescript
import type { Context } from 'grammy';
import { handleWellbeingCallback } from '../../rituals/wellbeing.js';
import { logger } from '../../utils/logger.js';

const RITUAL_CALLBACK_PREFIX = 'r:';
const WELLBEING_PREFIX = 'r:w:';

export async function handleRitualCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith(WELLBEING_PREFIX)) {
    await handleWellbeingCallback(ctx, data);
    return;
  }

  // Unknown ritual callback — silent ack (Telegram contract: every callback
  // must be acknowledged within 30s or the loading spinner hangs).
  // Phase 28 (r:adj:*) and Phase 29 (r:wr:*) will add new branches here.
  if (data.startsWith(RITUAL_CALLBACK_PREFIX)) {
    logger.warn({ data }, 'rituals.callback.unknown_ritual_prefix');
  }
  await ctx.answerCallbackQuery();
}
```

**Auth:** `bot.use(auth)` runs before all handlers — including callback_query. Single-user gate at Telegram authorized user ID is preserved (verified: `src/bot/middleware/auth.ts` checks `ctx.from?.id === config.telegramAuthorizedUserId` for ALL update types, not just messages).

**Existing handler precedent** (verified `src/bot/handlers/document.ts` shape) — `export async function handleX(ctx): Promise<void>` with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` cast at registration site. Phase 27 mirrors.

---

## §3 — Per-dim metadata-jsonb staging + completion-gated wellbeing_snapshots write

**SQL pattern** (per D-27-05):

**Per-tap (partial state merge, atomic at Postgres column level):**

```sql
UPDATE ritual_responses
SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{partial,e}', $1::jsonb, true)
WHERE id = $2;
```

The 4th argument `true` to `jsonb_set` means "create the key if missing" — required because the first tap's `metadata.partial` doesn't exist yet. The full path `{partial,e}` (or `{partial,m}` / `{partial,a}` per dim) ensures the merge is per-column at the row level.

**Drizzle ORM equivalent** (verified `drizzle-orm@0.45.2` supports `sql` template tag for raw SQL in update():

```typescript
import { sql } from 'drizzle-orm';
await db.update(ritualResponses)
  .set({
    metadata: sql`jsonb_set(coalesce(${ritualResponses.metadata}, '{}'::jsonb), '{partial,${sql.raw(dim)}}', ${value}::jsonb, true)`,
  })
  .where(eq(ritualResponses.id, fireRowId));
```

(Planner verifies exact Drizzle syntax against existing `sql` usage in codebase — `src/episodic/sources.ts` has examples.)

**Completion-gated wellbeing_snapshots write (when all 3 dims captured):**

```typescript
import { sql } from 'drizzle-orm';
await db.insert(wellbeingSnapshots)
  .values({ snapshotDate: today, energy: partial.e, mood: partial.m, anxiety: partial.a })
  .onConflictDoUpdate({
    target: wellbeingSnapshots.snapshotDate,
    set: {
      energy: sql.raw('EXCLUDED.energy'),
      mood: sql.raw('EXCLUDED.mood'),
      anxiety: sql.raw('EXCLUDED.anxiety'),
    },
  });
```

This preserves WELL-02's "per-dim EXCLUDED" upsert contract — even though all 3 columns are written together, the conflict resolution is per-column referencing EXCLUDED.

**Date computation for `snapshot_date` column** — local Europe/Paris date via Luxon (per CONVENTIONS.md §Timezone Handling):

```typescript
import { DateTime } from 'luxon';
const today = DateTime.now().setZone(config.proactiveTimezone).toISODate(); // 'YYYY-MM-DD'
```

NEVER use `new Date().toISOString().slice(0, 10)` — that's UTC, off-by-1 around midnight Paris.

**Race-safety proof** (per D-27-05): the per-tap `jsonb_set` UPDATE is single-row atomic at Postgres row-lock level. Concurrent UPDATEs serialize. The completion-gated wellbeing_snapshots INSERT runs ONCE (only when the handler observes all 3 dims present in the just-merged metadata). Plan 27-03 writes a real-DB rapid-tap concurrency test (Promise.all of 3 callbacks against real Docker Postgres) asserting all 3 metadata.partial keys present after the merge.

---

## §4 — Anchor-bias defeat (two-pronged per D-27-04)

**Pitfall 11 attack surfaces** (research/PITFALLS.md:265-308):

1. Visible numeric history in keyboard ("yesterday: 4 highlighted").
2. Contextual narrative anchor in message body ("you've been low this week — how about today?").
3. Default-focus on prior tap value (cursor / highlight at last value).

**Phase 27 mitigations:**

| Surface | Mitigation | Implementation |
|---------|------------|----------------|
| Keyboard (1 + 3) | `fireWellbeing` reads ZERO data from `wellbeing_snapshots` and ZERO data from prior `ritual_responses` rows. Initial keyboard renders all 15 buttons as plain digits (no `[N]` highlights) | Mockable assertion: `expect(wellbeingSnapshotsSelectSpy).not.toHaveBeenCalled()` in `fireWellbeing` test |
| Message body (2) | Constant English prompt text (`Wellbeing snapshot — tap energy, mood, anxiety:`) with no numeric digits 1-5 in prose | grep-style assertion: rendered prompt text matches `/^Wellbeing snapshot — tap energy, mood, anxiety:$/` (no embedded numbers in prose) |
| Highlighting (today's selections only) | `[N]` ASCII for tapped values within current snapshot only; redrawn on each tap from `metadata.partial` (not from `wellbeing_snapshots`) | Test: handle one tap, assert rebuilt keyboard renders `[3]` only for the tapped dimension+value, `1`-`5` plain elsewhere |

**Reverse-anchor literature note:** Pitfall 11 also suggests reverse-anchor nudges ("today felt different — tap blind"). Per CONTEXT.md `<deferred>` block, this is v2.5 work — Phase 27 ships the simpler "no anchor at all" approach.

---

## §5 — Skip button outcome semantics + Phase 28 contract

**Phase 28 will consume `ritual_fire_events.outcome`** (text column, deliberately not enum-typed for forward-compat per Phase 25 schema.ts:461). Phase 27's wellbeing handler emits these outcomes:

| Outcome string | Trigger | Phase 28 treatment (forward) |
|----------------|---------|------------------------------|
| `'wellbeing_completed'` | All 3 dims captured (or completion happens via skip→cancel UI re-tap edge case) | "Responded" — RESETS skip_count |
| `'wellbeing_skipped'` | User taps skip button explicitly | NOT counted toward skip_count (per WELL-04 `adjustment_eligible: false`) |
| `'fired_no_response'` | 09:00 fire produces zero callbacks within window (Phase 28 sees this at next sweep tick when prior `ritual_responses` row has `responded_at IS NULL`) | INCREMENTS skip_count (toward 3-strikes daily threshold) |
| `'wellbeing_partial'` | Some dims captured but not all + window expired | Phase 28 may treat as `'fired_no_response'` (planner interaction with Phase 28 — for Phase 27 we just emit) |

**Note:** Phase 27 itself does NOT implement Phase 28's outcome-counting logic. Phase 27 just writes the right outcome string into `ritual_fire_events.outcome` after each handler run. Phase 28's skip-tracking module reads them and applies the threshold logic.

**Window expiration handling** is a Phase 28 concern — Phase 27's handler only fires on user callbacks; window-expiry is detected at the NEXT sweep tick by examining stale `ritual_pending_responses` rows or stale unresponded `ritual_responses` rows. Phase 27 does NOT need to schedule window-expiry timers.

**`ritual_responses.metadata` shape on skip:**
```json
{
  "message_id": 12345,
  "partial": { "e": 3 },
  "skipped": true,
  "adjustment_eligible": false
}
```

(`partial` may have 0-2 dims if skip was tapped mid-flow — captured as-is; doesn't write to `wellbeing_snapshots`.)

---

## §6 — Cron-tick alignment for 09:00 fire (per D-27-09)

**Existing cron registration shape** (verified `src/index.ts` after Phase 25):

```typescript
registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  runSync,
});
// Inside registerCrons (per Phase 25 Plan 03):
//   cron.schedule(config.proactiveSweepCron, runSweep, { timezone });        // 0 10 * * *
//   cron.schedule(config.ritualSweepCron, runRitualSweep, { timezone });     // 0 21 * * *
//   cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone }); // 0 23 * * *
//   cron.schedule(syncCron, runSync, { timezone });                          // every 6h
```

**`runSweep` already invokes `runRitualSweep`** — verified `src/proactive/sweep.ts:28` imports `runRitualSweep` from `../rituals/scheduler.js`. The morning 10:00 tick runs `runSweep` which (per Phase 25 Plan 03) inserts a ritual-channel call between accountability and reflective channels — calling `runRitualSweep`.

**At 10:00 Paris on day N:**

1. `cron.schedule(proactiveSweepCron, runSweep)` fires.
2. `runSweep` executes accountability + escalation + ritual channel + reflective.
3. Ritual channel calls `runRitualSweep(now)` where `now = 10:00 Paris`.
4. `runRitualSweep` SQL: `SELECT … FROM rituals WHERE enabled=true AND next_run_at <= $now LIMIT 1 ORDER BY next_run_at ASC`.
5. The `daily_wellbeing` row has `next_run_at = today 09:00 Paris` → 1h in the past → matches.
6. `tryFireRitualAtomic` claims the row + advances `next_run_at` to tomorrow 09:00 Paris (via `computeNextRunAt(now, 'daily', config)` — Luxon DST-safe).
7. `dispatchRitualHandler(ritual)` calls `fireWellbeing(ritual)` (Phase 27's edit replaces the throwing skeleton).
8. `fireWellbeing` sends the inline keyboard to Greg.

**`computeNextRunAt('daily', config={fire_at: '09:00', time_zone: 'Europe/Paris', ...})` math** (per Phase 25 cadence.ts):

```typescript
DateTime.fromJSDate(now).setZone('Europe/Paris').plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0 }).toUTC().toJSDate()
```

(Planner verifies exact Luxon helper semantics against Phase 25 implementation — but this is the proven shape.)

**Latency:** Greg receives the message at 10:00 Paris (sweep tick), not 09:00. Up to 60min latency from spec. Per Disagreement #1, this is the accepted M009 design tradeoff.

---

## §7 — Test architecture

### Plan 27-01 tests (`src/bot/__tests__/ritual-callback.test.ts`)

Mocked Grammy Context. Pure routing logic — no DB. Three test cases:

- Wellbeing prefix `r:w:e:3` → calls `handleWellbeingCallback(ctx, 'r:w:e:3')`.
- Unknown prefix `r:adj:accept` → silent `answerCallbackQuery()` + warn log.
- Unknown ritual prefix `r:xyz:foo` → silent `answerCallbackQuery()` + warn log.
- Empty `callbackQuery.data` → silent `answerCallbackQuery()`.

(Phase 28 + 29 will extend with their own prefix-handler branches.)

### Plan 27-02 tests (within wellbeing module — co-located TS unit tests)

- `parseRitualCallbackData` helper (extracts dim + value from `r:w:e:3`):
  - Valid: `r:w:e:3` → `{ kind: 'tap', dim: 'e', value: 3 }`
  - Valid: `r:w:skip` → `{ kind: 'skip' }`
  - Invalid: `r:w:e:6` → `{ kind: 'invalid' }` (out of 1-5 range)
  - Invalid: `r:w:x:3` → `{ kind: 'invalid' }` (unknown dim)
  - Invalid: `r:w:` → `{ kind: 'invalid' }` (no payload)
- Keyboard rebuild helper:
  - Empty partial state → all buttons plain
  - `partial = { e: 3 }` → row 1 button 3 rendered as `[3]`, all others plain
  - `partial = { e: 3, m: 4, a: 2 }` → row 1 button 3, row 2 button 4, row 3 button 2 all `[N]`-rendered

### Plan 27-03 tests (`src/rituals/__tests__/wellbeing.test.ts`) — REAL DB integration

Per D-27-10, real Docker Postgres on port 5433. Telegram API stubbed via minimal Grammy Context builder.

Test cases:

1. **Initial fire** — `fireWellbeing(ritual)` writes `ritual_responses` row with `metadata = { message_id, partial: {} }`, calls `bot.api.sendMessage` with the constant prompt + 4-row keyboard.
2. **Anchor-bias defeat (D-27-04 prong 1)** — assert `fireWellbeing` does NOT query `wellbeing_snapshots` (mock select spy on the table — assertion `expect(spy).not.toHaveBeenCalled()`).
3. **Anchor-bias defeat (D-27-04 prong 2)** — assert rendered prompt text contains no digits 1-5 in the prose body (regex `/[1-5]/.test(promptBody)` is false; the keyboard buttons separately contain digits but those are in `reply_markup`, not in `text`).
4. **Per-tap merge** — single tap `r:w:e:3` → `metadata.partial = { e: 3 }`; second tap `r:w:m:4` → `metadata.partial = { e: 3, m: 4 }`; etc.
5. **Rapid-tap concurrency (D-27-05 race-safety)** — `Promise.all([handle('r:w:e:3'), handle('r:w:m:4'), handle('r:w:a:2')])` → final `metadata.partial = { e: 3, m: 4, a: 2 }` (no key lost). Real DB.
6. **Completion-gated write** — third dim tap triggers `wellbeing_snapshots` insert with all 3 values + clears keyboard via `editMessageText`.
7. **Skip** — `r:w:skip` callback → `metadata.skipped = true + adjustment_eligible = false`, `responded_at = now()`, NO `wellbeing_snapshots` row written, keyboard cleared.
8. **Outcome emission** — completion writes `ritual_fire_events` row with `outcome = 'wellbeing_completed'`; skip writes `outcome = 'wellbeing_skipped'`.

### Plan 27-03 operator UAT script (`scripts/fire-wellbeing.ts`)

Mirrors `scripts/manual-sweep.ts` shape (Phase 25 D-07). ESM entry-point guard. Exits 0 on success. Hard-fails on missing DB.

```typescript
#!/usr/bin/env node
import { db } from '../src/db/connection.js';
import { rituals } from '../src/db/schema.js';
import { fireWellbeing } from '../src/rituals/wellbeing.js';
import { eq } from 'drizzle-orm';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  try {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.name, 'daily_wellbeing')).limit(1);
    if (!ritual) {
      console.error('No daily_wellbeing ritual seeded. Run migrations first.');
      process.exit(1);
    }
    await fireWellbeing(ritual);
    console.log('Fired daily_wellbeing — check Telegram for the keyboard.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'fire-wellbeing.error');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Migration 0008 seed insert | Database / Storage | — | Schema lives in Postgres; seed row is data |
| `src/rituals/wellbeing.ts fireWellbeing` | API / Backend (Process / Cron) | Bot / Telegram | Cron-context fire dispatcher; calls bot.api for Telegram side effect |
| `src/rituals/wellbeing.ts handleWellbeingCallback` | API / Backend (callback processor) | Database, Bot | Per-tap state merge + redraw + completion-gated write |
| `src/bot/handlers/ritual-callback.ts` | Bot / routing | — | Pure prefix-dispatch; no business logic |
| `src/bot/bot.ts` callback_query registration | Bot / routing | — | First inline-keyboard wiring in codebase |
| `dispatchRitualHandler` switch case wiring | API / Backend (Process / Cron) | — | Edits Phase 25's scheduler.ts to fill the wellbeing case |
| `scripts/fire-wellbeing.ts` operator wrapper | CLI / Scripts | API / Backend | Operator UAT tier |

**Tier-correctness sanity check:** Migration SQL, handler module, routing layer, scheduler wiring all occupy distinct correct tiers. The operator script reads from API tier without bypassing the handler.

---

## Standard Stack

### Core (already installed — zero version bumps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `grammy` | ^1.31.0 | `InlineKeyboard` + `bot.on('callback_query:data', handler)` + `ctx.editMessageReplyMarkup` / `ctx.editMessageText` / `ctx.answerCallbackQuery` | Already used for all Telegram interactions; v1.31 has stable inline keyboard surface (verified node_modules/grammy/out/convenience/keyboard.d.ts) |
| `drizzle-orm` | ^0.45.2 | `wellbeing_snapshots` insert via `.onConflictDoUpdate`; `ritual_responses` UPDATE with `sql\`jsonb_set(...)\`` raw; `eq()` predicate | Already used across 21 existing tables; M009 pattern is identical |
| `luxon` | ^3.7.2 | Local Europe/Paris date for `snapshot_date`; DST-safe per CONVENTIONS.md §Timezone Handling | Canonical pattern in `src/episodic/sources.ts` `dayBoundaryUtc` |
| `zod` | ^3.24.0 | (Re-exports `RitualConfigSchema` from Phase 25 — Phase 27 doesn't add new Zod schemas) | v3 is source-of-truth schema layer |

### Supporting (existing, used as-is)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` (logger) | (internal) | Structured logging via `src/utils/logger.ts` singleton | Every Phase 27 module: `logger.info({ ritualId, dim, value }, 'rituals.wellbeing.tap')` |
| `postgres` | ^3.4.5 | Low-level PG driver via `src/db/connection.ts` `sql` template tag | Used for raw `db.execute(sql\`...\`)` if Drizzle's `sql` template inside `.set()` proves awkward; verified existing `src/db/connection.ts` exports |
| `node-cron` | ^4.2.1 | NOT directly touched in Phase 27 — existing 10:00 morning sweep tick catches the 09:00 wellbeing fire (D-27-09) | Not in Phase 27 scope |
| `@anthropic-ai/sdk` | ^0.90.0 | NOT used in Phase 27 — wellbeing snapshot is structured numeric data, no LLM call needed | Not in Phase 27 scope |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `bot.on('callback_query:data', ...)` | `@grammyjs/menu` plugin | OOS-11 explicit anti-feature — single-turn keyboard doesn't need conversational state machine |
| `jsonb_set` per-tap merge | Read-modify-write at handler level | Read-modify-write opens a TOCTOU race (two concurrent handlers read same metadata, both merge, second clobbers first). jsonb_set is atomic at Postgres column level. Pick jsonb_set. |
| Completion-gated write to `wellbeing_snapshots` | Per-tap upsert with relaxed NOT NULL constraint | Per D-27-05, schema relaxation requires Phase 27 migration; completion-gated is cleaner (no schema churn, single atomic insert at completion). Pick completion-gated. |
| ASCII `[N]` for tap highlighting | Emoji 🔵 / ✅ | Emoji rendering inconsistent across Telegram clients (mobile vs web). ASCII is universal. Pick ASCII. |

**Installation:** None. Zero `package.json` diffs in Phase 27.

---

## Plan Sequencing Rationale

Per D-27-07, 3 plans in this order:

1. **Plan 27-01 (Callback router infrastructure)** — Wires `bot.on('callback_query:data', handleRitualCallback)` + creates dispatcher. NO ritual semantics. Independently mergeable; the dispatcher is a no-op against unknown prefixes (silent ack). Future Phase 28/29 prefix branches add to the dispatcher. **Wave 1.**
2. **Plan 27-02 (Wellbeing handler + seed migration, atomic per D-27-06)** — Migration 0008 + `src/rituals/wellbeing.ts` + dispatcher wiring in `src/rituals/scheduler.ts`. Depends on Plan 27-01's `handleRitualCallback` being wired. **Wave 2.**
3. **Plan 27-03 (Operator UAT + behavior tests)** — `scripts/fire-wellbeing.ts` + `src/rituals/__tests__/wellbeing.test.ts`. Depends on Plan 27-02's `fireWellbeing` export. **Wave 3.**

Sequential — each plan depends on the previous one's exports.

---

## Open Questions

None blocking — all resolved by D-27-01..D-27-10 lock decisions. The two minor open items left to planner discretion:

1. **Exact `outcome` string naming** (`'wellbeing_completed'` vs `'wellbeing_done'` etc.). Recommendation: `'wellbeing_completed'` for symmetry with `'wellbeing_skipped'`. Planner verifies against Phase 28's expected consumer shape if it can be foreseen; otherwise picks per recommendation.
2. **`metadata` jsonb shape for the `ritual_responses` row** — recommendation in CONTEXT.md `<Claude's Discretion>`. Planner picks final naming.

---

## Sources

- Direct codebase inspection (HIGH confidence):
  - `/home/claude/chris/src/bot/bot.ts` (existing handler registration shape; zero callback_query usage today)
  - `/home/claude/chris/src/bot/handlers/{document,sync,decisions,summary}.ts` (handler signature pattern: `export async function handleX(ctx)`)
  - `/home/claude/chris/src/bot/middleware/auth.ts` (auth middleware applies to ALL update types including callback_query)
  - `/home/claude/chris/src/rituals/scheduler.ts` (Phase 25 substrate; `dispatchRitualHandler` throws — Phase 27 fills `daily_wellbeing` case)
  - `/home/claude/chris/src/rituals/types.ts` (RitualConfigSchema 8 fields; Phase 27 reuses unchanged)
  - `/home/claude/chris/src/rituals/cadence.ts` (computeNextRunAt 3-arg signature per D-09)
  - `/home/claude/chris/src/rituals/idempotency.ts` (tryFireRitualAtomic — Phase 27 inherits race-safety transparently)
  - `/home/claude/chris/src/proactive/state.ts` (hasReachedRitualDailyCap + incrementRitualDailyCount — Phase 27 inherits)
  - `/home/claude/chris/src/db/schema.ts` (wellbeing_snapshots NOT NULL constraints on energy/mood/anxiety; ritual_responses metadata jsonb; ritual_fire_events outcome text column)
  - `/home/claude/chris/src/db/migrations/0006_rituals_wellbeing.sql` (Phase 25 migration shape — Phase 27 mirrors style for 0008)
  - `/home/claude/chris/scripts/manual-sweep.ts` (Phase 25 D-07 operator script template — Phase 27 mirrors for fire-wellbeing.ts)
  - `/home/claude/chris/src/episodic/sources.ts` (dayBoundaryUtc Luxon pattern for local Europe/Paris date)
  - `/home/claude/chris/.planning/codebase/CONVENTIONS.md` (ESM `.js` suffix, kebab-case files, SCREAMING_SNAKE_CASE constants, structured pino logging, no console.* in production)
  - `/home/claude/chris/.planning/codebase/ARCHITECTURE.md` (bot/ layer; current callback_query usage = none)
  - `/home/claude/chris/.planning/research/SUMMARY.md` (TS-4..TS-5c wellbeing scope; OOS-11 plugin exclusion; Disagreement #3 + #4 resolutions)
  - `/home/claude/chris/.planning/research/PITFALLS.md` (Pitfalls 10, 11, 12, 13)
  - `/home/claude/chris/.planning/research/ARCHITECTURE.md` §4 (`src/rituals/wellbeing.ts` module shape proposal)
  - `/home/claude/chris/.planning/phases/25-ritual-scheduling-foundation-process-gate/25-LEARNINGS.md` (real-DB-only for concurrency tests; honest-docstring grep-guard tension; FK schema.ts + DO-block hybrid)
  - `/home/claude/chris/.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` (D-04 channel cap, D-08 migration pattern, D-09 cadence signature)
- External docs (MEDIUM confidence):
  - [grammY InlineKeyboard reference](https://grammy.dev/ref/core/inlinekeyboard) — verified API shape
  - [grammY callback_query reference](https://grammy.dev/ref/types/callbackquery) — `data` field, 64-byte limit, `answerCallbackQuery` 30s discipline
  - PostgreSQL `jsonb_set` documentation — atomic per-column update at row-lock level (verified `pg_docs:jsonb-functions`)

---

*Research: Phase 27 Daily Wellbeing Snapshot*
*Conducted: 2026-04-26 (auto follow-up to discuss-phase --auto)*
