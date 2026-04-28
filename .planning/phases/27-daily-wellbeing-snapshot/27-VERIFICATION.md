---
phase: 27-daily-wellbeing-snapshot
verified: 2026-04-28T17:23:07Z
status: human_needed
score: 5/5 must-haves verified (programmatic) — 4/4 ROADMAP success criteria require human Telegram UAT
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Operator-fired wellbeing keyboard renders correctly in real Telegram (4-row layout: 3 dim rows × 5 buttons + 1 skip row × 1 button)"
    expected: "Run `npx tsx scripts/fire-wellbeing.ts` against staging Telegram bot. Greg's chat receives one message: prompt text 'Wellbeing snapshot — tap energy, mood, anxiety:' followed by inline keyboard with 4 rows. Row 1-3 each show buttons '1' '2' '3' '4' '5'. Row 4 shows single 'Skip' button. No anchor text, no historical references."
    why_human: "Visual rendering of inline keyboard across Telegram clients (mobile/web/desktop) cannot be verified programmatically — Test 1 asserts the data shape but not the actual Telegram chat appearance."
  - test: "Tap-redraw behavior — keyboard updates with [N] highlights as Greg taps; previous days' values invisible"
    expected: "After firing, tap energy=3 → row 1 redraws as `1 2 [3] 4 5`. Tap mood=4 → row 2 redraws as `1 2 3 [4] 5` (row 1 retains [3]). Tap anxiety=2 → message edits to 'Logged: energy 3, mood 4, anxiety 2.' with cleared keyboard. Previous days' wellbeing values must NEVER appear as bracketed defaults — keyboard always starts blank for the new day's fire."
    why_human: "Real-time edit-in-place via ctx.editMessageReplyMarkup is a Telegram client behavior; only human observation confirms the redraw is responsive and that the [N] highlight visually scans correctly."
  - test: "Skip button behavior end-to-end — distinct from no-response"
    expected: "After firing, tap 'Skip' button. Message edits to 'Skipped wellbeing snapshot.' with cleared keyboard. DB inspection: `ritual_responses.metadata = { skipped: true, adjustment_eligible: false }`, `ritual_fire_events.outcome = 'wellbeing_skipped'`, `rituals.skip_count` UNCHANGED from before-fire value (Phase 28 will not count this toward 3-strikes). Subsequent day's fire works normally."
    why_human: "End-to-end skip flow with real Telegram interaction. Test 7 covers the DB invariants but the actual button-tap propagation through Grammy's webhook to handleRitualCallback to handleSkip needs human validation."
  - test: "09:00 Paris fire timing — separate from 21:00 voice note"
    expected: "On the morning after migration apply, the 10:00 Paris sweep tick (Phase 25 cron) picks up the daily_wellbeing ritual whose next_run_at is 09:00 Paris that day. Greg receives the wellbeing keyboard. Same evening, the 21:00 sweep tick fires the daily_voice_note ritual independently. Both rituals can fire on the same day; neither blocks the other (D026 spirit + Pitfall 13)."
    why_human: "Cron-tick timing requires waiting for real clock advancement OR a long-running staging environment. Cannot be programmatically verified without simulating cron ticks; D-27-09 explicitly notes 1-hour latency (09:00 fire actually fires at 10:00) is acceptable."
---

# Phase 27: Daily Wellbeing Snapshot — Verification Report

**Phase Goal (from ROADMAP.md):** "Independent of Phase 26 (orthogonal callback_query surface). After this phase, Greg gets a 09:00 Paris morning Telegram message with a 3-row × 5-button inline keyboard (energy / mood / anxiety), taps three numbers OR taps "skip", and the snapshot is durably persisted in `wellbeing_snapshots` with one row per local day. **First use of inline keyboards anywhere in the Chris codebase.**"

**Verified:** 2026-04-28T17:23:07Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                        | Status     | Evidence                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First inline-keyboard surface wired in the codebase (`bot.on('callback_query:data', handleRitualCallback)`)  | VERIFIED   | `src/bot/bot.ts:91` registers callback_query:data with handleRitualCallback as any. `src/bot/handlers/ritual-callback.ts` exports handleRitualCallback (75 LOC). Auth precedes registration (line 22 vs 91). |
| 2   | Inline keyboard renders 3 dim rows × 5 buttons + 1 skip row (4 rows total, WELL-01)                          | VERIFIED   | `src/rituals/wellbeing.ts:351-363` `buildKeyboard` iterates `DIMS = ['e','m','a']` × val=1..5 with `kb.row()` after each, then appends single Skip button. Test 1 asserts inline_keyboard length = 4 with rows[0..2].length=5 and rows[3].length=1. PASSED. |
| 3   | Per-tap merge into ritual_responses.metadata.partial via atomic jsonb_set (WELL-02 + WELL-03)                | VERIFIED   | `src/rituals/wellbeing.ts:228-232` `db.update(ritualResponses).set({ metadata: sql`jsonb_set(coalesce(...), ${path}, ${String(value)}::jsonb, true)` })`. Test 4 asserts sequential merge `{e:3}` → `{e:3,m:4}`. Test 5 asserts Promise.all of 3 callbacks against REAL Docker postgres produces `{e:3,m:4,a:2}`. PASSED. |
| 4   | Completion-gated wellbeing_snapshots upsert: writes only when all 3 dims captured (D-27-05)                  | VERIFIED   | `src/rituals/wellbeing.ts:265-280` `db.insert(wellbeingSnapshots).onConflictDoUpdate({ target: snapshotDate, set: { energy/mood/anxiety: sql.raw('EXCLUDED.<col>') } })` runs ONLY inside `completeSnapshot` (gated by `isComplete(meta.partial)`). Test 5 + Test 6 assert post-completion row exists with energy=3 mood=4 anxiety=2. PASSED. |
| 5   | Anchor-bias defeat (D-27-04): module never SELECTs from wellbeing_snapshots; prompt has no historical refs   | VERIFIED   | `grep -E "select.*wellbeingSnapshots\|from.*wellbeingSnapshots" src/rituals/wellbeing.ts` returns ZERO matches (only INSERT calls). Static guard in `scripts/test.sh:150` enforces this on every CI run. Constant prompt `'Wellbeing snapshot — tap energy, mood, anxiety:'` contains no digits 1-5 (Test 3). Test 2 (db.select spy) covered. THREE-LAYER DEFENSE in place. |
| 6   | Skip button writes adjustment_eligible:false + emits 'wellbeing_skipped' (distinct from fired_no_response, WELL-04) | VERIFIED   | `src/rituals/wellbeing.ts:314-347` `handleSkip()` writes `{skipped:true, adjustment_eligible:false}` to ritual_responses.metadata, inserts ritual_fire_events with `outcome: 'wellbeing_skipped'`. Does NOT touch `rituals.skipCount` (grep confirms absence). Test 7 asserts skipCount unchanged + outcome string distinct. PASSED. |
| 7   | Migration 0008 seeds daily_wellbeing ritual at 09:00 Europe/Paris idempotently (WELL-05)                     | VERIFIED   | `src/db/migrations/0008_wellbeing_seed.sql` — single INSERT with `ON CONFLICT (name) DO NOTHING`. Verified live: applied via `scripts/test.sh`, psql query `SELECT next_run_at AT TIME ZONE 'Europe/Paris' FROM rituals WHERE name='daily_wellbeing'` returns `2026-04-29 09:00:00`. Config `fire_at='09:00', time_zone='Europe/Paris', schema_version=1`. |
| 8   | scheduler.ts dispatches `daily_wellbeing` to `fireWellbeing` (D-27-06 atomicity)                             | VERIFIED   | `src/rituals/scheduler.ts:274-275` `case 'daily_wellbeing': return fireWellbeing(ritual, cfg);`. Phase 26's `daily_voice_note` case present at line 272-273. Phase 29's `weekly_review` placeholder comment retained at line 277. |
| 9   | Server-side validation rejects invalid callback_data (D-27-09)                                               | VERIFIED   | `src/rituals/wellbeing.ts:376-386` `parseCallbackData` enforces `dim ∈ {e,m,a}` + integer `value ∈ [1,5]`, returns `kind:'invalid'` otherwise. Defense-in-depth re-assertion at `handleTap:214-219`. Test 8 confirms `r:w:e:6` and `r:w:x:3` ack gracefully without DB write. |

**Programmatic Score:** 9/9 truths verified (100% from must_haves across 3 plans). All 5 ROADMAP-level requirements (WELL-01..05) are satisfied at the code level.

### Required Artifacts

| Artifact                                                | Expected                                                                                                              | Status     | Details                                                                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/bot/handlers/ritual-callback.ts`                   | Prefix-routing dispatcher exporting handleRitualCallback                                                              | VERIFIED   | 75 LOC, exports handleRitualCallback, routes `r:w:*` → handleWellbeingCallback (handler-owns-ack), silently acks `r:adj:*` / `r:wr:*` / unknown / missing-data with warn-log. Auth via `bot.use(auth)` precedes. |
| `src/rituals/wellbeing.ts`                              | REPLACED stub with fireWellbeing + handleWellbeingCallback                                                            | VERIFIED   | 435 LOC. Plan 27-01 stub removed (`! grep -q "stub — Plan 27-02 fills this"` clean). Exports both fire+callback functions. Returns RitualFireOutcome conforming to D-26-08 dispatcher contract.                  |
| `src/db/migrations/0008_wellbeing_seed.sql`             | Hand-authored idempotent INSERT                                                                                        | VERIFIED   | `INSERT INTO "rituals" ... ON CONFLICT ("name") DO NOTHING`. Config jsonb has all 6 RitualConfigSchema-required fields. next_run_at SQL computes next 09:00 Paris instant via date_trunc + CASE.                |
| `src/db/migrations/meta/0008_snapshot.json`             | Drizzle meta snapshot (cloned from 0007 for pure-DML migration)                                                       | VERIFIED   | 47KB. `_journal.json` lists `0008_wellbeing_seed` entry alongside 0006/0007.                                                                                                                                     |
| `src/rituals/scheduler.ts`                              | Dispatcher switch case for daily_wellbeing                                                                            | VERIFIED   | Imports fireWellbeing, switch case at line 274-275 calls `fireWellbeing(ritual, cfg)`. Conforms to (ritual, cfg) → RitualFireOutcome signature.                                                                  |
| `src/bot/bot.ts`                                        | bot.on('callback_query:data', handleRitualCallback) registered                                                        | VERIFIED   | Line 10 imports handleRitualCallback; line 91 registers callback_query:data handler. Documenting comment "First inline-keyboard surface in this codebase" present at line 88.                                  |
| `src/bot/__tests__/ritual-callback.test.ts`             | 7 unit tests for prefix-dispatch                                                                                      | VERIFIED   | 7 cases (2 wellbeing routing + 3 unknown ritual prefix + 1 unknown root + 1 missing data). All 7 PASSED via `bash scripts/test.sh src/bot/__tests__/ritual-callback.test.ts`.                                  |
| `src/rituals/__tests__/wellbeing.test.ts`               | 8 real-DB integration tests covering all 5 WELL requirements                                                          | VERIFIED   | 8 tests: initial fire / no-anchor keyboard / no-anchor prompt / per-tap merge / rapid-tap concurrency / completion+outcome / skip / invalid payload. ALL 8 PASSED against real Docker postgres on port 5433.    |
| `scripts/fire-wellbeing.ts`                             | Operator UAT wrapper around fireWellbeing                                                                              | VERIFIED   | 75 LOC, ESM entry-point guard, parses cfg via `parseRitualConfig`, exits 0/1 appropriately. Mirrors scripts/manual-sweep.ts shape (Phase 25 D-07).                                                              |
| `scripts/test.sh`                                       | Migration 0008 substrate gate + D-27-04 anchor-bias regression guard                                                  | VERIFIED   | Substrate gate at line 131-137 prints `✓ Migration 0008 substrate verified (daily_wellbeing seeded)`. Anchor-bias guard at line 150-156 prints `✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)`. Verified end-to-end. |

### Key Link Verification

| From                                       | To                                            | Via                                                | Status   | Details                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/bot/bot.ts`                           | `handleRitualCallback`                        | `bot.on('callback_query:data', handleRitualCallback as any)` at line 91 | WIRED    | Grammy receives callback_query:data updates; auth middleware (line 22) precedes registration (line 91). Verified by grep + awk source-order check.                                                     |
| `src/bot/handlers/ritual-callback.ts`      | `src/rituals/wellbeing.ts handleWellbeingCallback` | import + delegation at line 56 (`await handleWellbeingCallback(ctx, data)`) | WIRED    | grep returns 2 occurrences (import + delegation). Test 1 + Test 2 in ritual-callback.test.ts assert `r:w:e:3` and `r:w:skip` route correctly to mocked handler.                                        |
| `src/rituals/scheduler.ts`                 | `src/rituals/wellbeing.ts fireWellbeing`      | import at line 43 + switch case at line 274-275   | WIRED    | grep returns 1 occurrence of `import { fireWellbeing } from './wellbeing.js'` and 1 occurrence of `case 'daily_wellbeing': return fireWellbeing(ritual, cfg)`.                                          |
| `handleWellbeingCallback`                  | `ritual_responses.metadata.partial`           | `jsonb_set(coalesce(metadata, '{}'::jsonb), {partial,e}, ...)` at handleTap:228-232 | WIRED    | Atomic at Postgres row-lock level. Test 5 (Promise.all of 3 callbacks against REAL Docker postgres) confirms race-safety.                                                                              |
| `completeSnapshot`                         | `wellbeing_snapshots` upsert                  | `db.insert(...).onConflictDoUpdate({ target: snapshotDate, set: { ... = sql.raw('EXCLUDED.<col>') } })` at line 265-280 | WIRED    | Per-column EXCLUDED reference satisfies WELL-02 contract. Test 6 + Test 7 confirm post-completion row exists with all 3 dims.                                                                          |
| `handleSkip`                               | `ritual_fire_events.outcome = 'wellbeing_skipped'` | `db.insert(ritualFireEvents).values({ outcome: OUTCOME_SKIPPED, ... })` at line 335-340 | WIRED    | Test 7 asserts outcome string distinct from `'fired_no_response'` AND skip_count unchanged.                                                                                                            |
| Migration 0008 seed                        | RitualConfigSchema                            | JSON literal `{ "fire_at": "09:00", "schema_version": 1, ... }` (6/8 fields)              | WIRED    | grep confirms `"fire_at": "09:00"` + `"schema_version": 1` + `"time_zone": "Europe/Paris"` all present in SQL.                                                                                         |
| 10:00 Paris sweep tick                     | daily_wellbeing fire                          | next_run_at = next 09:00 Paris instant; existing runRitualSweep selects WHERE next_run_at <= now() | WIRED    | Live psql confirms seeded `next_run_at = 2026-04-29 09:00:00 Paris`. Phase 25's existing 10:00 cron will pick it up (D-27-09 accepts ~60min latency).                                                  |

### Data-Flow Trace (Level 4)

| Artifact                                  | Data Variable             | Source                                                                                  | Produces Real Data | Status   |
| ----------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------- | ------------------ | -------- |
| inline keyboard sent in fireWellbeing     | `kb` (InlineKeyboard)     | `buildKeyboard({ partial: {} })` — empty partial → no [N] highlights                    | Yes (4 rows)       | FLOWING  |
| ritual_responses.metadata.partial         | `meta.partial`            | jsonb_set merge from validated callback_data                                            | Yes (e/m/a values) | FLOWING  |
| wellbeing_snapshots row                   | energy/mood/anxiety       | meta.partial reads at completion time → INSERT … ON CONFLICT … DO UPDATE                | Yes (1-5 ints)     | FLOWING  |
| ritual_fire_events.outcome                | `outcome` enum            | constants `OUTCOME_COMPLETED='wellbeing_completed'` / `OUTCOME_SKIPPED='wellbeing_skipped'` | Yes                | FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                   | Command                                                                                  | Result                                                            | Status   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| Wellbeing real-DB integration tests                        | `bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts`                          | 8 tests / 8 passed (829ms)                                         | PASS     |
| Ritual-callback unit tests                                 | `bash scripts/test.sh src/bot/__tests__/ritual-callback.test.ts`                        | 7 tests / 7 passed (149ms)                                         | PASS     |
| Combined wellbeing + callback tests                        | `bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts src/bot/__tests__/ritual-callback.test.ts` | 15 tests / 15 passed (830ms)                                      | PASS     |
| Migration 0008 substrate gate                              | `bash scripts/test.sh ...` (gate runs before vitest)                                     | `✓ Migration 0008 substrate verified (daily_wellbeing seeded)`    | PASS     |
| D-27-04 anchor-bias regression guard                       | `bash scripts/test.sh ...` (gate runs before vitest)                                     | `✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)` | PASS     |
| Anchor-bias contract — no SELECT against wellbeing_snapshots | `grep -E "select.*wellbeingSnapshots\|from.*wellbeingSnapshots" src/rituals/wellbeing.ts` | exit code 1 (zero matches)                                        | PASS     |
| Migration 0008 SQL produces correct next_run_at            | Apply 0008 to clean DB; `SELECT next_run_at AT TIME ZONE 'Europe/Paris' FROM rituals WHERE name='daily_wellbeing'` | `2026-04-29 09:00:00` (next 09:00 Paris)                          | PASS     |
| Wellbeing module does NOT modify skip_count                | `grep skipCount src/rituals/wellbeing.ts` (excluding comments)                          | only comment lines reference skip_count; no write paths           | PASS     |
| Wellbeing module does NOT advance next_run_at              | `grep next_run_at\|nextRunAt src/rituals/wellbeing.ts`                                  | zero matches (scheduler owns advancement)                         | PASS     |

### Requirements Coverage

| Requirement | Source Plan(s) | Description                                                                                                                                  | Status      | Evidence                                                                                                                                                                            |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WELL-01     | 27-01, 27-02, 27-03 | Single Telegram message with 3-row × 5-button InlineKeyboard + skip button. First use of inline keyboards.                                  | SATISFIED   | wellbeing.ts:351-363 buildKeyboard. Test 1 asserts 4-row layout (3×5 + 1 skip). bot.on('callback_query:data') registered (first in codebase). REQUIREMENTS.md marks [x].          |
| WELL-02     | 27-01, 27-02, 27-03 | bot.on('callback_query:data', handleRitualCallback) registered. Per-tap upsert with snapshot_date conflict resolution.                       | SATISFIED   | bot.ts:91 registers handler. wellbeing.ts:265-280 INSERT INTO wellbeing_snapshots ON CONFLICT (snapshot_date) DO UPDATE SET energy=EXCLUDED.energy, mood=EXCLUDED.mood, anxiety=EXCLUDED.anxiety. Test 5 (rapid-tap) + Test 6 (completion) cover. |
| WELL-03     | 27-02, 27-03 | Partial state in ritual_responses.metadata jsonb. Highlights current selections; HIDES previous days' values (anchor-bias defeat).            | SATISFIED   | wellbeing.ts uses ritual_responses.metadata.partial as staging via jsonb_set. Three-layer anchor-bias defense (in-plan grep + Test 2 db.select spy + scripts/test.sh static guard) verified. |
| WELL-04     | 27-02, 27-03 | Skip button (`adjustment_eligible: false`); does NOT trigger Phase 28 adjustment dialogue; distinct from `fired_no_response`.                 | SATISFIED   | handleSkip writes `{skipped:true, adjustment_eligible:false}` + emits `'wellbeing_skipped'` outcome. Test 7 asserts skip_count UNCHANGED (proves distinct from fired_no_response).  |
| WELL-05     | 27-02       | Default fire 09:00 Europe/Paris, configurable via `rituals.config.fire_at`. Separate from voice note (21:00) per D026 + Pitfall 13.            | SATISFIED   | Migration 0008 seeds `fire_at='09:00', time_zone='Europe/Paris'`. Live psql confirms next_run_at lands at next 09:00 Paris. Voice note seeded at 21:00 (Phase 26 0007).          |

**Coverage:** 5/5 WELL requirements satisfied. No orphaned requirements (REQUIREMENTS.md WELL-01..05 row maps only to Phase 27 and all 5 are claimed by the 3 plans).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

**No anti-patterns found.** Scans run on `src/rituals/wellbeing.ts`, `src/bot/handlers/ritual-callback.ts`, `scripts/fire-wellbeing.ts`, `src/db/migrations/0008_wellbeing_seed.sql`, `src/rituals/__tests__/wellbeing.test.ts`, `src/bot/__tests__/ritual-callback.test.ts`:

- TODO/FIXME/PLACEHOLDER scan: zero matches.
- "stub — Plan 27-02 fills this" scan: zero matches in production code (Plan 27-02 wholesale-replaced Plan 27-01 stub).
- Empty implementations / no-op handlers: zero matches.
- Hardcoded empty data flowing to user-visible output: zero matches.
- Console.log production code: zero (only scripts/fire-wellbeing.ts uses console for operator output, which is intentional per CONVENTIONS.md).

### Human Verification Required

Phase 27 ships a **first-of-its-kind inline keyboard surface** in the codebase. Programmatic verification covers data shapes (Test 1 asserts keyboard has 4 rows × correct widths), DB invariants (Tests 4-7), concurrency (Test 5 against real Postgres), and validation (Test 8). However, four ROADMAP-level success criteria require **real Telegram interaction** that cannot be programmatically asserted:

#### 1. Operator-fired keyboard renders correctly in real Telegram

**Test:** Run `npx tsx scripts/fire-wellbeing.ts` against staging Telegram bot.
**Expected:** Greg's chat receives one message: prompt text `Wellbeing snapshot — tap energy, mood, anxiety:` followed by inline keyboard with 4 rows. Rows 1-3 each show buttons `1` `2` `3` `4` `5`. Row 4 shows single `Skip` button. No anchor text, no historical references.
**Why human:** Visual rendering of inline keyboards across Telegram clients (mobile/web/desktop) cannot be programmatically asserted — Test 1 verifies the data shape but not the actual chat appearance.

#### 2. Tap-redraw behavior — keyboard updates with [N] highlights as Greg taps

**Test:** After firing via the operator script, tap energy=3 → mood=4 → anxiety=2 in any order.
**Expected:**
- Tap energy=3 → row 1 redraws as `1 2 [3] 4 5`. Other rows unchanged.
- Tap mood=4 → row 2 redraws as `1 2 3 [4] 5`. Row 1 retains `[3]`.
- Tap anxiety=2 → message edits to `Logged: energy 3, mood 4, anxiety 2.` with cleared keyboard.
- Critically: previous days' wellbeing values must NEVER appear as bracketed defaults — keyboard always starts blank for the new day's fire.
**Why human:** Real-time edit-in-place via `ctx.editMessageReplyMarkup` is a Telegram client behavior; only human observation confirms the redraw is responsive and that the `[N]` highlight visually scans correctly.

#### 3. Skip button end-to-end — distinct from no-response

**Test:** After firing, tap `Skip`. Then inspect DB.
**Expected:**
- Message edits to `Skipped wellbeing snapshot.` with cleared keyboard.
- DB: `ritual_responses.metadata = { skipped: true, adjustment_eligible: false }`.
- DB: `ritual_fire_events.outcome = 'wellbeing_skipped'`.
- DB: `rituals.skip_count` UNCHANGED from before-fire value.
- Subsequent day's fire works normally (same handler, fresh ritual_responses row).
**Why human:** End-to-end skip flow via real Telegram webhook → handleRitualCallback → handleSkip needs human validation that the chat UX matches expected (no broken loading spinner, correct text edit).

#### 4. 09:00 Paris fire timing — separate from 21:00 voice note (D-27-09)

**Test:** Wait for natural 10:00 Paris cron tick (or trigger manually via `npx tsx scripts/manual-sweep.ts`) on the morning after migration apply. Then wait for 21:00 voice note same day.
**Expected:**
- 10:00 Paris sweep picks up daily_wellbeing (next_run_at was 09:00 Paris → already in past at 10:00).
- Greg receives wellbeing keyboard.
- 21:00 evening sweep fires daily_voice_note independently.
- Both rituals fire on the same day; neither blocks the other (D026 spirit + Pitfall 13).
**Why human:** Cron-tick timing requires real clock advancement OR a long-running staging environment. D-27-09 explicitly accepts ~60min latency (09:00 fire actually fires at 10:00) as the documented tradeoff.

### Gaps Summary

**No programmatic gaps.** All 9 must_haves across the 3 plans are VERIFIED. All 5 WELL requirements are SATISFIED with code evidence + integration test coverage. The triple-layer anchor-bias defense (D-27-04 prong 1) is in place: in-plan grep + Test 2 db.select spy + scripts/test.sh static guard. The full Docker test harness passes 15/15 wellbeing + ritual-callback tests (matching the user-memory mandate to "always run full Docker tests, never skip integration tests").

**Status `human_needed`** because four ROADMAP-level Success Criteria (visual keyboard rendering, tap-redraw real-time UX, skip button end-to-end chat behavior, 09:00 cron-tick timing) inherently require real Telegram interaction. These are NOT code gaps — they are visual/temporal behaviors not assertable via vitest.

### Pre-existing Test Suite Issues (out of scope)

`bash scripts/test.sh` (FULL suite) reports 113 pre-existing failures across 11 files (live-integration 401, HuggingFace EACCES, DB cross-contamination). These are documented in `.planning/phases/27-daily-wellbeing-snapshot/deferred-items.md` and were present before Phase 27 began. Verified by:
- `bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts src/bot/__tests__/ritual-callback.test.ts` → 15/15 PASS.
- Plan 27-03 SUMMARY documents `npx vitest run src/rituals/ src/bot/` → 16/16 files / 131/131 tests PASS in isolation.
- Phase 26 verification (`26-VERIFICATION.md`) status was already `human_needed` with same pre-existing failure baseline. Phase 27 introduces NO new failures.

### Pitfall Mitigation Verification

| Pitfall                                       | Mitigation                                                                          | Status   | Evidence                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pitfall 13 (anchor bias, HIGH)                | Two-pronged defense: (1) keyboard never quotes prior values; (2) constant prompt text. Triple-layer regression guard. | VERIFIED | (1) wellbeing.ts buildKeyboard reads only `meta.partial` (today's in-progress). (2) WELLBEING_PROMPT constant has zero historical references; Test 3 asserts no digits 1-5 in prose. Triple-layer guard: in-plan grep + Test 2 db.select spy + scripts/test.sh static guard all green. |
| Pitfall 24 (mock-chain regression)            | N/A for Phase 27 (no engine processMessage extension)                              | N/A      | Phase 27 only adds bot.on('callback_query:data') — orthogonal to engine processMessage chain. Plan 27-01 verified existing tests still green (7/7).                                                            |

---

_Verified: 2026-04-28T17:23:07Z_
_Verifier: Claude (gsd-verifier, Opus 4.7)_
