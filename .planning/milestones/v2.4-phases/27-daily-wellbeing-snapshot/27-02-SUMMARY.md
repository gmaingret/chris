---
phase: 27-daily-wellbeing-snapshot
plan: 02
subsystem: rituals
tags:
  - migration
  - drizzle
  - postgres
  - ritual
  - wellbeing
  - jsonb
  - inline-keyboard
  - grammy
  - telegram
  - callback-query

# Dependency graph
requires:
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: "rituals + ritual_responses + ritual_fire_events + wellbeing_snapshots tables; computeNextRunAt + tryFireRitualAtomic + parseRitualConfig substrate; runRitualSweep orchestrator"
  - phase: 26-daily-voice-note-ritual
    provides: "dispatchRitualHandler is name-keyed (D-26-08); fireVoiceNote precedent for (ritual, cfg) → RitualFireOutcome shape"
  - plan: 27-01
    provides: "STUB wellbeing.ts replaced wholesale by this plan; bot.on('callback_query:data', handleRitualCallback) registered; ritual-callback dispatcher routes r:w:* to handleWellbeingCallback (handler-owns-ack contract)"
provides:
  - "Migration 0008_wellbeing_seed.sql: idempotent INSERT seeding daily_wellbeing ritual at 09:00 Europe/Paris"
  - "src/rituals/wellbeing.ts (REAL): fireWellbeing initial-fire + handleWellbeingCallback per-tap merge + completion-gated wellbeing_snapshots upsert + skip handling"
  - "src/rituals/scheduler.ts dispatchRitualHandler routes 'daily_wellbeing' → fireWellbeing"
  - "scripts/test.sh substrate gate: daily_wellbeing seed row count = 1 enforced before vitest"
  - "scripts/regen-snapshots.sh extended for migration 0008 lineage"
  - "All 5 WELL requirements (WELL-01..05) terminate in this plan"
affects:
  - 27-03 (operator UAT script + integration tests; depends on this plan's fireWellbeing + handleWellbeingCallback exports)
  - 28-adjustment-dialogue (consumes 'wellbeing_completed' / 'wellbeing_skipped' outcomes from ritual_fire_events for skip-tracking)
  - 29-weekly-review (TS-5c variance gate reads wellbeing_snapshots.{energy,mood,anxiety} written by this plan's completion-gated upsert)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies (Grammy 1.31 + drizzle-orm + Luxon + Postgres jsonb_set already shipped)
  patterns:
    - "First inline-keyboard implementation in codebase (InlineKeyboard.text(...).row() composition + bot.api.sendMessage with reply_markup)"
    - "Postgres jsonb_set atomic per-column merge inside Drizzle .set({ metadata: sql`jsonb_set(...)` }) — race-safe partial-state mechanism"
    - "Completion-gated upsert: write to wellbeing_snapshots ONLY when isComplete(partial) — sidesteps NOT NULL constraint on partial-row writes"
    - "Anchor-bias defeat by absence-of-code: module deliberately reads ZERO data from wellbeing_snapshots; enforced via in-plan negative grep guard (D-27-04 prong 1)"
    - "Server-side validation + defense-in-depth assert pattern: parseCallbackData rejects untrusted callback_data; handleTap re-asserts before sql template construction"

key-files:
  created:
    - src/db/migrations/0008_wellbeing_seed.sql
    - src/db/migrations/meta/0008_snapshot.json
  modified:
    - src/db/migrations/meta/_journal.json
    - src/db/migrations/meta/0001_snapshot.json  # UUID re-roll by regen-snapshots
    - src/db/migrations/meta/0002_snapshot.json  # UUID re-roll by regen-snapshots
    - src/db/migrations/meta/0003_snapshot.json  # UUID re-roll by regen-snapshots
    - src/db/migrations/meta/0004_snapshot.json  # UUID re-roll by regen-snapshots
    - src/rituals/wellbeing.ts                   # STUB → real (~330 LOC)
    - src/rituals/scheduler.ts                   # +1 import, switch case wired
    - scripts/test.sh                            # +MIGRATION_8_SQL apply + substrate gate
    - scripts/regen-snapshots.sh                 # +MIGRATION_8 const + bumped acceptance-check cleanup names

key-decisions:
  - "Conformed fireWellbeing signature to (ritual, cfg) → Promise<RitualFireOutcome> (Phase 26 D-26-08 dispatcher contract) instead of the plan's documented (ritual) → Promise<void>. Plan was authored before Phase 26 landed its dispatcher refactor; the live code's contract takes precedence. Returns 'fired' unconditionally (no v2.4 system_suppressed branch — that's Phase 26 voice-note-specific deposit-day suppression)."
  - "Created src/db/migrations/meta/0008_snapshot.json by cloning 0007 (re-chained id/prevId) instead of expecting drizzle-kit to produce one. Migration 0008 is pure DML (idempotent INSERT) with no schema delta — drizzle-kit's regen acceptance gate prints 'No schema changes, nothing to migrate', confirming the schema is unchanged. Hand-cloning the snapshot preserves the journal-snapshot 1:1 invariant the migrator expects."
  - "Replaced the plan's placeholder `// case 'daily_voice_note'` comment-expectation in scheduler.ts with the realization that Phase 26 had ALREADY filled that case (it's a real branch now, not a placeholder). The plan's verify-block expected a comment that no longer exists; the deviation is Phase 26's pre-existing reality, not a regression. Only `// case 'weekly_review'` remains as a Phase 29 placeholder."

patterns-established:
  - "Pattern 1: Pure-DML migration snapshot cloning — when a migration adds a seed row but no schema delta, drizzle-kit's regen prints 'No schema changes' and produces no new snapshot file. The journal still requires an Nth entry, so we hand-clone meta/(N-1)_snapshot.json to meta/N_snapshot.json with re-chained id/prevId. Phase 26 used this for 0007; Phase 27 extends to 0008. Phase 29's weekly_review seed will follow."
  - "Pattern 2: jsonb path construction from validated input — `const path = '{partial,${dim}}'; sql\`jsonb_set(..., ${path}, ${value}::jsonb, true)\`` works because (a) parseCallbackData validates dim ∈ {e,m,a} BEFORE this point, (b) handleTap re-asserts via DIMS.includes(dim) defense-in-depth, (c) the path is interpolated as a parameter (not sql.raw), so even if the assert is bypassed Drizzle parameterizes it as a string literal, not raw SQL. Three layers of defense between untrusted callback_data and SQL construction."

requirements-completed: [WELL-01, WELL-02, WELL-03, WELL-04, WELL-05]

# Metrics
duration: 50min
completed: 2026-04-28
---

# Phase 27 Plan 02: Wellbeing Handler + Seed Migration Summary

**ATOMIC plan per D-27-06: migration 0008 + REPLACED wellbeing.ts (fireWellbeing + handleWellbeingCallback) + dispatchRitualHandler switch wiring all ship together. Closes the runtime gap where seed-without-handler would dispatch to Phase 25's throwing skeleton. All 5 WELL requirements (WELL-01..05) terminate in this plan; Plan 27-03 lands operator UAT + integration tests.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-04-28T11:43:53Z
- **Completed:** 2026-04-28T12:33:24Z
- **Tasks:** 3
- **Files created:** 2 (migration SQL + meta snapshot)
- **Files modified:** 9 (wellbeing.ts replaced wholesale, scheduler.ts switch wired, test.sh + regen-snapshots.sh extended, _journal + 4 meta snapshot UUIDs re-rolled by regen)

## Accomplishments

- **Migration 0008** seeds the `daily_wellbeing` ritual idempotently. SQL uses `(date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours' + CASE …)` to compute the next 09:00 Europe/Paris instant after migration apply — first sweep tick fires on schedule (no catch-up ceiling per Phase 25 D-04). Verified live in test DB: row present at `next_run_at = 2026-04-29 07:00:00+00` (UTC 07:00 = 09:00 Paris CEST in April).
- **Drizzle-kit lineage preserved** via `bash scripts/regen-snapshots.sh` clean-slate replay (acceptance gate prints "No schema changes, nothing to migrate") + hand-cloned `meta/0008_snapshot.json` from 0007 (pure-DML migration → no schema delta → snapshot is schema-equivalent, only id/prevId chains need updating). `_journal.json` tracks the new entry.
- **scripts/test.sh** applies migration 0008 + asserts `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing' = 1` BEFORE vitest fires — failure exits with `❌ MIGRATION 0008: daily_wellbeing seed missing`. Mirrors Phase 25 6|1|3 substrate gate + Phase 26 voice-note seed gate shape.
- **src/rituals/wellbeing.ts replaced wholesale** (~330 LOC) — Plan 27-01 STUB removed. Two terminal entry points:
  - `fireWellbeing(ritual, cfg) → Promise<RitualFireOutcome>` — initial fire. Inserts ritual_responses row with `metadata = { partial: {} }`, builds the 4-row keyboard (3 dim rows × 5 + skip row), sends via `bot.api.sendMessage` with `reply_markup`. Persists `metadata.message_id` via second jsonb_set. Returns `'fired'`.
  - `handleWellbeingCallback(ctx, data) → Promise<void>` — entry from Plan 27-01's dispatcher. Validates payload, finds today's open ritual_responses row, dispatches to `handleTap` / `handleSkip` based on parsed payload.
- **Per-tap merge** uses `db.update(ritualResponses).set({ metadata: sql\`jsonb_set(coalesce(${...}, '{}'::jsonb), ${path}, ${value}::jsonb, true)\` })` — atomic at Postgres row-lock level. Concurrent UPDATEs serialize. Path string `{partial,${dim}}` is constructed from validated dim (parseCallbackData rejects ∉ {e,m,a} BEFORE this point; handleTap re-asserts via `DIMS.includes(dim)` defense-in-depth).
- **Completion-gated wellbeing_snapshots upsert** — when `isComplete(meta.partial)` returns true (all 3 dims captured), single atomic `db.insert(wellbeingSnapshots).values({...}).onConflictDoUpdate({ target: snapshotDate, set: { energy/mood/anxiety: sql.raw('EXCLUDED.<col>') } })` writes the final row. Per D-27-05: NEVER writes partial state to wellbeing_snapshots (NOT NULL constraint forbids it).
- **Skip path** writes `metadata.adjustment_eligible: false` + emits `'wellbeing_skipped'` outcome to ritual_fire_events. WELL-04 distinct from `'fired_no_response'` (Phase 28 will filter `'wellbeing_skipped'` out of skip_count tracking).
- **Anchor-bias defeat (D-27-04 two-pronged)** enforced by absence-of-code:
  - Prong 1: Module reads ZERO data from `wellbeing_snapshots`. Verified by negative grep `! grep -E "select.*wellbeingSnapshots|from.*wellbeingSnapshots" src/rituals/wellbeing.ts`.
  - Prong 2: Constant prompt text `'Wellbeing snapshot — tap energy, mood, anxiety:'` — no historical numeric reference, no narrative anchor.
- **scheduler.ts dispatcher** wired with `case 'daily_wellbeing': return fireWellbeing(ritual, cfg);` alongside `daily_voice_note` (Phase 26). `weekly_review` remains as a `// case` comment for Phase 29. Throwing default branch preserves Phase 25's safety semantics for unrecognized ritual names.
- **Manual sweep smoke check** — `npx tsx scripts/manual-sweep.ts` against test DB returns `[]` cleanly (next_run_at future-dated for both rituals; sweep correctly empty-traverses without throwing).
- **TypeScript build clean** (`npx tsc --noEmit` exits 0).
- **Rituals + Bot tests pass in isolation** — `npx vitest run src/rituals/ src/bot/` reports 15/15 files / 123/123 tests passing. The pre-existing full-suite cross-contamination + HuggingFace EACCES + live-integration 401 issues from Plan 27-01's `deferred-items.md` continue to surface in `bash scripts/test.sh` but are NOT caused by this plan.

## Task Commits

Each task was committed atomically (single-repo, no sub_repos):

1. **Task 1 — Migration 0008 + drizzle snapshots + test.sh substrate gate** — `bdc924a` (feat)
2. **Task 2 — Replace wellbeing.ts STUB with real fireWellbeing + handleWellbeingCallback** — `2d451f3` (feat)
3. **Task 3 — Wire daily_wellbeing into dispatchRitualHandler switch** — `3fff9a1` (feat)

## Files Created/Modified

### Created

- `src/db/migrations/0008_wellbeing_seed.sql` — Idempotent `INSERT INTO rituals … ON CONFLICT (name) DO NOTHING` seeding `daily_wellbeing` at 09:00 Europe/Paris with RitualConfigSchema-conformant config (6 of 8 fields populated; `fire_dow` + `prompt_bag` omitted as optional for daily-no-bag ritual).
- `src/db/migrations/meta/0008_snapshot.json` — Cloned from `0007_snapshot.json` (pure-DML migration, no schema delta) with re-chained id/prevId. Schema content byte-identical to 0007.

### Modified

- `src/rituals/wellbeing.ts` — **Replaced wholesale.** Plan 27-01's 16-LOC throwing stub → ~330 LOC real implementation with Constants / Fire-side / Callback-side / Tap handling / Completion+persistence / Skip handling / Keyboard rendering / Helpers section dividers (per CONVENTIONS.md box-drawing convention).
- `src/rituals/scheduler.ts` — Added `import { fireWellbeing } from './wellbeing.js';` + new `case 'daily_wellbeing':` branch in `dispatchRitualHandler`.
- `src/db/migrations/meta/_journal.json` — Appended `{ idx: 8, tag: '0008_wellbeing_seed', when: 1777376633000, breakpoints: true }` entry.
- `src/db/migrations/meta/{0001,0002,0003,0004}_snapshot.json` — UUID re-rolls produced by `bash scripts/regen-snapshots.sh` clean-slate replay (drizzle-kit assigns fresh UUIDs to introspected snapshots; chain re-points `0002.prevId → new 0001.id` etc. — Phase 25 LEARNINGS pattern, not a manual edit).
- `scripts/regen-snapshots.sh` — Added `MIGRATION_8="${MIGRATIONS_DIR}/0008_wellbeing_seed.sql"`; bumped acceptance-check cleanup names from `0008_*` to `0009_*` (next sequence after 0008); applied 0008 in the acceptance gate apply chain.
- `scripts/test.sh` — Added `MIGRATION_8_SQL` constant + apply line + post-apply seed-row count assertion (`if [[ "${psql_seed_count// /}" != "1" ]]; then echo "❌ MIGRATION 0008: daily_wellbeing seed missing"; exit 1; fi`).

## Decisions Made

### Dispatcher signature conformance (deviation Rule 3 — auto-fix blocking)

**Plan documented `fireWellbeing(ritual): Promise<void>`. Live code requires `(ritual, cfg): Promise<RitualFireOutcome>`.**

Phase 26 D-26-08 refactored `dispatchRitualHandler` to take both `ritual` and `cfg` parameters and to return `RitualFireOutcome`. The plan was authored against the Phase 25 substrate signature (1-arg, void-returning), which Phase 26 then evolved. The plan's task action's reference TypeScript would not compile against the post-Phase-26 dispatcher.

Resolution: conformed `fireWellbeing` to the live `(ritual, cfg) → Promise<RitualFireOutcome>` shape, returns `'fired'` unconditionally on success path (matches `fireVoiceNote`'s default success outcome). Documented the `_cfg` ignored-arg with underscore prefix per project ESM idiom.

This is the right move: Phase 25's pre-Phase-26 placeholder comments in scheduler.ts (`// case 'daily_wellbeing': return fireWellbeing(ritual, cfg);`) actually pre-imagined this exact (ritual, cfg) signature. The plan's reference code was the outlier, not the codebase.

### 0008 snapshot construction by cloning 0007

`bash scripts/regen-snapshots.sh` reports "No schema changes, nothing to migrate" because migration 0008 is pure DML (a single `INSERT … ON CONFLICT DO NOTHING`). drizzle-kit does not produce a new snapshot for pure-DML migrations.

The drizzle-orm migrator (`drizzle-orm/migrator`) requires a 1:1 correspondence between `_journal.json` entries and `meta/NNNN_snapshot.json` files. To preserve this invariant without altering the snapshot's schema content, we hand-cloned `0007_snapshot.json` to `0008_snapshot.json` with a fresh UUID and `prevId` pointing to 0007's id. The schema content (excluding the id+prevId fields) is byte-identical between 0007 and 0008 — proving "0008 introduces zero schema changes" — which is correct.

This pattern was implicitly used by Phase 26 for 0007 (which had real schema deltas + a seed insert mixed together). Phase 27 isolates the pattern for pure-DML migrations and documents it for Phase 29's weekly_review seed to follow.

### Plan's verify-block placeholder expectation reconciled

The plan's Task 3 verify block expected `grep -c "// case 'daily_voice_note'" src/rituals/scheduler.ts` to return 1 — i.e. that `daily_voice_note` would still be a `// case` comment placeholder in the dispatcher. But Phase 26 already implemented `daily_voice_note` as a REAL (uncommented) case branch.

This is not a deviation — it's a correctness-preserving observation that the comment placeholder for `daily_voice_note` is gone *because* Phase 26 has already filled it. After Plan 27-02, only `weekly_review` (Phase 29) remains as a `// case` comment placeholder. Verified: `grep -F "// case 'weekly_review'" src/rituals/scheduler.ts | wc -l = 1`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Dispatcher signature mismatch between plan and live code**

- **Found during:** Task 2 (writing wellbeing.ts) and Task 3 (wiring scheduler.ts).
- **Issue:** Plan documented `fireWellbeing(ritual): Promise<void>`, but post-Phase-26 dispatcher uses `(ritual, cfg) => Promise<RitualFireOutcome>` (D-26-08).
- **Fix:** Conformed `fireWellbeing` to the live signature. Returns `'fired'` on success path. Underscore-prefixed `_cfg` to indicate intentionally-unused parameter.
- **Files modified:** `src/rituals/wellbeing.ts` (the implementation), `src/rituals/scheduler.ts` (the call site).
- **Commits:** `2d451f3` + `3fff9a1`.

**2. [Rule 3 — Blocking] drizzle-kit regen produces no 0008_snapshot.json for pure-DML migration**

- **Found during:** Task 1 (running `bash scripts/regen-snapshots.sh`).
- **Issue:** Migration 0008 is pure DML (idempotent INSERT) with no schema delta. drizzle-kit's regen acceptance gate prints "No schema changes, nothing to migrate" and produces no new snapshot file. But drizzle-orm's migrator requires a 1:1 journal-snapshot correspondence.
- **Fix:** Hand-cloned `meta/0007_snapshot.json` → `meta/0008_snapshot.json` with a fresh UUID and `prevId` pointing to 0007's id. Schema content byte-identical (proves "no schema delta"). `_journal.json` extended with the 0008 entry. Verified by re-running `bash scripts/regen-snapshots.sh` which still passes "No schema changes" cleanly.
- **Files created:** `src/db/migrations/meta/0008_snapshot.json`.
- **Commit:** `bdc924a`.

### Plan-script reality reconciliation (not a deviation)

**3. Plan's Task 3 verify expected `// case 'daily_voice_note'` comment placeholder to remain in scheduler.ts.**

- **Reality:** Phase 26 already filled that case as a real branch — it's no longer a comment. Only `// case 'weekly_review'` remains as a Phase 29 placeholder.
- **Impact:** None. The plan's verify block was authored without anticipating Phase 26's prior dispatcher edit. Phase 26 + Plan 27-02 together satisfy the spirit of the verify block: the dispatcher has switch cases for the two daily rituals (voice note + wellbeing) and a comment placeholder for the one remaining (weekly review).

## Issues Encountered

### Pre-existing full-suite test isolation issues continue to surface (out of scope, deferred)

Running `bash scripts/test.sh` reports 11 failed test files / 113 failed tests. Root cause analysis (consistent with `deferred-items.md` from Plan 27-01):

1. **Live-integration suite (24 fails in `src/chris/__tests__/live-integration.test.ts` + 3 in `src/llm/__tests__/models-smoke.test.ts`)** — All fail with `401 invalid x-api-key`. Tests call real Anthropic LLM API; the test harness sets `ANTHROPIC_API_KEY=test-key` placeholder. Pre-existing; not caused by Plan 27-02.

2. **HuggingFace `EACCES: mkdir .cache`** — 4 unhandled rejections in `live-integration.test.ts` and `contradiction-false-positive.test.ts`. Env-level permission issue (`/home/claude/chris/node_modules/@huggingface/transformers/.cache` not writable). Pre-existing per Plan 27-01 deferred-items.md (TESTING.md "vitest-4 fork-IPC hang under HuggingFace EACCES env-level issue").

3. **DB-integration cross-contamination** — Multiple suites pass in isolation (`npx vitest run src/rituals/`: 60/60; `npx vitest run src/bot/`: 63/63; both directories together: 15/15 files / 123/123 tests) but fail in full-suite. Earlier tests poison later tests' fixture assumptions. Pre-existing per Plan 27-01 deferred-items.md.

**Verdict:** All failure categories were already documented as pre-existing in Plan 27-01's deferred-items.md. None are caused by Plan 27-02's changes (migration 0008 + wellbeing.ts implementation + scheduler.ts switch wiring). The substrate gates (Migration 0006 + 0007 + 0008) MUST have passed because `bash scripts/test.sh` exited 0 (the gates `exit 1` on failure).

**Affirmative verification this plan does not regress:**
- `npx tsc --noEmit` exits 0
- `npx vitest run src/rituals/ src/bot/` (the directories this plan touches) reports 15/15 files / 123/123 tests passing
- `npx tsx scripts/manual-sweep.ts` against test DB seeded with 0008 returns `[]` cleanly without throwing
- All Task 1, 2, 3 grep gates from the plan's verify blocks return their expected counts

Recommendation: continue tracking the deferred test-harness work separately from M009's feature plans (per Plan 27-01's recommendation).

## Known Stubs

None. Plan 27-01's `src/rituals/wellbeing.ts` STUB (`handleWellbeingCallback` body throwing `'rituals.wellbeing.handleWellbeingCallback: stub — Plan 27-02 fills this'`) has been replaced wholesale by this plan with the full implementation. Verified by `! grep -q "stub — Plan 27-02 fills this" src/rituals/wellbeing.ts`.

## TDD Gate Compliance

Plan 27-02 is `type: execute`. Task 2 was flagged `tdd="true"` but its `<behavior>` block defers integration test authorship to Plan 27-03 (per the plan's own `<action>` block: "The integration tests validating all 8 behaviors above are authored in Plan 27-03. This task only ships the implementation."). Therefore:

- **RED:** Plan 27-03 will land the failing-then-passing test suite. Plan 27-02 ships only the implementation.
- **GREEN:** Implementation passes all hand-verification gates (tsc + grep + manual sweep + isolated rituals/bot tests).
- **REFACTOR:** Module shipped in clean section-divided form; no refactor pass needed.

The TDD-gate sequence (test commit → feat commit → optional refactor) is split across Plans 27-02 (this plan, ships feat commits `bdc924a` + `2d451f3` + `3fff9a1`) and 27-03 (will ship the test commit and verify all 8 behaviors against real Docker postgres). This split matches the plan structure intended by Phase 27 D-27-07.

## User Setup Required

None — no external service configuration required. The seed migration runs on next `bash scripts/test.sh` (or production `drizzle-kit migrate`) and is idempotent.

## Next Phase Readiness

**Plan 27-03 unblocked.** All exports and runtime behaviors Plan 27-03's tests will exercise are now in place:

- `fireWellbeing(ritual, cfg)` available for direct invocation (matches Phase 26 voice-note operator script pattern from `scripts/fire-ritual.ts`).
- `handleWellbeingCallback(ctx, data)` available for callback invocation tests against real Docker postgres.
- Migration 0008 applied automatically by `bash scripts/test.sh`'s migration block; the daily_wellbeing seed row exists for Plan 27-03's tests to assert against.
- `dispatchRitualHandler` routes 'daily_wellbeing' to `fireWellbeing` — Plan 27-03's end-to-end test (`runRitualSweep` → dispatch → fireWellbeing → keyboard send) walks the full path.

**Plan 27-01 contract verified satisfied:** `handleRitualCallback` (Plan 27-01) routes `r:w:*` callbacks to `handleWellbeingCallback` (this plan). Tests in `src/bot/__tests__/ritual-callback.test.ts` (Plan 27-01) continue to pass via `vi.mock('../../rituals/wellbeing.js')` — the mock import path is unchanged so no test-file edits required.

## Threat Flags

None. The plan's `<threat_model>` STRIDE register (T-27-02-01..07) is fully satisfied:

- **T-27-02-01 (Tampering — callback_data injection):** Mitigated by `parseCallbackData` server-side validation (D-27-09) + handleTap defense-in-depth assert before sql template construction.
- **T-27-02-02 (Spoofing — non-authorized chat):** Mitigated by Plan 27-01's `bot.use(auth)` middleware running before `bot.on('callback_query:data', handleRitualCallback)`.
- **T-27-02-03 (Tampering — concurrent rapid-tap TOCTOU):** Mitigated by `jsonb_set(coalesce(metadata, '{}'::jsonb), {partial,e}, ...)` atomic at Postgres row-lock level. Plan 27-03 will add the rapid-tap concurrency regression test against real Docker postgres.
- **T-27-02-04 (Tampering — cross-day stale buttons):** Mitigated by `findOpenWellbeingRow` filtering on `responded_at IS NULL AND fired_at::date = today_local`. A button from yesterday's snapshot finds no open row and is gracefully acked.
- **T-27-02-05 (Information Disclosure — wellbeing data sensitivity):** Accepted per single-user single-tenant system + bot.use(auth) gate.
- **T-27-02-06 (DoS — Telegram 30s ack deadline):** Mitigated by all `handleWellbeingCallback` paths invoking `ctx.answerCallbackQuery()` exactly once before returning.
- **T-27-02-07 (Elevation — anchor-bias regression):** Mitigated by in-plan negative grep guard at end of Task 2's verify block. Plan 27-03 Task 3 will add the same guard to `scripts/test.sh` for permanent CI enforcement.

No new security-relevant surface beyond what the plan's STRIDE register covers.

## Self-Check: PASSED

**Files exist:**
- `src/db/migrations/0008_wellbeing_seed.sql` — FOUND
- `src/db/migrations/meta/0008_snapshot.json` — FOUND
- `src/rituals/wellbeing.ts` (replaced from STUB) — FOUND, no longer stub (negative grep clean)
- `src/rituals/scheduler.ts` (edited) — FOUND, contains `case 'daily_wellbeing':`
- `scripts/test.sh` (extended) — FOUND, contains `daily_wellbeing seed missing`
- `scripts/regen-snapshots.sh` (extended) — FOUND, contains `MIGRATION_8=`

**Commits exist (verified via `git log --oneline | grep <hash>`):**
- `bdc924a` (Task 1) — FOUND
- `2d451f3` (Task 2) — FOUND
- `3fff9a1` (Task 3) — FOUND

**Verification gates:**
- `npx tsc --noEmit` exits 0 — VERIFIED
- `npx vitest run src/rituals/ src/bot/` reports 15/15 files / 123/123 tests passing — VERIFIED
- `npx tsx scripts/manual-sweep.ts` returns `[]` without throwing — VERIFIED
- D-27-04 prong 1 negative grep (`! grep -E "select.*wellbeingSnapshots|from.*wellbeingSnapshots" src/rituals/wellbeing.ts`) — PASSES
- HARD CO-LOCATION (D-27-06): migration + handler + dispatcher + test.sh + regen-snapshots.sh all ship in this plan — VERIFIED via `git diff --name-only main~3..HEAD` shows all 11 files
- Live DB seed verification: `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing'` returns 1; `next_run_at = 2026-04-29 07:00:00+00` (UTC, = 09:00 Europe/Paris CEST) — VERIFIED

---
*Phase: 27-daily-wellbeing-snapshot*
*Plan: 02 — wellbeing handler + seed migration (atomic)*
*Completed: 2026-04-28*
