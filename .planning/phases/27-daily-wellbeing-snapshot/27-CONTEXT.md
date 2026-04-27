# Phase 27: Daily Wellbeing Snapshot — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults auto-selected for each gray area)

<domain>
## Phase Boundary

Phase 27 ships the **daily wellbeing snapshot** ritual end-to-end. After this phase, Greg gets a single Telegram message at 09:00 Europe/Paris with a 3-row × 5-button inline keyboard (energy / mood / anxiety, 1–5 each) plus a 4th-row skip button. Tapping individual buttons in any order updates `wellbeing_snapshots` per-dimension via `INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>` — no last-write-wins race when taps arrive within the same second. Partial state survives across taps via `ritual_responses.metadata` jsonb. Keyboard redraws on each tap with currently-tapped values HIGHLIGHTED but PREVIOUS DAYS' values HIDDEN (anchor-bias defeat per Pitfall 13). Tapping "skip" closes the snapshot with `adjustment_eligible: false` (does NOT trigger Phase 28 adjustment dialogue), distinct from a `fired_no_response` outcome a no-op produces.

**This is the first use of inline keyboards anywhere in the Chris codebase** — verified via grep at kickoff (zero existing `callback_query` / `InlineKeyboard` / `reply_markup` usage in `src/`). Phase 27 introduces the `bot.on('callback_query:data', handleRitualCallback)` router, the `src/bot/handlers/ritual-callback.ts` dispatch surface, and the `src/rituals/wellbeing.ts` fire+render module.

**In scope (5 requirements):**
- WELL-01 — Single Telegram message with 3-row × 5-button `InlineKeyboard` (energy / mood / anxiety, 1–5 each) + 4th-row skip button
- WELL-02 — `bot.on('callback_query:data', handleRitualCallback)` registered in `src/bot/bot.ts`; per-tap upsert via `INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>`
- WELL-03 — Partial state in `ritual_responses.metadata` jsonb survives across taps; keyboard redraw shows current selections HIGHLIGHTED + previous days HIDDEN (anchor-bias defeat)
- WELL-04 — Skip button (`adjustment_eligible: false`); does NOT trigger Phase 28 adjustment dialogue; distinct from `fired_no_response`
- WELL-05 — Default fire 09:00 Europe/Paris, configurable via `rituals.config.fire_at`; separate from voice note (21:00) per D026 + Pitfall 13

**Out of scope (deferred to later phases or upstream):**
- Voice note ritual + PP#5 ritual-response detector — Phase 26
- Skip-tracking + adjustment dialogue (Phase 28 consumer of `fired_no_response` outcome — Phase 27 emits the `responded`/`skipped` outcomes that feed it)
- Weekly review variance gate (TS-5c reads `wellbeing_snapshots` stddev — Phase 29 consumes Phase 27's writes; Phase 27 only ensures the schema + writes are correct)
- 14-day synthetic fixture exercising `simulateCallbackQuery` — Phase 30 (TEST-28)
- Single-composite (1-tap) wellbeing alternative — deferred to v2.5 if 30 days of real use shows 3-tap commitment is too high (per research SUMMARY DIFF)
- Optional 1-line "why" follow-up on extreme values (Pitfall 12 mitigation) — deferred to v2.5 (research SUMMARY DIFF)
- `notes` column population — schema column exists (Phase 25 RIT-02) but Phase 27 does not write it; future "why" prompt would (deferred)

</domain>

<decisions>
## Implementation Decisions

### Migration file naming + scope (D-27-01)

**D-27-01:** Phase 27's migration is **`0008_wellbeing_seed.sql`** — a single ritual-row seed for the `daily_wellbeing` ritual.

- **Numbering:** Phase 26 owns `0007_voice_note_seed.sql` (per Phase 26 sibling); Phase 27 takes the next slot `0008`. Phase 29 weekly-review seed will land as `0009`. (Phase 28 ships no migration — it's all logic against existing schema.)
- **Single statement, no DDL:** Just `INSERT INTO rituals (name, type, next_run_at, config) VALUES ('daily_wellbeing', 'daily', <next 09:00 Paris>, '{...8 fields…}'::jsonb) ON CONFLICT (name) DO NOTHING;`. Idempotent re-application via `ON CONFLICT (name) DO NOTHING` (uses the `rituals_name_unique` constraint shipped by Phase 25's migration 0006).
- **Seed config jsonb shape (RitualConfigSchema-conformant):**
  ```json
  {
    "fire_at": "09:00",
    "skip_threshold": 3,
    "mute_until": null,
    "time_zone": "Europe/Paris",
    "prompt_set_version": "v1",
    "schema_version": 1
  }
  ```
  Six of eight RitualConfigSchema named fields — `fire_dow` is omitted (not weekly cadence) and `prompt_bag` is omitted (not voice note). RitualConfigSchema treats both as `.optional()` so omission is valid (verified in `src/rituals/types.ts:46-48`).
- **`next_run_at` value at seed time:** Computed at migration time as the next 09:00 Europe/Paris instant after `now()` — so the first sweep tick after migration apply will fire it on schedule (not retroactively trigger the catch-up ceiling). Plan author writes the SQL using `(date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours' + CASE WHEN now() AT TIME ZONE 'Europe/Paris' >= date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours' THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Europe/Paris'` or equivalent. (Planner picks exact Postgres expression — there are 2-3 valid shapes.)
- **drizzle-kit snapshot regeneration:** Required (per Phase 25 D-08 pattern). Use `scripts/regen-snapshots.sh` clean-slate iterative replay against Docker Postgres on port 5434 (same pattern as 0006). The seed insert is idempotent SQL (no schema change) but the journal still tracks the migration file.
- **`scripts/test.sh` extension:** Add a psql line confirming `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'` returns `1` after migration apply. Mirrors the 6/1/3 substrate gate from Plan 25-01 in shape. (Phase 26's test.sh extension will assert `name='daily_voice_note'` — they coexist as peer assertions.)
- **Rejected — no migration, INSERT in app boot:** Considered seeding the ritual via a one-time idempotent `INSERT ON CONFLICT DO NOTHING` in `src/index.ts` startup. Rejected because (a) v2.2/v2.3 precedent is "schema + seeds via migration", (b) migration-based seeds give a clean rollback story, (c) startup-side seeds would have to handle the timezone-aware `next_run_at` computation in TypeScript, which adds a Luxon call to boot path for no benefit.
- **Rejected — combined 0008 with Phase 29's weekly seed:** Considered shipping `0008_wellbeing_and_weekly_seed.sql`. Rejected because Phases 27 + 29 are independent and parallel-eligible — coupling them would create a fake dependency. Each phase owns its own migration slot.

### Inline keyboard rendering: callback_data shape + redraw mechanism (D-27-02)

**D-27-02:** **Compact callback_data** `r:w:<dim>:<value>` (e.g., `r:w:e:3` for energy=3, `r:w:skip` for skip). **Edit-message-in-place on each tap** using `ctx.editMessageReplyMarkup` (NOT a new message). Telegram's 64-byte `callback_data` limit is comfortably honored (max payload ~10 bytes including delimiters).

- **Why compact prefix:** Telegram callback_data is hard-capped at 64 bytes per Bot API ([grammY callback_data ref](https://grammy.dev/ref/types/callbackquery)). The prefix `r:w:` (ritual:wellbeing) is namespacing for future ritual callback types — Phase 28's adjustment dialogue might add `r:adj:<accept|reject>` and Phase 29's weekly-review confirmation might add `r:wr:<ack>`. Single-letter dimension code (`e` / `m` / `a`) keeps the payload compact.
- **Why not include `fireRowId` in callback_data:** Phase 25 ARCHITECTURE.md §4 proposed `wb|<fireRowId>|<dim>|<value>` (37+ bytes). The fireRowId is unnecessary because **wellbeing snapshot is keyed on `snapshot_date`, not on a fire-row UUID** — the day's snapshot lives in `wellbeing_snapshots` row keyed by `snapshot_date UNIQUE` (RIT-02 + Phase 25 schema). The handler computes today's local Europe/Paris date and upserts. `ritual_responses` row is found by `WHERE ritual_id = (SELECT id FROM rituals WHERE name = 'daily_wellbeing') AND fired_at::date = $today` — single row per day per ritual.
- **Edit-in-place via `ctx.editMessageReplyMarkup`:** On each tap, the handler computes the new keyboard (with current selections highlighted) and calls `ctx.editMessageReplyMarkup({ reply_markup: rebuiltKeyboard })`. The message TEXT does not change (stays as the prompt). On completion (3rd dimension tapped or skip pressed), the handler calls `ctx.editMessageText(<final summary>)` with no `reply_markup` (clears the keyboard). This produces 4 Telegram round-trips total (3 tap edits + 1 final summary) — well under any rate ceiling for single-user.
- **Why not separate redraw + new message:** Sending a new message after each tap clutters the chat with 4-5 messages per snapshot. Single-message edit-in-place matches the spec's "single Telegram message" wording (WELL-01) and the research SUMMARY TS-5 / Pitfall 10 mitigation ("single message, inline edit on each tap").
- **Highlighted selection rendering:** Tapped values rendered as `[3]` (square brackets); untapped as plain `3`. Examples (energy=3 tapped, mood/anxiety untapped): row 1 `1 2 [3] 4 5`, row 2 `1 2 3 4 5`, row 3 `1 2 3 4 5`. Skip button stays as `Skip` until tapped (then snapshot closes — keyboard cleared). Square-bracket convention chosen because emoji highlighting (e.g., 🔵) introduces emoji-rendering inconsistency across Telegram clients (mobile vs web vs desktop). Plain ASCII `[N]` renders identically everywhere.
- **Rejected — Telegram message text shows running totals:** Considered embedding "Energy: 3, Mood: ?, Anxiety: ?" in the message text itself. Rejected because (a) it doubles the on-screen prose (the keyboard already shows `[3]`), (b) text edits on every tap is more bandwidth than reply_markup edits, (c) ARCHITECTURE.md §4 explored this and chose the keyboard-only approach.
- **Rejected — `@grammyjs/menu` plugin:** OOS-11 explicitly excludes `@grammyjs/menu` and `@grammyjs/conversations` plugins per research SUMMARY ("single-turn structured Haiku + stateless keyboard does not need them"). Phase 27 uses raw `InlineKeyboard` from `grammy` core.

### Skip button positioning + label text (D-27-03)

**D-27-03:** **Skip button is a 4th row, full-width, labeled `Skip`** (English only). Sends `r:w:skip` callback_data. On press: handler closes the snapshot (writes `responded_at = now()` on the `ritual_responses` row, sets `metadata.skipped = true` and `metadata.adjustment_eligible = false`), edits the message text to `Skipped wellbeing snapshot.` (English) and clears the keyboard. Does NOT increment `rituals.skip_count`. Does NOT emit a `fired_no_response` outcome.

- **Why English-only label:** This is a system UX label, not user-facing prose. M006 EN/FR/RU localization applies to Chris-generated message bodies (mode handlers, error fallbacks, polite voice decline) — not to inline keyboard button labels. Future localization can be added by reading `getLastUserLanguage()` and rendering `Skip` / `Passer` / `Пропустить`. Phase 27 ships English; future delta is ~5 LOC if/when needed.
- **Why row 4 (own row), not appended to row 3:** A 6-button row (1 2 3 4 5 + Skip) is harder to scan visually than a clean 5-button scale row + a separate skip action. Skip is a meta-action, not a value on the scale.
- **Adjustment-eligible flag in metadata:** `metadata: { skipped: true, adjustment_eligible: false }` written to the `ritual_responses` row. Phase 28's skip-tracking reads `ritual_fire_events.outcome` to count consecutive skips — wellbeing skip emits a NEW outcome value `'wellbeing_skipped'` (or planner picks `'skipped_user'` — Claude's discretion to align with Phase 28's outcome enum) that is EXPLICITLY NOT counted toward the 3-strikes threshold. Phase 28 reads the outcome union; the wellbeing-skip outcome is filtered out.
- **`fired_no_response` distinction (WELL-04):** A 09:00 fire that produces NO callback at all (Greg never taps) → at the next sweep tick, the prior day's `ritual_responses` row has `responded_at IS NULL` → emits `fired_no_response` outcome → Phase 28 increments skip_count toward 3-strikes. By contrast, an explicit skip-button tap → `responded_at = now()` + `metadata.skipped = true` → emits `wellbeing_skipped` outcome → Phase 28 sees a "responded" row and resets skip_count to 0. This is the distinct semantics WELL-04 mandates.

### Anchor-bias defeat: hide-previous-values implementation (D-27-04 — addresses Pitfall 13)

**D-27-04:** **Two-pronged hide-previous mechanism.**

Pronged because Pitfall 11 (anchor bias) operates on TWO surfaces — the keyboard itself, AND any prose context Chris might emit around it. Phase 27 must defeat both.

1. **Keyboard surface — keyboard NEVER quotes yesterday's tap values.** When `fireWellbeing` builds the keyboard for today's fire, it reads ZERO data from prior `wellbeing_snapshots` rows or prior `ritual_responses` metadata. The keyboard displays only TODAY's in-progress values (highlighted via `[N]`). Yesterday's energy=4 is invisible — there is no rendering path that surfaces it.
2. **Message text surface — fire prompt does NOT include any historical numeric reference.** The message body is constant: `Wellbeing snapshot — tap energy, mood, anxiety:` (or planner picks the exact prompt text — recommendation: keep it short, no historical reference). Specifically forbidden: any text like "yesterday you were 4 — how are you today?" or "energy trend: 4, 4, 3 — what about today?". The constant prompt is the no-anchor invariant.

- **Why two prongs and not just one:** Pitfall 11 cites three anchor surfaces — visible numeric history, contextual narrative ("you've been low"), and prior tap as default-focus. The keyboard surface (prong 1) defeats #1 + #3 (no default focus, no visible history). The message text (prong 2) defeats #2 (no narrative anchor). Both must hold.
- **Implementation simplicity:** Both prongs are negative requirements (don't render X). The fire handler reads zero data from `wellbeing_snapshots` and zero data from prior `ritual_responses` (other than today's in-progress row, which it owns). The "hide" is the absence of code, not added code.
- **Test:** Plan author writes a regression test asserting (a) `fireWellbeing` does not query `wellbeing_snapshots` (mock the table — assertion: `expect(wellbeingSnapshotsSelectSpy).not.toHaveBeenCalled()`), and (b) the rendered message text is the constant prompt with no numeric digits 1-5 inside the prose body (the keyboard buttons CONTAIN those digits — that's separate). Both assertions are simple grep-style guards.
- **Rejected — feature for "nudge if today is far from rolling average":** Pitfall 11 mitigation literature suggests reverse-anchor nudges. Rejected for v2.4 — adds complexity, requires aggregation queries, conflicts with the spec's frictionless-deposit contract. Revisit if real-data shows variance issues (Phase 29's variance gate is the production canary — TS-5c).
- **Rejected — randomize tap order display each day:** Pitfall 11 also suggests rotating dimension order ("today: anxiety→mood→energy; tomorrow: mood→energy→anxiety") to defeat top-down lock-in. Rejected for Phase 27 — the spec mandates 3 rows in fixed order (energy / mood / anxiety per WELL-01). Random rotation is a test-surface explosion (callback_data parser must handle any order, but the row identity changes per day) for a third-order anchor effect. Defer to v2.5 if Phase 29's variance gate fires.

### Per-dimension upsert SQL shape + idempotency contract (D-27-05)

**D-27-05:** **`INSERT INTO wellbeing_snapshots (snapshot_date, energy, mood, anxiety) VALUES ($date, $val, NULL, NULL) ON CONFLICT (snapshot_date) DO UPDATE SET energy = EXCLUDED.energy WHERE EXCLUDED.energy IS NOT NULL`** — one variant per dimension, with `EXCLUDED.<dim> IS NOT NULL` guard so partial taps don't NULL-out previously-tapped dimensions.

- **The race that this SQL prevents:** Greg taps energy=3 at t=12.000s, mood=4 at t=12.300s, anxiety=2 at t=12.600s — three callback handlers running concurrently. Without per-dimension upsert with NULL-guard, a naive `INSERT ON CONFLICT DO UPDATE SET energy=$e, mood=$m, anxiety=$a` race would have the energy handler insert `(date, 3, NULL, NULL)`, then the mood handler upsert `(date, NULL, 4, NULL)` — overwriting energy back to NULL. The per-dim variant with `WHERE EXCLUDED.<dim> IS NOT NULL` fixes this: each handler ONLY touches its own column.
- **Schema constraint awareness:** `wellbeing_snapshots` has CHECK constraints `energy/mood/anxiety BETWEEN 1 AND 5` AND NOT NULL on all three (per Phase 25 schema.ts:404-406). The NOT NULL constraint means **the very first tap will FAIL** if it tries to insert `(date, 3, NULL, NULL)` — Postgres rejects the row.
  - **Resolution:** The handler inserts a "shell row" with all three dimensions as a sentinel value at FIRST tap if no row exists yet. Two valid sentinel choices:
    - **Option A — Use 0 as sentinel + relax CHECK to `BETWEEN 0 AND 5`** (or `IS NULL OR BETWEEN 1 AND 5`). Requires a schema change in Phase 27's migration 0008 (ALTER CONSTRAINT). Reject — schema churn for a UX detail.
    - **Option B (CHOSEN) — Defer the wellbeing_snapshots write until ALL THREE dimensions tapped.** Partial state lives ONLY in `ritual_responses.metadata` jsonb (per WELL-03). When the handler sees `partial.e !== undefined && partial.m !== undefined && partial.a !== undefined`, it does ONE atomic insert of the complete row into `wellbeing_snapshots`. No per-dim upsert needed at all because partial state never touches `wellbeing_snapshots`.
  - **Plan implementation:** Adopt Option B. The "per-dimension upsert" language in WELL-02 is satisfied by the **idempotency contract** (re-tapping the same dimension overrides the prior partial value in `metadata.partial`); the actual `wellbeing_snapshots` write is a single atomic `INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET energy=EXCLUDED.energy, mood=EXCLUDED.mood, anxiety=EXCLUDED.anxiety` where ALL three columns are non-NULL (constructed from completed `metadata.partial`).
  - **Edge case — re-tap after completion:** If Greg taps a dimension AGAIN after completion (e.g., taps energy=4 after the snapshot is already complete with energy=3), the handler MUST update `wellbeing_snapshots` with the new value. The same `INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET energy=EXCLUDED.energy, mood=EXCLUDED.mood, anxiety=EXCLUDED.anxiety` (driven by full-state from `metadata.partial`) handles it correctly because all three values are still in metadata. **However**, after completion the keyboard is cleared (per D-27-02), so this edge case is theoretical — the user can't tap because there's no keyboard. Plan author MAY ignore this edge.
- **Concrete SQL (post-completion path):**
  ```sql
  INSERT INTO wellbeing_snapshots (snapshot_date, energy, mood, anxiety)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (snapshot_date) DO UPDATE
    SET energy = EXCLUDED.energy,
        mood = EXCLUDED.mood,
        anxiety = EXCLUDED.anxiety;
  ```
  Plus the discriminator: WELL-02 contract is satisfied because **the conflict-resolution strategy is per-column EXCLUDED reference, and the partial-state mechanism in `ritual_responses.metadata` ensures no row is written until all three dimensions have values.**
- **Race-safety proof:** Partial state writes (`UPDATE ritual_responses SET metadata = $merged WHERE id = $rowId`) are single-row Postgres UPDATEs — atomic. Two concurrent UPDATEs on the same row serialize at the row-lock level. The merge logic (`metadata.partial[dim] = value`) runs in TypeScript inside the handler — for a true race (two handlers reading the same partial state and both writing back merged versions), the second writer's merge would clobber the first's update. **Mitigation:** the handler uses optimistic-concurrency-style read-modify-write OR (simpler) a SQL-side jsonb merge `UPDATE … SET metadata = jsonb_set(metadata, '{partial,e}', '3'::jsonb)` which is atomic at the column level. Planner picks the SQL-side jsonb_set approach (eliminates the read-modify-write race entirely).
- **Rejected — single global UPSERT keyed on `snapshot_date` with all three columns nullable:** As above, rejected because the NOT NULL constraint on energy/mood/anxiety would block partial-row writes. The metadata-jsonb-staging approach is cleaner.

### Wellbeing seed migration vs handler co-location (D-27-06)

**D-27-06:** **Single plan ships migration 0008 + handler.** Phase 27's migration 0008 (the `daily_wellbeing` seed insert) lands in the SAME plan as the wellbeing handler module (`src/rituals/wellbeing.ts`) and the dispatcher wiring in `src/rituals/scheduler.ts`. Splitting them creates a runtime dispatch bug: if the seed lands without a handler, `dispatchRitualHandler` throws (Phase 25 skeleton); if the handler lands without the seed, no row exists for `runRitualSweep` to process.

- **Plan-split implication:** This forces a 3-plan structure with migration + handler in ONE plan. See D-27-07 below for the chosen split.
- **Rejected — separate migration plan + handler plan:** The migration is a 5-line idempotent INSERT and the handler is the meat of the phase. They are independently meaningless (the seed without the handler dispatches to a throwing skeleton, leaving Phase 25's "SKELETON dispatch — handlers throw" path active for `daily_wellbeing` rows). Atomic landing prevents the gap.

### Plan split structure (D-27-07)

**D-27-07:** **3 plans** for Phase 27, partitioned by surface area: (a) callback infrastructure (one-time wiring of bot + handler dispatcher, NO ritual semantics), (b) wellbeing handler + seed (the meat), (c) integration test + UAT.

- **Plan 27-01 (Callback router infrastructure):** Wire `bot.on('callback_query:data', handleRitualCallback)` in `src/bot/bot.ts`; create `src/bot/handlers/ritual-callback.ts` with the dispatch table (parses `r:w:*` for wellbeing, future-proofed for `r:adj:*` Phase 28 + `r:wr:*` Phase 29); add `ctx.answerCallbackQuery()` discipline (every callback must be acknowledged within 30s per Telegram contract or the loading spinner hangs); add unit test asserting unknown callback prefixes silently ack without crashing. **Requirements: WELL-01 (partial — keyboard wiring, button rendering deferred to 27-02), WELL-02 (partial — bot.on registration).** **No DB writes, no ritual semantics — pure routing layer.** **First inline keyboard surface in codebase.**

- **Plan 27-02 (Wellbeing handler + seed migration — atomic per D-27-06):** Migration `0008_wellbeing_seed.sql` (idempotent INSERT INTO rituals); drizzle-kit snapshot regen via `scripts/regen-snapshots.sh`; `scripts/test.sh` psql gate addition. New module `src/rituals/wellbeing.ts` exporting `fireWellbeing(ritual)` (sends initial inline keyboard + writes initial `ritual_responses` row with empty `metadata.partial: {}`) and `handleWellbeingCallback(ctx, dim, value)` (consumed by Plan 27-01's dispatcher; writes per-dim to `metadata.partial` via `jsonb_set`, redraws keyboard, finalizes wellbeing_snapshot row when all 3 dims captured, handles skip). Wires `daily_wellbeing` case into `dispatchRitualHandler` switch in `src/rituals/scheduler.ts` (replaces the throwing skeleton for this ritual; voice note + weekly review remain skeleton until their own phases). **Requirements: WELL-01, WELL-02, WELL-03, WELL-04, WELL-05.** **All 5 requirements terminal here.**

- **Plan 27-03 (Operator UAT script + co-located behavior tests):** `scripts/fire-wellbeing.ts` operator script (NEW thin wrapper, mirrors `scripts/manual-sweep.ts` shape from Plan 25-03) — invokes `fireWellbeing` directly against live DB connection so operator can test the keyboard rendering against real Telegram without waiting for 09:00 cron. Co-located behavior tests in `src/rituals/__tests__/wellbeing.test.ts` covering: (a) initial fire writes ritual_responses row with empty partial state + sends inline keyboard with no anchor-bias surfaces (D-27-04 prong tests), (b) per-dim callback updates `metadata.partial` via jsonb_set without overwriting other dims (rapid-tap concurrency test, D-27-05), (c) third-tap completion writes `wellbeing_snapshots` row with all 3 values + clears keyboard, (d) skip button writes `metadata.skipped=true + adjustment_eligible=false` + clears keyboard + does NOT increment skip_count, (e) idempotency — second fire on same day finds existing in-progress `ritual_responses` row and either resumes OR creates new (planner picks; recommended: create new — simpler; same-day dual fires are theoretical given the partial-index sweep gate). **Requirements: integration coverage for WELL-01..05.** No new requirements but UAT closure for the phase.

- **Rejected — 2 plans (combine 27-01 + 27-02):** Bundling the callback router infrastructure with the wellbeing handler is tempting (single integration plan) but creates a code-review surface that's hard to scan: ~400 LOC in one plan mixing pure routing wiring with stateful handler logic. Splitting at the routing/semantics boundary keeps each plan focused.
- **Rejected — 4 plans (separate seed migration from handler):** Violates D-27-06 atomicity requirement (seed without handler dispatches to throwing skeleton).

### Localization scope for Phase 27 (D-27-08)

**D-27-08:** **English only for v2.4.** Inline keyboard button labels (`1`, `2`, `3`, `4`, `5`, `Skip`), the fire prompt text (`Wellbeing snapshot — tap energy, mood, anxiety:`), and the completion confirmation (`Logged: energy 3, mood 4, anxiety 2.` or similar) all ship in English. M006 EN/FR/RU localization applies to mode-handler prose — not to system UX labels.

- **Rationale:** Phase 26's voice note polite-decline IS localized (because it's a user-facing apology message, EN/FR/RU per `franc`). Phase 27's wellbeing UX is a structured form, not prose. Following Phase 22's `/summary` localization scope (Russian/French data labels stayed English in v2.2 per M008 D-?? — need planner to verify exact precedent in `src/bot/handlers/summary.ts`).
- **Future work:** If Greg requests French/Russian button labels, ~5 LOC delta — read `getLastUserLanguage()`, branch on `Skip`/`Passer`/`Пропустить`. Defer.

### Cron-tick alignment for 09:00 fire (D-27-09)

**D-27-09:** **Morning 10:00 sweep tick catches the 09:00 wellbeing fire.** No new cron registration needed.

- **Rationale:** Phase 25 ships two cron ticks: 10:00 morning (proactive sweep) + 21:00 evening (ritual sweep, D-27-09 makes them peers). Phase 27's wellbeing has `next_run_at` set to the next 09:00 Paris instant after migration apply. The 10:00 sweep tick runs `runRitualSweep` which selects `WHERE next_run_at <= now()` — at 10:00 Paris on day N, the wellbeing's 09:00 next_run_at is one hour in the past, so it fires. After firing, `computeNextRunAt` advances next_run_at to the next day's 09:00 (Luxon `setZone(tz).set({ hour: 9 }).plus({ days: 1 })` — DST-safe per Phase 25 cadence helper).
- **One-hour latency tradeoff:** The 09:00 fire actually fires at 10:00 (after the morning sweep tick). Greg gets the message at 10:00, not 09:00. Per research SUMMARY Disagreement #1 ("Tradeoff accepted: Non-default `fire_at` settings (e.g., 14:30) would be up to 6h late. M009's three rituals all align with 10:00 or 21:00 ticks."), this is the accepted M009 design. WELL-05 spec says "Default fire 09:00 Europe/Paris" — the practical fire time is 10:00 within ±60min, which is within the spec spirit (morning, before-day-narrative-pollution per Pitfall 13). Greg can `RITUAL_SWEEP_CRON=0 9 * * *` to add a third tick at 09:00 if exact timing matters; not in Phase 27 scope.
- **Rejected — third cron tick at 09:00:** Adds infra without benefit for v2.4 (per Disagreement #1 deferral). Revisit when a future ritual genuinely needs precise non-21:00/non-10:00 timing.

### Test approach for Plan 27-02's behavior tests (D-27-10)

**D-27-10:** **Real DB integration tests using Docker Postgres on port 5433** (the running test instance, NOT regen-snapshots' port 5434). No mocking of `wellbeing_snapshots` or `ritual_responses` writes. Telegram API calls (`bot.api.sendMessage`, `ctx.editMessageReplyMarkup`) are stubbed via a minimal Grammy `Context` stub builder — the chosen pattern is described in Phase 25 LEARNINGS as "real-DB pattern from `src/rituals/__tests__/idempotency.test.ts`".

- **Why real DB:** Per Phase 25 LEARNINGS lesson "Postgres concurrent-update semantics must be tested with REAL postgres, not mocks" — D-27-05's per-dim `jsonb_set` upsert correctness depends on Postgres-level row-lock + jsonb merge semantics. A mocked DB would silently pass broken concurrency code. Plan author writes the rapid-tap concurrency test as `Promise.all([handleWellbeingCallback(ctx, 'e', 3), handleWellbeingCallback(ctx, 'm', 4), handleWellbeingCallback(ctx, 'a', 2)])` against real Docker Postgres and asserts the resulting `ritual_responses.metadata.partial` has all three keys present (no overwrites).
- **Telegram stub shape:** `buildMockContext({ chatId, messageId, callbackData })` returns a `{ callbackQuery: { data, message: { message_id } }, editMessageReplyMarkup: vi.fn(), editMessageText: vi.fn(), answerCallbackQuery: vi.fn() }` shape sufficient for the handler's `ctx.*` usage. Mirrors the test-helper pattern from `src/bot/__tests__/`. (Planner verifies exact shape against existing patterns.)
- **Rejected — fully-mocked test using `vi.mock` of `src/db/connection.ts`:** Phase 25 LEARNINGS lesson "state.test.ts is a fully-mocked file; new persistence helpers need a peer real-DB test file" applies — fully-mocked tests for SQL-level race semantics are tautological.

### Claude's Discretion

- **Exact `outcome` enum values** — Phase 27 emits new outcome strings into `ritual_fire_events.outcome` (`text NOT NULL` per Phase 25 schema.ts:461, deliberately not enum-typed for forward-compat). Recommended: `'wellbeing_completed'` (all 3 dims captured), `'wellbeing_skipped'` (skip button), `'wellbeing_partial'` (some dims captured but not all + window expired — Phase 28 may treat as `fired_no_response`). Planner picks final names per Phase 28's expected consumer shape.
- **Exact `ritual_responses.metadata` jsonb shape:** Recommended `{ message_id: <number>, partial: { e?: number, m?: number, a?: number }, completed: boolean, skipped: boolean, adjustment_eligible: boolean }`. Planner picks final field naming.
- **Exact button labels for the 5 numeric buttons** — recommendation: `1` `2` `3` `4` `5` plain text. Optional: prefix the first row with `Energy:` (e.g., `Energy: 1` / `2` / `3` / `4` / `5`) so the row context is visible. Planner picks based on Telegram visual layout; recommendation is minimal text per button so they fit on narrow phone screens.
- **Operator script (`scripts/fire-wellbeing.ts`) JSON output schema** — pretty-printed result of `fireWellbeing` invocation. Planner picks reasonable shape based on what `fireWellbeing` returns.
- **Test file location** — `src/rituals/__tests__/wellbeing.test.ts` per existing convention.
- **Whether to extract a `src/rituals/wellbeing-state.ts` helper module** for the metadata-jsonb merge logic vs co-locating in `wellbeing.ts` — planner chooses. Recommendation: co-locate; the helper is ~20 LOC.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research (the bedrock for Phase 27)

- `.planning/research/SUMMARY.md` — Executive summary, recommended stack (no new deps), expected features, architecture, top 5 pitfalls, all 7 HARD CO-LOCATION constraints, resolved disagreements (esp. #3 keep 3 dimensions + #4 separate fire times). **Read first.**
- `.planning/research/PITFALLS.md` — Particularly Pitfall 10 (tap fatigue), Pitfall 11 (anchor bias HIGH severity), Pitfall 12 (numeric without context), Pitfall 13 (wellbeing/voice-note conflation).
- `.planning/research/ARCHITECTURE.md` §4 — `src/rituals/wellbeing.ts` fire-side + `src/bot/handlers/ritual-callback.ts` dispatcher + partial-state lifecycle. **First-time use of inline keyboards in this codebase confirmed via grep.**
- `.planning/research/STACK.md` — Grammy 1.31 InlineKeyboard surface; OOS-11 explicitly excludes `@grammyjs/menu` and `@grammyjs/conversations`.
- `.planning/research/FEATURES.md` — TS-4..TS-5c wellbeing requirements.

### Roadmap + requirements

- `.planning/ROADMAP.md` §Phase 27 — Goal, requirements list, 4 success criteria. **Authoritative scope.**
- `.planning/REQUIREMENTS.md` — WELL-01..05 verbatim.
- `.planning/STATE.md` — Current position; **D026 (wellbeing separate from voice note)** is critical here; "Spec interpretations locked" #1 (09:00 Paris fire).

### Project plan + decisions

- `PLAN.md` — Project Chris implementation plan; Key Decisions D026 (wellbeing separate from voice note), D031 (boundary-marker convention), D041 (primed-fixture pipeline).

### Phase 25 substrate (Phase 27 reads these — DO NOT modify)

- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` — D-04 (3/day channel ceiling), D-09 (3-arg cadence signature), D-08 (drizzle-kit-vs-hand-SQL pattern).
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-RESEARCH.md` §1 (migration SQL shape), §6 (atomic UPDATE pattern).
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-LEARNINGS.md` — Hand-author SQL + drizzle-snapshot hybrid pattern; honest-docstring grep-guard tension; real-DB-only for concurrency tests.
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-01-PLAN.md` — Migration 0006 shape (Phase 27 mirrors style for 0008).
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-03-PLAN.md` — `runRitualSweep` orchestrator, `dispatchRitualHandler` skeleton (Phase 27 fills `daily_wellbeing` case).

### Codebase intel (subset relevant to Phase 27)

- `.planning/codebase/ARCHITECTURE.md` — Bot layer; current `bot.callbackQuery` usage = NONE (verified via grep).
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict ESM, `.js` suffix imports, 2-space, no path aliases, kebab-case files, SCREAMING_SNAKE_CASE constants, box-drawing section dividers >100 lines, structured pino logging, no `console.*`, fire-and-forget side effects discipline.
- `.planning/codebase/STACK.md` — Grammy 1.31 (InlineKeyboard ready); zero version bumps.
- `.planning/codebase/TESTING.md` — Existing vitest patterns; primed-fixture pipeline §; `scripts/test.sh` Docker postgres harness; vitest-4 fork-IPC hang under HuggingFace EACCES env-level issue (Phase 27's new `src/rituals/__tests__/wellbeing.test.ts` must not trigger).

### Source files Phase 27 reads or modifies (full paths)

- `src/bot/bot.ts` — Add `bot.on('callback_query:data', handleRitualCallback)` (Plan 27-01). FIRST use of `bot.on('callback_query:*')` in codebase.
- `src/bot/handlers/ritual-callback.ts` — NEW file (Plan 27-01). Dispatcher prefix-matches `r:w:*` (wellbeing), future-proofed for `r:adj:*` + `r:wr:*`. Calls `handleWellbeingCallback` from `src/rituals/wellbeing.ts`.
- `src/rituals/wellbeing.ts` — NEW file (Plan 27-02). Exports `fireWellbeing(ritual)` (initial keyboard send) + `handleWellbeingCallback(ctx, dim, value)` (per-tap update + redraw + completion).
- `src/rituals/scheduler.ts` — EDIT `dispatchRitualHandler` switch (Plan 27-02). Replace `daily_wellbeing` case skeleton with `await fireWellbeing(ritual)`. Voice note + weekly review cases stay skeleton until Phases 26/29.
- `src/db/migrations/0008_wellbeing_seed.sql` — NEW file (Plan 27-02). Idempotent INSERT INTO rituals.
- `src/db/migrations/meta/_journal.json` + new `meta/0008_snapshot.json` — regenerated via `scripts/regen-snapshots.sh` (Plan 27-02). NOT hand-edited.
- `src/db/schema.ts` — UNCHANGED (no schema additions in Phase 27; wellbeing_snapshots + ritual_responses + ritual_fire_events all exist from Phase 25).
- `scripts/test.sh` — Add psql gate `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'` returns `1` (Plan 27-02).
- `scripts/fire-wellbeing.ts` — NEW operator script (Plan 27-03). Mirrors `scripts/manual-sweep.ts` pattern.
- `src/rituals/__tests__/wellbeing.test.ts` — NEW behavior tests (Plan 27-03). Real DB.
- `src/bot/__tests__/ritual-callback.test.ts` — NEW routing tests (Plan 27-01). Mocked Telegram context.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/rituals/scheduler.ts dispatchRitualHandler`** (Phase 25, throwing skeleton) — Phase 27 fills the `daily_wellbeing` case with `await fireWellbeing(ritual)`. Voice note + weekly review remain `throw new Error('not implemented')` until Phases 26/29. This is intentional substrate handover (Phase 25 D-27-06 pattern).
- **`src/rituals/types.ts RitualConfigSchema`** (Phase 25, RIT-07) — Phase 27 uses unchanged. Wellbeing's seed config is RitualConfigSchema-conformant (6 of 8 fields populated; `fire_dow` + `prompt_bag` omitted as optional).
- **`src/proactive/state.ts hasReachedRitualDailyCap` + `incrementRitualDailyCount`** (Phase 25 D-04 refinement) — Phase 27 inherits transparently. The 09:00 wellbeing fire counts toward the 3/day channel ceiling alongside the 21:00 voice note (Phase 26) + Sunday 20:00 weekly review (Phase 29) — exactly the worst case the 3/day cap was sized for.
- **`scripts/manual-sweep.ts`** (Phase 25 D-07) — Pattern template for `scripts/fire-wellbeing.ts`. ESM entry-point guard, no try/finally cleanup, hard-fails on missing DB connection.
- **`src/episodic/sources.ts dayBoundaryUtc` Luxon pattern** — Phase 27's `formatLocalDate(now, 'Europe/Paris')` for the `snapshot_date` column inherits this DST-safe approach. NEVER use `new Date().toISOString().slice(0,10)` (UTC date, off-by-1 around midnight Paris).
- **`scripts/regen-snapshots.sh` clean-slate replay** (proven in v2.1 Phase 19, v2.2, v2.3, v2.4 Phase 25) — Plan 27-02 invokes for migration 0008 snapshot regen. Documented Docker port-5434 friction from Phase 25 LEARNINGS still applies (workaround: `docker compose down` test postgres before regen).
- **Phase 25 atomic UPDATE...RETURNING idempotency (`tryFireRitualAtomic`)** — Already runs in `runRitualSweep` BEFORE Phase 27's `dispatchRitualHandler` invocation. Means `fireWellbeing` is called ONCE per fire even under concurrent sweep ticks — Phase 27 inherits idempotency for free.

### Established Patterns

- **`.js` suffix on every internal import** — non-negotiable (CONVENTIONS.md). Grammy/Drizzle/Luxon stay bare.
- **SCREAMING_SNAKE_CASE for tunables** — `WELLBEING_PROMPT_TEXT`, `RITUAL_CALLBACK_PREFIX = 'r:w:'`, `WELLBEING_SKIP_LABEL = 'Skip'` etc. Lives at top of the module that owns the constant.
- **Box-drawing section dividers for modules >100 lines** — `src/rituals/wellbeing.ts` likely crosses 100 lines (fire + render + per-tap + completion + skip = ~150 LOC). Mirror the `// ── Section ─────` form from `src/episodic/sources.ts`.
- **Test files co-located** in `__tests__/<module>.test.ts` next to the source.
- **Migration files hand-audited SQL** with idempotency guards (DO blocks for FK, IF NOT EXISTS for tables, ON CONFLICT for seed inserts) per Phase 25 LEARNINGS.
- **Structured pino logging** — `logger.info({ ritualId, dim, value }, 'rituals.wellbeing.tap')`; `logger.info({ ritualId, snapshotDate }, 'rituals.wellbeing.completed')`; `logger.info({ ritualId }, 'rituals.wellbeing.skipped')`.
- **No console.\*** in production code. Scripts may use console.
- **Drizzle row types via `$inferSelect`** for DB row shapes.

### Integration Points

- **`src/bot/bot.ts`** — Phase 27 adds `bot.on('callback_query:data', handleRitualCallback)`. **FIRST inline-keyboard wiring in codebase.** Order: registers AFTER existing `bot.command('sync'/'decisions'/'summary')` and AFTER `bot.on('message:text', handleTextMessage)` and `bot.on('message:document', handleDocument)`. Grammy's router is FIFO-by-registration for non-overlapping update types — callback_query is its own type, so order vs message:text doesn't matter, but new registration goes at end of file before `bot.catch`.
- **`src/rituals/scheduler.ts dispatchRitualHandler`** — Phase 27 fills the `daily_wellbeing` case. The function signature (`(ritual: typeof rituals.$inferSelect): Promise<void>`) is set by Phase 25; Phase 27 conforms.
- **`src/db/migrations/`** — Phase 27 adds `0008_wellbeing_seed.sql`. Phase 26 owns `0007_voice_note_seed.sql`. Migration filename ordering (lexicographic) matches phase ordering — Phase 26 lands first by phase number, but migration journal tracks them independently and they're independent (no FK between voice note and wellbeing seeds).
- **`src/proactive/state.ts`** — Phase 27 inherits `hasReachedRitualDailyCap` + `incrementRitualDailyCount` (Phase 25 D-04 refinement) — no edits.

</code_context>

<specifics>
## Specific Ideas

- **Migration file name:** `0008_wellbeing_seed.sql`. Single statement: `INSERT INTO rituals (name, type, next_run_at, config) VALUES ('daily_wellbeing', 'daily', <next 09:00 Paris>, '{...8-field RitualConfig…}'::jsonb) ON CONFLICT (name) DO NOTHING;`.
- **Ritual `name` value:** Exactly `'daily_wellbeing'` (snake_case, matches the convention spelled in Phase 25 D-04 commentary and ROADMAP success criteria).
- **callback_data prefix:** `r:w:` (ritual:wellbeing). Format: `r:w:e:3` / `r:w:m:4` / `r:w:a:2` / `r:w:skip`. Total bytes: ≤ 10 (well under Telegram's 64-byte cap).
- **Inline keyboard layout:**
  ```
  Row 1 (Energy):    1   2   3   4   5
  Row 2 (Mood):      1   2   3   4   5
  Row 3 (Anxiety):   1   2   3   4   5
  Row 4 (Skip):              Skip
  ```
  Tapped values rendered as `[N]`. (Optional first-button label per row: `Energy: 1` etc. — planner picks.)
- **Fire prompt text:** `Wellbeing snapshot — tap energy, mood, anxiety:` (English, no historical reference, anchor-bias-clean per D-27-04).
- **Completion text:** `Logged: energy 3, mood 4, anxiety 2.` (after all 3 tapped — keyboard cleared).
- **Skip text:** `Skipped wellbeing snapshot.` (keyboard cleared).
- **`metadata.partial` jsonb path:** `{e: number, m: number, a: number}` — short keys keep jsonb_set paths short and the row metadata under 1KB.
- **`outcome` strings emitted to ritual_fire_events.outcome:** `'wellbeing_completed'` (3 dims captured), `'wellbeing_skipped'` (skip button), `'wellbeing_partial'` (Phase 28 sees this if window expires with partial state — separate from `fired_no_response` which means zero taps).
- **Per-dim jsonb_set SQL (atomic update path):**
  ```sql
  UPDATE ritual_responses
  SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{partial,e}', '3'::jsonb)
  WHERE id = $1;
  ```
- **Final wellbeing_snapshots insert (post-completion):**
  ```sql
  INSERT INTO wellbeing_snapshots (snapshot_date, energy, mood, anxiety)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (snapshot_date) DO UPDATE
    SET energy = EXCLUDED.energy, mood = EXCLUDED.mood, anxiety = EXCLUDED.anxiety;
  ```
- **`scripts/fire-wellbeing.ts` invocation shape:** `npx tsx scripts/fire-wellbeing.ts` — no args. Looks up `daily_wellbeing` ritual row, calls `fireWellbeing(ritual)`. Prints chosen prompt text + `ritual_responses.id` to stdout. Operator then taps buttons in real Telegram to complete.

</specifics>

<deferred>
## Deferred Ideas

- **Single-composite (1-tap) wellbeing alternative** — Pitfall 10 mitigation if 3-tap commitment proves too high after 30 days of real use. Defer to v2.5 per research SUMMARY DIFF.
- **Optional 1-line "why" follow-up on extreme values (1 or 5 only)** — Pitfall 12 mitigation. Defer to v2.5; would populate the existing `wellbeing_snapshots.notes` text column.
- **Reverse-anchor nudges** ("today felt different — tap blind"): defer to v2.5 if Phase 29's variance gate (TS-5c) fires consistently.
- **Random dimension order each day** (defeat top-down lock-in per Pitfall 11): defer to v2.5; minor third-order anchor effect; spec mandates fixed energy/mood/anxiety order.
- **EN/FR/RU localization of button labels + prompts** (D-27-08) — defer until Greg requests.
- **Third cron tick at exactly 09:00** for sub-hour timing accuracy (D-27-09) — defer until needed.
- **DIFF-2 Wellbeing trajectory in weekly observation** (third source for weekly review observation alongside summaries + decisions) — defer to v2.5 per research SUMMARY.
- **Profile inference downstream of wellbeing** (M010+): not in M009 scope; Phase 27 just lays the data substrate.
- **Wellbeing data export / `/wellbeing` query command** — operator-facing read of `wellbeing_snapshots`. Defer; M013 may revisit.

</deferred>

<ui_design>
## UI Design Hint Resolution

**UI hint flagged in roadmap:** yes. **Decision: skip UI-SPEC.md gate.**

Rationale: This is a Telegram inline-keyboard surface, not a web UI. The "design contract" is essentially:
- 4-row keyboard (3 dimension rows × 5 buttons + 1 skip row × 1 button)
- ASCII `[N]` highlighting (no emoji)
- Constant English prompt text
- Edit-in-place on each tap
- Final summary text + cleared keyboard on completion

All five points are captured in D-27-02 (callback_data + redraw mechanism), D-27-03 (skip button positioning), D-27-04 (anchor-bias defeat), and D-27-08 (English-only labels). UI-SPEC.md would add ceremony without surface area beyond what the decisions block already locks. The keyboard layout is fixed by spec WELL-01 (3 rows × 5 buttons).

If during planning a designer wants visual mockups (Telegram screenshot rendering), planner can spawn `/gsd-ui-phase` ad hoc — but it's not gated as a prerequisite.

</ui_design>

---

*Phase: 27-Daily Wellbeing Snapshot*
*Context gathered: 2026-04-26*
