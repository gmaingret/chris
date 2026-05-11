---
phase: 29-weekly-review
plan: 03
subsystem: rituals
tags:
  - migration
  - drizzle
  - postgres
  - seed
  - dispatcher
  - cron-wire-up
  - weekly-review
  - test-harness

# Dependency graph
requires:
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: rituals table + ritual_cadence enum + name UNIQUE + dispatchRitualHandler skeleton + scripts/regen-snapshots.sh + scripts/test.sh substrate gate pattern
  - phase: 26-daily-voice-note-ritual/02
    provides: dispatchRitualHandler signature (ritual, cfg) → Promise<RitualFireOutcome> (D-26-08); MIGRATION_7 + 0007_snapshot.json + scripts/test.sh seed-row gate precedent
  - phase: 27-daily-wellbeing-snapshot/02
    provides: pure-DML migration meta-snapshot pattern (clone N-1_snapshot.json with re-chained id/prevId — drizzle-kit reports "No schema changes"); MIGRATION_8 + scripts/test.sh wellbeing seed-row gate precedent
  - phase: 29-weekly-review/02
    provides: fireWeeklyReview(ritual, cfg) → Promise<RitualFireOutcome> exported orchestrator
provides:
  - "Migration 0009_weekly_review_seed.sql: idempotent INSERT seeding weekly_review ritual at next Sunday 20:00 Europe/Paris"
  - "src/db/migrations/meta/0009_snapshot.json + _journal.json idx=9 entry"
  - "src/rituals/scheduler.ts dispatchRitualHandler routes 'weekly_review' → fireWeeklyReview"
  - "scripts/test.sh post-migration-9 seed-row smoke gate (fails BEFORE vitest if seed missing)"
  - "scripts/regen-snapshots.sh extended for migration 0009 lineage"
  - "src/rituals/__tests__/scheduler.test.ts — 2 new tests (10 total): weekly_review routing + default-throw safety belt"
  - "WEEK-01 (fire-side: cron-driven dispatch + seed row) verifiably met"
affects:
  - 29-04 (live anti-flattery test scaffolding will exercise the now-wired dispatch path)
  - 30-validation-fixtures (14-day synthetic-fixture test TEST-29/30 layers automated coverage atop the wire-up)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "Pure-DML migration with hand-cloned meta snapshot (Phase 27 pattern extended): when a migration adds a seed row but no schema delta, drizzle-kit prints 'No schema changes, nothing to migrate' and produces no new snapshot file. The journal still requires an Nth entry, so we hand-clone meta/(N-1)_snapshot.json to meta/N_snapshot.json with re-chained id/prevId."
    - "Per-phase seed migration ownership (D-09): each consumer phase owns its own ritual seed (Phase 26→0007 voice_note, Phase 27→0008 wellbeing, Phase 29→0009 weekly_review). Sequential filename ordering coordinated at merge time; each migration is INSERT-only so cross-phase merges don't conflict."
    - "Deterministic SQL CASE for next_run_at computation (D-09): avoids application-time JS computation; same-day-after-fire edge case handled by branching on extract(dow ...) + time-of-day comparison. weekly_review uses 13-day-vs-6-day branch for next-Sunday selection."
    - "Cross-file isolation for shared-DB integration tests: the new scheduler.test.ts weekly_review-routing test snapshots all OTHER rituals' nextRunAt to a far-future value before sweep, then restores in finally. Prevents earlier-running test files (e.g. wellbeing.test.ts, voice-note.test.ts) from leaving past-due rows that would starve the weekly_review dispatch under runRitualSweep's ASC ordering."
    - "vi.mock module-level hoisting for non-exported dispatcher functions: dispatchRitualHandler is private to scheduler.ts; vi.mock('../weekly-review.js', () => ({ fireWeeklyReview: vi.fn() })) intercepts the module import so the dispatch case is exercised via runRitualSweep without invoking the real Sonnet pipeline."

key-files:
  created:
    - src/db/migrations/0009_weekly_review_seed.sql
    - src/db/migrations/meta/0009_snapshot.json
  modified:
    - src/db/migrations/meta/_journal.json
    - src/db/migrations/meta/0001_snapshot.json  # UUID re-roll by regen-snapshots.sh (idempotent re-introspect)
    - src/db/migrations/meta/0002_snapshot.json  # UUID re-roll
    - src/db/migrations/meta/0003_snapshot.json  # UUID re-roll
    - src/db/migrations/meta/0004_snapshot.json  # UUID re-roll
    - src/rituals/scheduler.ts                   # +1 import, +1 case, doc comment refresh
    - src/rituals/__tests__/scheduler.test.ts    # +2 tests, +vi.mock import, afterAll restoration
    - scripts/test.sh                            # +MIGRATION_9_SQL apply + Phase 29 seed-row gate
    - scripts/regen-snapshots.sh                 # +MIGRATION_9 const, acceptance chain, cleanup names

key-decisions:
  - "fire_dow=7 (Sunday) per RitualConfigSchema.fire_dow z.number().int().min(1).max(7) (src/rituals/types.ts:47). Plan brief and CONTEXT.md D-09 noted both 0=Sun and 7=Sun conventions as candidates; the source-of-truth schema constraint resolves to 1..7. Using fire_dow=0 would fail RitualConfigSchema.parse() at every read boundary — explicitly required by the must_haves truth 'config jsonb parses through RitualConfigSchema.parse() without throwing'."
  - "0009_snapshot.json hand-cloned from 0008 (Phase 27 pure-DML pattern): migration 0009 is pure DML (idempotent INSERT, no schema delta). drizzle-kit's regen acceptance gate prints 'No schema changes, nothing to migrate'. Journal-snapshot 1:1 invariant preserved by hand-cloning with new UUID + prevId chain pointing at 0008's id (9a140c14-3cd7-4f3c-970e-ed62b4fb1886). Schema content byte-identical to 0008 = correct (zero schema delta)."
  - "Cross-file isolation in scheduler.test.ts new tests: the weekly_review-routing test snapshots all enabled-ritual nextRunAt values to a far-future date before running sweep, restores them in finally. Required because the rituals test directory (13 files, 133 tests) shares one Docker postgres; vitest's fileParallelism=false serializes files but DB state from prior files (wellbeing.test.ts, voice-note.test.ts) can leave past-due rows that would win runRitualSweep's ASC ordering and starve the weekly_review dispatch we want to verify."
  - "Default-branch test uses type='monthly' + unmapped FIXTURE_PREFIX-scoped name (no 'monthly_retro' handler exists yet — only weekly_review/daily_voice_note/daily_wellbeing are wired). Per Phase 25 substrate semantics: atomic UPDATE...RETURNING already advanced nextRunAt by the time control reaches the default branch, so outcome='fired' is correct (the slot was claimed); the handler error is captured in results[0].error for visibility but does not reverse substrate state."

patterns-established:
  - "Pattern 1: Cross-file isolation for shared-DB scheduler tests — when a scheduler.test.ts test exercises runRitualSweep against a shared rituals table, snapshot all OTHER rituals' nextRunAt to far-future before the sweep, then restore in finally. Prevents prior-file state (wellbeing.test.ts past-due rows, voice-note.test.ts past-due rows) from starving the dispatch under ASC ordering. Generalizable to any future Plan that adds a 'this-handler-routed-via-dispatch' integration test."
  - "Pattern 2: Restore real seed nextRunAt in afterAll — when a test mutates the real seed row's nextRunAt (e.g., setting weekly_review to past for a routing test), the cleanFixtures helper (which is name-prefix-scoped to sched-test-*) cannot restore the seed. Add explicit `db.update(rituals).set({nextRunAt: farFuture}).where(eq(rituals.name, 'weekly_review'))` in afterAll so subsequent test files see the seed's original future state."

requirements-completed: [WEEK-01]

# Metrics
duration: 9 min
completed: 2026-04-29
---

# Phase 29 Plan 03: Wire-up — Migration 0009 + Dispatcher Case + Drizzle Meta + Test Harness Summary

**WEEK-01 fire-side substrate ships: migration 0009_weekly_review_seed.sql is idempotent + applies cleanly to fresh Docker postgres (Sunday 20:00 Europe/Paris next_run_at via deterministic SQL CASE), drizzle-kit acceptance gate green, dispatchRitualHandler routes 'weekly_review' → fireWeeklyReview from Plan 29-02, scripts/test.sh exits with the seed-row gate green, and 2 new scheduler.test.ts tests prove the dispatch path end-to-end. The full pipeline (cron tick → runRitualSweep → tryFireRitualAtomic → dispatchRitualHandler → fireWeeklyReview) is now invocable for the first time at the next Sunday 20:00 Paris cron tick.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-29T00:20:53Z
- **Completed:** 2026-04-29T00:30:19Z
- **Tasks:** 4 (Tasks 1-3 implementation atomic + Task 4 checkpoint:human-verify auto-acknowledged per --auto chain mode; UAT script documented below for Greg's post-deploy verification)
- **Files created:** 2 (migration SQL + meta snapshot)
- **Files modified:** 8 (test.sh + regen-snapshots.sh + scheduler.ts + scheduler.test.ts + 4 meta snapshot UUID re-rolls + _journal.json)
- **Commits:** 3 (Tasks 1, 2, 3)
- **Tests:** 10/10 scheduler.test.ts (in isolation); 133/133 across 13 files in full src/rituals/__tests__/ run
- **Smoke gate green:** scripts/test.sh prints `✓ Phase 29 seed-row gate: weekly_review present` post-migration BEFORE vitest fires
- **Drizzle acceptance gate green:** scripts/regen-snapshots.sh prints `✓ Snapshot regeneration acceptance gate: No schema changes`

## Cross-phase Coordination

**Migration filename slot used: 0009.** Phase 26 owns 0007 (daily_voice_note seed, shipped 2026-04-28), Phase 27 owns 0008 (daily_wellbeing seed, shipped 2026-04-28), Phase 29 (this plan) owns 0009. Per CONTEXT.md D-09: per-phase migration ownership with sequential filename ordering coordinated at merge time. No filename-slot conflict at merge time because Phase 26 + 27 had already landed before Plan 29-03 began (verified via `ls src/db/migrations/`).

**Phase 27 pure-DML pattern reused verbatim.** Phase 27 SUMMARY documented the hand-clone-from-(N-1)-with-rechained-id pattern for pure-DML migrations. Plan 29-03 followed the pattern: cloned 0008_snapshot.json → 0009_snapshot.json with new UUID `5a4af9ee-f13b-44cd-9ba8-7ab33daed66e` and prevId pointing at 0008's id `9a140c14-3cd7-4f3c-970e-ed62b4fb1886`. Schema content byte-identical to 0008 (proves zero schema delta).

**Phase 26 dispatcher signature reused verbatim.** Phase 26 D-26-08 already shipped the `(ritual, cfg) → Promise<RitualFireOutcome>` shape. Plan 29-03's dispatcher case is the canonical one-liner: `case 'weekly_review': return fireWeeklyReview(ritual, cfg);` — same shape as the existing `daily_voice_note` and `daily_wellbeing` cases (lines 272-275 of scheduler.ts).

## Accomplishments

### Migration 0009 — weekly_review seed (D-09 + WEEK-01)

**`src/db/migrations/0009_weekly_review_seed.sql`** seeds the `weekly_review` ritual idempotently. Highlights:

- **Single INSERT + ON CONFLICT idempotency:** `INSERT INTO rituals (...) VALUES ('weekly_review', 'weekly', <CASE>, true, <jsonb>) ON CONFLICT (name) DO NOTHING`. Re-applying against an already-seeded DB is a no-op; safe for cold-starts, raw-psql apply paths in scripts/test.sh, manual re-applies, or recovery from a botched partial deploy.
- **Deterministic SQL CASE for next_run_at (D-09):** `date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '6 days 20 hours'` returns next Sunday 20:00 Paris. The CASE branches: if migration applies on Sunday after 20:00 Paris (extract(dow ...) = 0 AND time > 20:00) → schedule for the FOLLOWING Sunday (+13 days 20 hours from current week's Monday). Otherwise → THIS Sunday at 20:00. Avoids ever setting next_run_at in the past.
- **RitualConfigSchema-conformant jsonb (7 of 8 fields):** `fire_at: '20:00'`, `fire_dow: 7` (Sunday per 1-7 schema convention), `skip_threshold: 2` (weekly cap; daily uses 3), `mute_until: null`, `time_zone: 'Europe/Paris'`, `prompt_set_version: 'v1'`, `schema_version: 1`. `prompt_bag` omitted (optional; weekly review uses no rotating bag — assembleWeeklyReviewPrompt builds the prompt at runtime).
- **Live verification:** scripts/test.sh's smoke gate runs `SELECT count(*) FROM rituals WHERE name = 'weekly_review'` post-migration; gate output `✓ Phase 29 seed-row gate: weekly_review present` confirmed across all four `bash scripts/test.sh ...` invocations during plan execution.

### Drizzle meta lineage

- **`src/db/migrations/meta/0009_snapshot.json`** — hand-cloned from `0008_snapshot.json` with new UUID + re-chained prevId (Phase 27 pure-DML pattern). Schema content byte-identical to 0008 = correct (zero schema delta).
- **`src/db/migrations/meta/_journal.json`** — appended idx=9 entry: `{ idx: 9, version: '7', when: 1777422168284, tag: '0009_weekly_review_seed', breakpoints: true }`.
- **`scripts/regen-snapshots.sh`** — extended `MIGRATION_9` constant; acceptance-gate apply chain extended to include 0009; cleanup names bumped from 0009_* to 0010_* (drizzle-kit's next sequence after 0009 is 0010); REGEN_PRODUCED_ACCEPTANCE flag preserves committed 0009_snapshot.json on EXIT trap.
- **Acceptance gate verified:** `bash scripts/regen-snapshots.sh` runs end-to-end against the regen postgres on port 5434, prints `No schema changes, nothing to migrate 😴` and exits with `✓ Snapshot regeneration acceptance gate: No schema changes`.

### Dispatcher wire-up (D-08 = D-29-08)

**`src/rituals/scheduler.ts`** dispatchRitualHandler now routes all three M009 phase handlers:

```typescript
switch (ritual.name) {
  case 'daily_voice_note':
    return fireVoiceNote(ritual, cfg);
  case 'daily_wellbeing':
    return fireWellbeing(ritual, cfg);
  case 'weekly_review':
    return fireWeeklyReview(ritual, cfg);
  default:
    throw new Error(`rituals.dispatch: handler not implemented for ${ritual.name}`);
}
```

D-26-08 invariant preserved: switches on `ritual.name` (NOT `ritual.type`) because cadence is shared across multiple rituals (e.g., daily_voice_note and daily_wellbeing are both 'daily'). The `default:` throw is the safety belt for future M013 monthly/quarterly rituals seeded before their handler lands.

### scripts/test.sh substrate gate

After the existing migration block (currently 0000..0008), the new line applies migration 0009. After the Phase 27 wellbeing gate, the new Phase 29 gate runs:

```bash
SEED_CHECK=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq \
  -c "SELECT count(*) FROM rituals WHERE name = 'weekly_review';" | tr -d '[:space:]')
if [[ "$SEED_CHECK" != "1" ]]; then
  echo "❌ FAIL: weekly_review seed row missing (got count=$SEED_CHECK, expected 1)"
  exit 1
fi
echo "✓ Phase 29 seed-row gate: weekly_review present"
```

Mirrors Phase 26 voice-note + Phase 27 wellbeing single-line gate shapes. Runs at line 155 vs `npx vitest run` at line 181 — gate fires BEFORE vitest fires (positional check passes; verified with awk pattern). Failure exits 1 BEFORE any test runs (catches lineage mismatches before false-positive type-checked tests).

### scheduler.test.ts coverage extension

**+2 tests (10 total: 8 → 10).** Both leverage `vi.mock('../weekly-review.js', () => ({ fireWeeklyReview: vi.fn().mockResolvedValue('fired') }))` hoisted by vitest so the mock is in place before scheduler.js loads.

1. **`'Phase 29 D-29-08: dispatchRitualHandler routes weekly_review to fireWeeklyReview'`** — Snapshots all OTHER enabled rituals' nextRunAt to a far-future date (cross-file isolation), updates the real `weekly_review` seed row's nextRunAt to past, runs `runRitualSweep`, asserts mock called exactly once with `(ritual, cfg)` shape (`ritual.name === 'weekly_review'`, `ritual.type === 'weekly'`, `cfg.fire_at === '20:00'`). `finally` restores other rituals' nextRunAt.
2. **`'Phase 29 D-29-08: default branch throws for unmapped ritual.name (safety belt)'`** — Inserts a ritual with FIXTURE_PREFIX-scoped name + `type: 'monthly'`, runs sweep, asserts outcome='fired' (atomic UPDATE succeeded → slot claimed) BUT `error` contains 'handler not implemented' AND the test fixture's name (verifies the throw message includes the actual `ritual.name`).

`afterAll` extended to restore the real `weekly_review` seed's nextRunAt to far-future after the routing test mutates it.

### Live DB verification (UAT — auto-acknowledged per --auto chain mode)

Per orchestrator directive ("In `--auto` mode, complete the automated portion + write a UAT note in the SUMMARY for Greg to verify post-deploy"), Task 4's checkpoint:human-verify is auto-acknowledged. The automated portion of Task 4 was fully completed by Tasks 1-3 verifications:
- ✅ Migration 0009 applied + seed row exists (verified by scripts/test.sh smoke gate, 4 separate runs)
- ✅ Drizzle meta snapshot regenerated (verified by scripts/regen-snapshots.sh acceptance gate)
- ✅ scripts/test.sh post-migration gate passes (`✓ Phase 29 seed-row gate: weekly_review present`)
- ✅ dispatchRitualHandler('weekly_review') routes to fireWeeklyReview (verified by new scheduler.test.ts test against real Docker postgres)

**Manual UAT script for Greg's post-deploy verification (requires real `ANTHROPIC_API_KEY` + `TELEGRAM_BOT_TOKEN`):**

```bash
# 1. Bring up fresh test postgres + apply all migrations
docker compose -f docker-compose.local.yml up -d postgres
for f in src/db/migrations/00??_*.sql; do
  docker compose -f docker-compose.local.yml exec -T postgres \
    psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$f"
done

# 2. Confirm seed row + future next_run_at
docker compose -f docker-compose.local.yml exec -T postgres \
  psql -U chris -d chris -c "SELECT name, type, enabled, next_run_at FROM rituals WHERE name = 'weekly_review';"
# Expect: 1 row, enabled=true, next_run_at = next Sunday 20:00 Paris

# 3. Time-warp: force next_run_at into the past so runRitualSweep picks it up
docker compose -f docker-compose.local.yml exec -T postgres \
  psql -U chris -d chris -c "UPDATE rituals SET next_run_at = now() - interval '1 hour' WHERE name = 'weekly_review';"

# 4. Manually invoke the sweep (Phase 25 substrate; existing scripts/manual-sweep.ts)
ANTHROPIC_API_KEY=<real-key> TELEGRAM_BOT_TOKEN=<real-token> \
  npx tsx scripts/manual-sweep.ts

# 5. Expected observations:
#   - Telegram message arrives in Greg's chat starting with the D031 boundary marker
#     "Observation (interpretation, not fact):" followed by \n\n + observation + \n\n + question
#   - Pensieve query: SELECT * FROM pensieve_entries WHERE metadata->>'kind' = 'weekly_review'
#     ORDER BY created_at DESC LIMIT 1 — returns 1 row with epistemic_tag = 'RITUAL_RESPONSE'
```

If anomaly detected post-deploy, document the specific failing step + return to relevant Task. Per HARD CO-LOC #6, the live anti-flattery 3-of-3 atomic test (TEST-31) is owned by Phase 30 — Plan 29-04 ships the test scaffolding (this plan does NOT cover that test surface).

## Task Commits

Each task was committed atomically (single-repo, no sub_repos):

1. **Task 1 — Migration 0009 + drizzle meta + regen-snapshots extension** — `7dc35c9` (feat)
2. **Task 2 — Migration 0009 apply + seed-row smoke gate in scripts/test.sh** — `2fbdadb` (feat)
3. **Task 3 — Wire weekly_review case into dispatchRitualHandler + 2 scheduler tests** — `45d9995` (feat)
4. **Task 4 — Auto-acknowledged per --auto chain mode (no commit; UAT script documented above)**

## Files Created/Modified

### Created (2)

- **`src/db/migrations/0009_weekly_review_seed.sql`** — Idempotent INSERT seeding weekly_review ritual at next Sunday 20:00 Europe/Paris with deterministic SQL CASE for same-day-after-fire edge case + RitualConfigSchema-conformant jsonb (7 of 8 named fields populated).
- **`src/db/migrations/meta/0009_snapshot.json`** — Cloned from `0008_snapshot.json` (pure-DML migration, no schema delta) with new UUID `5a4af9ee-f13b-44cd-9ba8-7ab33daed66e` and prevId chaining from 0008. Schema content byte-identical to 0008.

### Modified (8)

- **`src/rituals/scheduler.ts`** — Added `import { fireWeeklyReview } from './weekly-review.js';` + new `case 'weekly_review':` branch in `dispatchRitualHandler`. Refreshed JSDoc to reflect Phase 29 D-29-08 wiring.
- **`src/rituals/__tests__/scheduler.test.ts`** — Added `vi.mock('../weekly-review.js', ...)` module-level mock + 2 new tests covering routing + default-throw safety belt. afterAll extended to restore real seed's nextRunAt.
- **`src/db/migrations/meta/_journal.json`** — Appended idx=9 entry for `0009_weekly_review_seed`.
- **`src/db/migrations/meta/0001_snapshot.json` / `0002` / `0003` / `0004`** — UUID re-rolls produced by `bash scripts/regen-snapshots.sh` clean-slate replay (drizzle-kit assigns fresh UUIDs to introspected snapshots; chain re-points 0002.prevId → new 0001.id etc. — Phase 25 LEARNINGS pattern, not a manual edit, NOT a regression).
- **`scripts/regen-snapshots.sh`** — Added `MIGRATION_9="${MIGRATIONS_DIR}/0009_weekly_review_seed.sql"`; extended acceptance-gate apply chain to apply 0009; bumped acceptance-check artifact cleanup names from `0009_*` to `0010_*` (drizzle-kit's next sequence after 0009); top-of-file comment refreshed to call out Phase 29's 0009 addition.
- **`scripts/test.sh`** — Added `MIGRATION_9_SQL` constant + apply line + post-migration seed-row smoke gate (mirrors Phase 26+27 single-line gate shape). Gate runs BEFORE `npx vitest run` at line 155 vs 181 (positional check verified).

## Decisions Made

### fire_dow=7 (not 0) — schema constraint takes precedence over plan brief

The plan brief and CONTEXT.md D-09 referenced both `fire_dow=0` and `fire_dow=7` as candidates for "Sunday." The actual `RitualConfigSchema` constraint at `src/rituals/types.ts:47` is `z.number().int().min(1).max(7).optional()` — the 1=Mon..7=Sun convention. Using `fire_dow=0` would fail `RitualConfigSchema.parse()` at every read boundary. Plan acceptance criteria explicitly require: "config jsonb parses through RitualConfigSchema.parse() without throwing." Resolution: use `fire_dow=7`. The seed migration's comment block calls out the source-of-truth constraint at types.ts:47 + cites the plan's note acknowledging the convention reconciliation.

### Cross-file isolation for the new routing test

The first iteration of the routing test passed in isolation (10/10) but failed in the full rituals suite (1 fail / 132 pass). Root cause analysis: vitest's `fileParallelism: false` serializes file execution but the rituals test directory shares one Docker postgres. Earlier-running test files (wellbeing.test.ts, voice-note.test.ts) leave ritual rows with past `nextRunAt`, which win `runRitualSweep`'s ASC ordering and starve the weekly_review dispatch. Defense-in-depth fix: snapshot all OTHER enabled rituals' nextRunAt to far-future before sweep, restore in `finally`. Reset the channel counter just before sweep so prior counter state doesn't trip the cap-reached short-circuit. After fix: 10/10 in isolation + 133/133 across 13 files.

### Default-branch test uses unmapped FIXTURE_PREFIX-scoped name

Plan brief's example for the default-throw test mentioned `'daily_voice_note'` "or whatever Phase 26 hasn't shipped yet." Since Phase 26+27+29 have all shipped now, NO daily/weekly cases throw via default. Used `${FIXTURE_PREFIX}unmapped` with `type: 'monthly'` instead — verifies the safety belt for future M013 monthly/quarterly rituals seeded before their handler lands. The test asserts `error.message` contains both `'handler not implemented'` AND the fixture's name, confirming the throw includes the actual `ritual.name`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] fire_dow=7 (not 0) per RitualConfigSchema constraint**

- **Found during:** Task 1 (authoring migration 0009).
- **Issue:** Plan brief + CONTEXT.md "Specifics" referenced `fire_dow=0` ("0 (Sunday — JS Sunday=0)") AND `fire_dow=7` ("if 1=Mon..7=Sun, use 7") as candidates. The actual `RitualConfigSchema.fire_dow` constraint at `src/rituals/types.ts:47` is `z.number().int().min(1).max(7)`, so `0` is INVALID. The plan's `must_haves.truths` requires: "config jsonb parses through RitualConfigSchema.parse() without throwing" — using `fire_dow=0` would violate this gate.
- **Fix:** Used `fire_dow=7`. The migration's comment block calls out the source-of-truth constraint at types.ts:47 + the convention reconciliation. Verified: scripts/test.sh smoke gate green across all 4 invocations confirms the row INSERT succeeded, which transitively confirms the jsonb literal parses (the migration would fail with a CHECK or the smoke gate's count would not be 1).
- **Files modified:** src/db/migrations/0009_weekly_review_seed.sql
- **Committed in:** `7dc35c9` (Task 1)
- **Forward note:** Plan 30+ should ratify the convention in CONTEXT.md / REQUIREMENTS.md so future migrations don't re-encounter this ambiguity. The 1=Mon..7=Sun convention should be documented as the canonical project convention with reference to types.ts:47.

**2. [Rule 3 — Blocking] Cross-file isolation for scheduler.test.ts new routing test**

- **Found during:** Task 3 verification gate (full rituals suite run).
- **Issue:** First iteration of the new `'Phase 29 D-29-08: dispatchRitualHandler routes weekly_review to fireWeeklyReview'` test passed in isolation (`bash scripts/test.sh src/rituals/__tests__/scheduler.test.ts` → 10/10) but FAILED in the full rituals/__tests__/ suite run (1 fail / 132 pass). Root cause: vitest's `fileParallelism: false` serializes file execution but earlier-running test files (wellbeing.test.ts, voice-note.test.ts) leave ritual rows with past nextRunAt, which win runRitualSweep's ASC ordering and starve the weekly_review dispatch we want to verify.
- **Fix:** Made the test cross-file robust — snapshot all OTHER enabled rituals' nextRunAt to far-future before running sweep, restore in `finally`. Reset the channel counter just before sweep so prior counter state doesn't trip the cap-reached short-circuit.
- **Files modified:** src/rituals/__tests__/scheduler.test.ts
- **Verification:** scheduler tests 10/10 in isolation; full rituals/__tests__/ suite 133/133 across 13 files.
- **Committed in:** `45d9995` (Task 3)
- **Forward note:** Generalizable as a pattern (documented in patterns-established #1) for any future Plan that adds a "this-handler-routed-via-dispatch" integration test against the shared rituals table.

### Plan-script reality reconciliation (not a deviation)

**3. Phase 26 + 27 had already shipped before Plan 29-03 began.**

- **Reality:** scheduler.ts already contained `case 'daily_voice_note':` and `case 'daily_wellbeing':` (filled by Phases 26 + 27). The plan's snippet showed only the Phase 25 throwing-skeleton baseline; the actual switch had real branches. Plan 29-03 added the `'weekly_review'` case alongside the existing two, kept the `default:` throw.
- **Impact:** None. The plan explicitly anticipated this in `<action>` step "Cross-phase coordination" — "If Phase 26 / 27 shipped first, the switch already has additional cases. Plan 29-03's executor: 1. Reads the current switch state (post-Phase 26/27 if they merged first), 2. Adds the `case 'weekly_review':` branch alongside any existing cases, 3. Keeps the `default:` throw for unimplemented handlers." This is exactly what was done.

## Authentication Gates

None encountered. Plan 29-03 is migration + dispatch wire-up + test harness extension. Tests use `vi.mock('../weekly-review.js', ...)` so no real Anthropic API key was required at any point. Real Docker postgres on port 5433 was used for integration tests via `bash scripts/test.sh` per MEMORY rule "always run full Docker tests, never skip integration tests, always start real postgres."

## Issues Encountered

### Pre-existing full-suite test isolation issues (out of scope, deferred)

Running `bash scripts/test.sh` against the FULL repo (no test-file filter) is known per Plan 27-01's `deferred-items.md` to surface live-LLM 401 errors + HuggingFace EACCES + DB cross-contamination. None of these affect Plan 29-03's scope:
- The scripts/test.sh smoke gate exits 1 if seed row missing — that gate fires BEFORE vitest, so a missing seed would block tests entirely. The gate prints `✓ Phase 29 seed-row gate: weekly_review present` cleanly, confirming migration 0009 applies + seeds correctly.
- The plan-relevant scope (`bash scripts/test.sh src/rituals/__tests__/`) is 133/133 green across 13 files — within scope, fully passing.

Recommendation per Phase 27 SUMMARY: continue tracking the deferred test-harness work separately from M009's feature plans.

## Known Stubs

None. Plan 29-03 is wire-up only — the underlying handler `fireWeeklyReview` was fully implemented by Plan 29-02 (`src/rituals/weekly-review.ts:517-652`). The dispatcher case routes to that real implementation; there are no placeholder branches.

## TDD Gate Compliance

Plan 29-03 is `type: execute` (not `type: tdd`), so plan-level TDD gate enforcement does not apply. Per-task discipline: each task's tests + grep gates were authored alongside the implementation. Task 3's 2 new scheduler tests were written + verified against real Docker postgres in the same commit (`45d9995`). No retroactive test addition.

## User Setup Required

**None for production deploy.** The seed migration runs automatically on next `bash scripts/test.sh` (or production `drizzle-kit migrate`) and is idempotent.

**For Greg's manual UAT verification (post-deploy, requires live env):** see "Live DB verification" section above. Requires real `ANTHROPIC_API_KEY` + `TELEGRAM_BOT_TOKEN` in the executing shell — these are not auto-acknowledged by Plan 29-03.

## Next Phase Readiness

- **Plan 29-04 unblocked.** The `weekly_review` dispatch path is fully wired end-to-end. Plan 29-04's live anti-flattery test scaffolding can call `generateWeeklyObservation` (Plan 29-02 export) directly with adversarial fixture content to exercise the full Sonnet pipeline (when Phase 30 flips the `skipIf(!ANTHROPIC_API_KEY)` gate).
- **Phase 30 (TEST-29/30/31) unblocked.** The 14-day synthetic-fixture pipeline + live anti-flattery 3-of-3 atomic test will both layer atop the now-wired dispatch path.
- **First Sunday 20:00 Paris cron tick will fire weekly review.** After deploy, `runRitualSweep` running on the existing 21:00 Paris cron will find the `weekly_review` seed due (its `next_run_at` is set to next Sunday 20:00 Paris by the migration's deterministic SQL CASE), call `dispatchRitualHandler` → `fireWeeklyReview` → Sonnet → Telegram → Pensieve. WEEK-01 fire-side substrate verifiably met.

## Threat Flags

None. The plan's `<threat_model>` STRIDE register (T-29-03-01..04) is fully satisfied by the implementation:

- **T-29-03-01 (Tampering — Migration 0009 INSERT against production DB):** accept — INSERT-only, no schema change, ON CONFLICT (name) DO NOTHING idempotency. Single-user system, manual deploy gate. Re-apply is safe (verified: scripts/test.sh re-runs the migration each invocation; the smoke gate continues to print `count=1`).
- **T-29-03-02 (Tampering / DoS — Migration race across Phases 26/27/29):** mitigate — All three phases shipped sequentially before Plan 29-03 began; no merge-time conflict occurred. Per CONTEXT.md D-09 mitigation: the regen script's clean-slate replay would catch any lineage breakage at CI before deploy. Verified: `bash scripts/regen-snapshots.sh` end-to-end clean.
- **T-29-03-03 (EoP — dispatchRitualHandler routes on `ritual.name` from DB row):** accept — `ritual.name` sourced from the rituals table populated only by hand-authored migrations (no user input path). Single-user system, no SQL-injection vector since `ritual.name` is a DB read used as a string switch key.
- **T-29-03-04 (Information Disclosure — next_run_at SQL CASE assumes operator-supplied 'Europe/Paris' timezone):** accept — Hardcoded in seed migration per Greg's profile (single-user). Future multi-tenant work would replace with config lookup; not Phase 29 scope.

No new security-relevant surface beyond what the plan's STRIDE register covers.

## Self-Check: PASSED

**Files exist:**
- `src/db/migrations/0009_weekly_review_seed.sql` — FOUND
- `src/db/migrations/meta/0009_snapshot.json` — FOUND (47758 bytes, byte-equal to 0008's schema content)
- `scripts/regen-snapshots.sh` (extended) — FOUND, contains `MIGRATION_9=`
- `scripts/test.sh` (extended) — FOUND, contains `MIGRATION_9_SQL=` + `Phase 29 seed-row gate`
- `src/rituals/scheduler.ts` (edited) — FOUND, contains `case 'weekly_review':` + `from './weekly-review.js'`
- `src/rituals/__tests__/scheduler.test.ts` (extended) — FOUND, contains the 2 new Phase 29 D-29-08 test cases

**Commits exist (verified via `git log --oneline | grep <hash>`):**
- `7dc35c9` (Task 1) — FOUND
- `2fbdadb` (Task 2) — FOUND
- `45d9995` (Task 3) — FOUND

**Verification gates:**
- `bash scripts/regen-snapshots.sh` exits 0 with `✓ Snapshot regeneration acceptance gate: No schema changes` — VERIFIED
- `bash scripts/test.sh src/rituals/__tests__/scheduler.test.ts` prints `✓ Phase 29 seed-row gate: weekly_review present` + Tests 10/10 passed — VERIFIED
- `bash scripts/test.sh src/rituals/__tests__/` reports 13 files / 133 tests passed — VERIFIED
- `npx tsc --noEmit` exits 0 — VERIFIED
- All Task 1, 2, 3 grep gates from the plan's verify blocks return their expected counts — VERIFIED

---
*Phase: 29-weekly-review*
*Plan: 03 — wire-up: migration 0009 + dispatcher case + drizzle meta + test harness*
*Completed: 2026-04-29*
