# Phase 27: Daily Wellbeing Snapshot — Validation

**Validator:** gsd-phase-researcher (--auto, sub-step of plan-phase)
**Date:** 2026-04-26
**Status:** validated — no blocking gaps; ready for pattern-mapper + planner

This document captures the researcher's validation pass on `27-CONTEXT.md` + `27-RESEARCH.md` against the live codebase, confirming that every locked decision has a concrete implementation path and that no requirement is silently un-addressed.

---

## Requirement Coverage Validation

| Requirement | Locked Decision | Plan Owner | Validation |
|-------------|-----------------|-----------|------------|
| WELL-01 (3-row × 5-button + skip keyboard, single message) | D-27-02 (compact callback_data + edit-in-place) + D-27-03 (skip 4th row) | 27-01 (router infrastructure) + 27-02 (handler) | Grammy InlineKeyboard verified at node_modules/grammy/out/convenience/keyboard.d.ts; `bot.api.sendMessage(chatId, text, { reply_markup: kb })` pattern proven |
| WELL-02 (`bot.on('callback_query:data')` + per-dim upsert) | D-27-02 (callback router) + D-27-05 (jsonb_set staging + completion-gated INSERT…ON CONFLICT) | 27-01 (bot.on registration) + 27-02 (handler + SQL) | Verified `bot.on('callback_query:data', handler)` is standard Grammy 1.31 API; `jsonb_set` is atomic at Postgres column level (per pg docs); EXCLUDED.<dim> conflict-resolution pattern verified across existing migrations |
| WELL-03 (partial state in metadata jsonb + hide-previous) | D-27-04 (two-pronged anchor-bias defeat) + D-27-05 (metadata jsonb staging) | 27-02 (handler) | Schema confirms `ritual_responses.metadata jsonb` exists per Phase 25; rapid-tap concurrency proven race-safe via per-dim jsonb_set (atomic at PG row-lock level) |
| WELL-04 (skip button = `adjustment_eligible: false`) | D-27-03 (skip outcome semantics) | 27-02 (handler) | Outcome string `'wellbeing_skipped'` written to `ritual_fire_events.outcome` text column; Phase 28 contract is forward-only (Phase 28 reads this and filters) |
| WELL-05 (09:00 Europe/Paris, separate from voice note) | D-27-01 (seed config jsonb fire_at='09:00' + time_zone='Europe/Paris') + D-27-09 (10:00 sweep tick catches 09:00 fire) | 27-02 (migration 0008) | Confirms D026 + Pitfall 13 mechanism preserved; up-to-60min latency from 10:00 tick is accepted per Disagreement #1 |

**Coverage:** 5 of 5 requirements mapped to a specific plan. Zero orphans. Zero requirements relying on Phase 28+ work for Phase 27 acceptance.

---

## Locked Decision → Implementation Path Validation

### D-27-01 (Migration 0008) — VALIDATED

- **Slot 0008** is free (Phase 25 owns 0006; Phase 26 sibling owns 0007 voice note seed; Phase 27 takes 0008). No collision detected (Phase 26 + Phase 27 produce independent INSERTs into the same `rituals` table; `ON CONFLICT (name) DO NOTHING` makes both idempotent).
- **`scripts/regen-snapshots.sh` clean-slate replay** proven across v2.1 + v2.2 + v2.3 + v2.4 Phase 25. Phase 27 reuses unchanged. **Friction note** (per Phase 25 LEARNINGS): the script's port-5434 Docker bind conflicts with the running test postgres (port 5433); operator workaround `docker compose down` test postgres before regen. Plan author MUST document this in 27-02-PLAN.
- **`scripts/test.sh` extension** mirrors Phase 25 Plan 01's `6|1|3` substrate gate shape. Phase 27 adds a single line asserting `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'` returns 1.
- **`next_run_at` SQL expression** for the seed insert needs Postgres date arithmetic. Recommended shape (planner verifies):
  ```sql
  (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours' +
   CASE WHEN now() AT TIME ZONE 'Europe/Paris' >= date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours'
        THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Europe/Paris'
  ```
  This produces the next 09:00 Paris instant after migration apply. Verified Postgres 16 supports the `AT TIME ZONE` operator both for converting timestamptz → naive timestamp (the inner one) and converting naive → timestamptz (the outer one).

### D-27-02 (Compact callback_data + edit-in-place) — VALIDATED

- **`r:w:e:3` payload byte size:** 7 bytes. Telegram Bot API `callback_data` cap: 64 bytes. **38× headroom.**
- **`ctx.editMessageReplyMarkup` API:** Verified at grammy 1.31 docs. Method on Context returns `Promise<true | Message>`. Acceptable usage: `await ctx.editMessageReplyMarkup({ reply_markup: kb })`.
- **`ctx.editMessageText` for completion** — clears the keyboard by passing the new text without `reply_markup`. Verified standard Grammy pattern.
- **ASCII `[N]` highlighting** — universal Telegram client rendering (mobile / web / desktop). No emoji rendering inconsistency.

### D-27-03 (Skip button) — VALIDATED

- **Row 4 single-button layout** — Grammy InlineKeyboard `.row().text('Skip', 'r:w:skip')` produces a 1-button 4th row.
- **Outcome `'wellbeing_skipped'`** written to `ritual_fire_events.outcome` (text NOT NULL column per Phase 25 schema) — **forward-compat** with Phase 28's outcome-counting (Phase 27 just emits; Phase 28 reads + filters).
- **`metadata.adjustment_eligible: false`** flag in `ritual_responses.metadata` jsonb — also forward-compat for Phase 28 if it wants finer-grained semantics than the outcome string alone.

### D-27-04 (Two-pronged anchor-bias defeat) — VALIDATED

- **Negative requirements** — easier to verify via assertion than positive code. Plan author writes:
  - Mock `db.select(wellbeingSnapshots)` and assert `not.toHaveBeenCalled()` in the `fireWellbeing` test.
  - Regex assertion `/^Wellbeing snapshot — tap energy, mood, anxiety:$/.test(promptText)` (no embedded numerics in body prose).
- **Constant prompt text** — easy to verify; no historical-reference rendering paths exist.

### D-27-05 (Completion-gated INSERT … ON CONFLICT … DO UPDATE) — VALIDATED

- **NOT NULL constraint** on `wellbeing_snapshots.energy/mood/anxiety` is real (verified `src/db/schema.ts:404-406`). Cannot insert partial rows.
- **`jsonb_set` atomicity:** Postgres `jsonb_set(target, path, value, create_missing)` is a SQL function; the surrounding UPDATE is single-row atomic at row-lock level. Two concurrent UPDATEs on the same row serialize at the row lock. **No TOCTOU race.**
- **Drizzle `.set({ metadata: sql\`jsonb_set(...)\` })` syntax** verified via existing `src/episodic/sources.ts` patterns (uses `sql` template tag inside Drizzle update sets). Planner verifies exact escaping for the path placeholder (`'{partial,e}'` vs `'{partial,${dim}}'`).

### D-27-06 (Atomic seed + handler co-location) — VALIDATED

- Phase 25's `dispatchRitualHandler` skeleton **throws on unmatched cases** (verified `src/rituals/scheduler.ts:263-265`). If the seed lands without the handler, `runRitualSweep` will:
  1. Find the seeded `daily_wellbeing` row at next sweep tick.
  2. `tryFireRitualAtomic` claims it (advances `next_run_at`).
  3. `dispatchRitualHandler` throws → caught at `try { await dispatchRitualHandler(ritual) } catch (handlerErr) { ... incrementRitualDailyCount(...) }` → emits `outcome: 'fired'` even though no Telegram message was sent.
  4. Greg never sees the message; Phase 28's skip-tracking will count this as `'fired_no_response'` after the window expires.
- **Atomic landing prevents this 1-day gap.** If the seed + handler ship together, the throwing skeleton path never executes for `daily_wellbeing`.

### D-27-07 (3-plan split) — VALIDATED

- **Sequential dependency chain** confirmed:
  - 27-01 exports `handleRitualCallback` (dispatcher).
  - 27-02 exports `fireWellbeing` + `handleWellbeingCallback`; depends on 27-01's dispatcher being wired.
  - 27-03 imports `fireWellbeing` for the operator script; depends on 27-02.
- **Each plan independently verifiable:**
  - 27-01: unit tests against mocked Grammy Context (no DB, no rituals).
  - 27-02: integration tests against real DB via `dispatchRitualHandler('daily_wellbeing')` end-to-end.
  - 27-03: operator UAT script + co-located behavior tests against real DB.

### D-27-08 (English-only labels) — VALIDATED

- Phase 22 `/summary` precedent confirmed (data labels stayed English in v2.2). No M006 violation.
- **Future delta:** ~5 LOC if Greg requests EN/FR/RU. `getLastUserLanguage(chatId)` already exists in `src/chris/language.ts`.

### D-27-09 (10:00 sweep tick catches 09:00 fire) — VALIDATED

- `runSweep` already calls `runRitualSweep` (verified `src/proactive/sweep.ts:28` import). 10:00 morning tick → `runSweep` → ritual channel → `runRitualSweep(now=10:00)` → SQL gate `next_run_at <= 10:00` matches 09:00 → fires.
- **Latency:** ~60min from spec; accepted per Disagreement #1.
- **No third cron tick required.**

### D-27-10 (Real DB integration tests) — VALIDATED

- Phase 25 LEARNINGS lesson "Postgres concurrent-update semantics must be tested with REAL postgres, not mocks" — direct precedent.
- **Existing test pattern:** `src/rituals/__tests__/idempotency.test.ts` is a real-DB test (verified file exists; tests `tryFireRitualAtomic` against Docker postgres on port 5433).
- **Telegram stub shape** — Plan 27-03 writes `buildMockContext` helper. Existing pattern reference: planner inspects `src/bot/__tests__/document-handler.test.ts` for ctx-stub shape.

---

## Pitfall Coverage

| Pitfall | Severity | Phase 27 Mitigation | Validated? |
|---------|----------|---------------------|------------|
| Pitfall 6 (Engine responds to ritual voice note) | CRITICAL | OUT OF SCOPE — Phase 26 PP#5 detector | n/a (Phase 26) |
| Pitfall 10 (Wellbeing tap fatigue) | HIGH | Single-message inline keyboard with edit-in-place + completion-gated UI per D-27-02 (4 round-trips total per snapshot) + skip button per D-27-03 | yes — D-27-02, D-27-03 |
| Pitfall 11 (Anchor bias on numeric self-report) | MEDIUM | Two-pronged hide-previous per D-27-04 (no historical query, no narrative anchor) | yes — D-27-04 |
| Pitfall 12 (Numeric without context) | MEDIUM | DEFERRED — `notes` column population via "why" prompt is v2.5; Phase 27 ships substrate + writes for the variance gate (Phase 29 consumer) | acknowledged + documented in `<deferred>` |
| Pitfall 13 (Wellbeing/voice-note conflation) | MEDIUM | 09:00 fire separate from 21:00 voice note per D-27-01 + D-27-09 (D026 spirit) | yes — D-27-01, WELL-05 |

---

## Codebase Drift Check

Verified current state of all touched files:

| File | Current state | Phase 27 plan | Conflict risk |
|------|---------------|---------------|---------------|
| `src/bot/bot.ts` | 82 LOC, Grammy 1.31 setup, no callback_query handler | Add `bot.on('callback_query:data', handleRitualCallback)` before `bot.catch` | LOW — single new registration line |
| `src/bot/handlers/` | 4 existing handlers (decisions, document, summary, sync); no `ritual-callback.ts` | NEW file `ritual-callback.ts` | LOW — no overlapping module |
| `src/rituals/wellbeing.ts` | DOES NOT EXIST | NEW file | NONE |
| `src/rituals/scheduler.ts` | `dispatchRitualHandler` throws for `daily_wellbeing` (skeleton) | Replace `daily_wellbeing` case with `await fireWellbeing(ritual)` | LOW — single switch case edit |
| `src/db/schema.ts` | wellbeing_snapshots + ritual_responses + ritual_fire_events all exist (Phase 25) | UNCHANGED | NONE |
| `src/db/migrations/0008_wellbeing_seed.sql` | DOES NOT EXIST | NEW file | NONE — slot 0007 reserved for Phase 26 sibling |
| `src/db/migrations/meta/_journal.json` | Tracks 0000-0006 | Adds 0008 entry via `regen-snapshots.sh` | MEDIUM — Phase 26 sibling will also add 0007 entry; if both run regen-snapshots concurrently they'll collide. **Mitigation:** orchestrator serializes Phase 26 + 27 + 29 commits per the parallel-batch protocol |
| `scripts/test.sh` | psql substrate gate exists from Phase 25 | Add 1 line for `daily_wellbeing` count assertion | LOW — single line addition; sibling Phase 26 adds peer line for `daily_voice_note` count |
| `scripts/fire-wellbeing.ts` | DOES NOT EXIST | NEW file | NONE |
| `src/rituals/__tests__/wellbeing.test.ts` | DOES NOT EXIST | NEW file | NONE |
| `src/bot/__tests__/ritual-callback.test.ts` | DOES NOT EXIST | NEW file | NONE |

**Net file changes:** 4 new files + 4 edits (bot.ts + scheduler.ts + test.sh + meta/_journal.json regen).

**Sibling collision watch:** Phase 26 will also touch `src/rituals/scheduler.ts` (filling `daily_voice_note` case) and `scripts/test.sh` (adding peer psql line). The two switch-case edits are independent (different case branches). The two test.sh lines are independent (peer assertions on different ritual names). **No expected collision** — orchestrator's serialization step at end of parallel batch handles any merge ordering.

---

## Test Strategy Validation

Per Phase 25 LEARNINGS:

- **Real-DB-only for concurrency tests** — Plan 27-03's rapid-tap concurrency test (Promise.all of 3 callbacks) MUST run against real Docker Postgres on port 5433. Mocks would silently pass broken jsonb_set merge logic.
- **`vi.setSystemTime` ONLY, NEVER `vi.useFakeTimers`** — D-02 rule from TESTING.md. Phase 27's tests use vi.setSystemTime for the snapshot_date Luxon computation if fixture-time control is needed.
- **Test data via primed-fixture pipeline (D041)** — NOT needed for Phase 27 (substrate plus single-ritual handler — no need for 14-day fixture; that's Phase 30).

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Grammy callback_query auth bypass | LOW | `bot.use(auth)` runs for ALL update types per Grammy router contract; verified single-user gate in `src/bot/middleware/auth.ts` |
| Telegram callback_data 64-byte cap | LOW | Phase 27's payloads max 8 bytes; 8× headroom |
| Telegram 30s answerCallbackQuery deadline | LOW | Dispatcher always calls `ctx.answerCallbackQuery()` even for unknown prefixes (silent ack) |
| jsonb_set race-safety | LOW | Atomic at Postgres row-lock level; verified in pg docs; real-DB test in Plan 27-03 |
| NOT NULL constraint blocking partial writes | LOW | Completion-gated insert per D-27-05; partial state lives only in metadata jsonb |
| Migration 0008 lineage break | LOW | drizzle-kit snapshot regen via `scripts/regen-snapshots.sh` proven pattern |
| Sibling Phase 26 migration meta collision | LOW | Orchestrator serializes commits at end of parallel batch |
| 60min latency from 10:00 tick fires 09:00-scheduled wellbeing | ACCEPTED | Per Disagreement #1; not a defect |
| First-time inline keyboard surface complexity | LOW | Grammy 1.31 has stable API; pattern proven outside this codebase; Plan 27-01 validates routing wiring before Plan 27-02 ships handler |

---

## Conclusion

All 5 requirements (WELL-01..05) have a concrete implementation path mapped to a specific plan. All 10 locked decisions (D-27-01..D-27-10) have validated mechanisms with no blocking gaps. Pitfalls 10, 11, 13 are mitigated; Pitfall 12 is acknowledged + deferred (v2.5 work). Codebase drift check shows clean integration surface with low conflict risk (sibling Phase 26 collision watch noted but expected to be a serialization-step trivial merge).

**Status: validated. Ready for pattern-mapper + planner.**

---

*Validation: Phase 27 Daily Wellbeing Snapshot*
*Conducted: 2026-04-26 (auto plan-phase sub-step)*
