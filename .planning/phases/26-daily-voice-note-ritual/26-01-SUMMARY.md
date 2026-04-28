---
phase: 26-daily-voice-note-ritual
plan: 01
subsystem: database
tags: [migration, drizzle, postgres, rituals, voice-note, rotation, vitest]

# Dependency graph
requires:
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: rituals table + ritual_pending_responses table + RITUAL_RESPONSE epistemic_tag enum value + cron tick + 6|1|3 substrate gate + migration 0006 hand-SQL precedent
provides:
  - Migration 0007 with idempotent seed insert for the daily_voice_note ritual (D-26-01)
  - prompt_text NOT NULL column on ritual_pending_responses via DEFAULT-then-DROP-DEFAULT pattern (amended D-26-02)
  - PP#5 hot-path partial index ritual_pending_responses_chat_id_active_idx ON (chat_id, expires_at) WHERE consumed_at IS NULL
  - src/rituals/voice-note.ts substrate exporting PROMPTS (frozen 6-element tuple in spec order), PROMPT_SET_VERSION='v1', RESPONSE_WINDOW_HOURS=18, RITUAL_SUPPRESS_DEPOSIT_THRESHOLD=5
  - chooseNextPromptIndex pure shuffled-bag rotation function with rng/lastIndex parameters and head-swap guard
  - voice-note.test.ts + prompt-rotation-property.test.ts (13 green tests; 600/5000-fire property invariants empirically proven)
  - scripts/test.sh extended with migration 0007 apply + 3-leg substrate gate (seed + index + prompt_text)
  - scripts/regen-snapshots.sh extended to cover all 8 migrations (0000..0007); cleanup trap parametrized for future-N safety
affects: [26-02 voice-note handler + PP#5 detector, 26-03 pre-fire suppression, 26-04 voice-decline handler, 27 wellbeing snapshot ritual, 29 weekly review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-authored SQL migration with drizzle-kit-regenerated meta-snapshot (Phase 25 D-25-01-A precedent extended): drizzle-kit generate produces meta/0007_snapshot.json + _journal.json entry; SQL file replaced with hand-authored idempotent variant; SQL behavior is byte-equivalent to drizzle's net schema effect"
    - "DEFAULT-then-DROP-DEFAULT pattern for ALTER TABLE ADD COLUMN ... NOT NULL on zero-row tables (avoids backfill ambiguity)"
    - "Partial index declared in schema.ts via .where(sql`...`) — mirrors Phase 25 rituals_next_run_at_enabled_idx precedent"
    - "Substrate-only module pattern: src/rituals/voice-note.ts ships in Plan 26-01 as pure-function constants + rotation primitive with zero db/bot/chris/pensieve/scheduler imports; Plans 26-02..04 extend"
    - "Shuffled-bag rotation primitive with seedable rng + head-swap guard for deterministic no-consecutive-duplicate invariant across cycle boundaries"

key-files:
  created:
    - src/db/migrations/0007_daily_voice_note_seed.sql
    - src/db/migrations/meta/0007_snapshot.json
    - src/rituals/voice-note.ts
    - src/rituals/__tests__/voice-note.test.ts
    - src/rituals/__tests__/prompt-rotation-property.test.ts
  modified:
    - src/db/schema.ts (ritualPendingResponses gains promptText column + partial index declaration)
    - src/db/migrations/meta/_journal.json (idx 7 entry chained from 0006_rituals_wellbeing)
    - src/db/migrations/meta/0001_snapshot.json (id rotated by regen-snapshots.sh — Plan 20-01 design)
    - src/db/migrations/meta/0002_snapshot.json (prevId re-chained — Plan 20-01 design)
    - src/db/migrations/meta/0003_snapshot.json (id rotated)
    - src/db/migrations/meta/0004_snapshot.json (prevId re-chained)
    - scripts/regen-snapshots.sh (MIGRATION_7 constant + apply step + cleanup trap parametrized)
    - scripts/test.sh (MIGRATION_7_SQL + 3-leg substrate gate)

key-decisions:
  - "Declared the PP#5 partial index in schema.ts via .where(sql`consumed_at IS NULL`) (not just in migration SQL). Code_context noted this is cleaner — matches Phase 25's wellbeing_snapshots_snapshot_date_idx + rituals_next_run_at_enabled_idx precedent and keeps drizzle-kit's snapshot in sync with the live DB shape."
  - "drizzle-kit's auto-generated 0007_*.sql was discarded after producing the meta-snapshot; hand-authored 0007_daily_voice_note_seed.sql is the canonical SQL (drizzle-kit cannot auto-generate INSERT seed rows or DEFAULT-then-DROP-DEFAULT pattern). The auto-generated SQL would have been ALTER TABLE ... ADD COLUMN ... NOT NULL with no DEFAULT — which fails on a zero-row table only in concept, but introduces backfill ambiguity if future maintainers add rows mid-migration."
  - "Renamed cleanup-trap flag REGEN_PRODUCED_0006 → REGEN_PRODUCED_ACCEPTANCE in scripts/regen-snapshots.sh to make the future-N pattern explicit (every plan that adds a new migration extends the script; the post-acceptance-gate snapshot has a sequence-counter +1 from the plan's own migration). Cleanup paths now wipe 0008_acceptance_check*.sql and 0008_snapshot.json (the post-0007 sequence-counter slot) when this run produced them."
  - "Test expectations for chooseNextPromptIndex with rng()=0 derived by manually tracing the in-place Fisher-Yates loop. With initial fresh=[0,1,2,3,4,5] and j=Math.floor(0*(i+1))=0 for all i in [5..1], the post-shuffle array is [1,2,3,4,5,0] (NOT [0,1,2,3,4,5] — every iteration swaps fresh[i] with fresh[0], rotating the original tail through position 0)."

patterns-established:
  - "M009 phase-N seed migration: each phase that introduces a new ritual hand-authors its own migration with INSERT seed + ON CONFLICT DO NOTHING + any phase-specific column/index additions. Phase 26 extends Phase 25's substrate; Phase 27 (wellbeing) and Phase 29 (weekly review) follow the same per-phase migration shape."
  - "ALTER TABLE ADD COLUMN ... NOT NULL ... DEFAULT '' followed by ALTER COLUMN ... DROP DEFAULT — handles the zero-row at deploy / non-zero post-deploy ambiguity without needing a backfill statement. Future M009 column additions on ritual_* tables follow this idiom."
  - "Substrate-only first plan in a HARD-CO-LOC-bound phase: Plan N-01 ships pure functions + constants + DDL with zero side-effecting imports; Plan N-02 wires the handler + co-located mock-chain coverage update + engine-side detector (HARD CO-LOC enforcement). Pattern usable for Phase 27 (wellbeing) and Phase 29 (weekly review) when those phases land."
  - "Property-test for rotation primitive: 600 fires + 5000-fire stress, asserting (a) distribution within ±20% of expected, (b) no consecutive duplicates (deterministic), (c) max gap between any prompt's appearances ≤ 11. Pattern reusable for any future shuffled-bag rotation in M010+ (e.g., adversarial-test selection, fixture-day randomization)."

requirements-completed: [VOICE-02, VOICE-03]

# Metrics
duration: 1h8m
completed: 2026-04-28
---

# Phase 26 Plan 1: Migration 0007 + voice-note.ts Substrate + chooseNextPromptIndex Pure Rotation Primitive Summary

**Hand-authored migration 0007 seeds the `daily_voice_note` ritual + adds NOT NULL `prompt_text` column to `ritual_pending_responses` (DEFAULT-then-DROP-DEFAULT pattern) + creates PP#5 hot-path partial index; new `src/rituals/voice-note.ts` exports the frozen 6-prompt array + 4 SCREAMING_SNAKE_CASE tunables + `chooseNextPromptIndex` pure shuffled-bag rotation with deterministic no-consecutive-duplicate invariant proven empirically across 5600 simulated fires.**

## Performance

- **Duration:** ~1h 8min (first commit at 03:54:35 UTC, full test verification complete by 05:00:54 UTC)
- **Started:** 2026-04-28T03:49:00Z
- **Completed:** 2026-04-28T05:02:43Z
- **Tasks:** 5/5 complete
- **Files modified:** 11 (5 created, 6 modified)
- **Tests:** 13 new tests (11 unit + 2 property), all green; full Docker suite: 1170 passed / 4 skipped / 57 failed (all 57 are pre-existing baseline — see Issues Encountered)

## Accomplishments

- **Substrate for VOICE-02 (D-26-01) and VOICE-03 rotation primitive landed atomically.** PROMPTS, PROMPT_SET_VERSION, RESPONSE_WINDOW_HOURS, RITUAL_SUPPRESS_DEPOSIT_THRESHOLD, and `chooseNextPromptIndex` all in src/rituals/voice-note.ts with zero forbidden imports (no DB / bot / chris / pensieve / scheduler dependencies).
- **Migration 0007 is fully idempotent and hand-authored** — INSERT ... ON CONFLICT DO NOTHING for the seed row, ADD COLUMN IF NOT EXISTS / DROP DEFAULT pair for the prompt_text column, CREATE INDEX IF NOT EXISTS for the partial index. Drizzle meta-snapshot regenerated and chained from 0006 (id `07abf23e...` → 0007 prevId).
- **scripts/test.sh extended with a 3-leg post-migration substrate gate** (seed row exists + partial index exists + prompt_text column exists with `is_nullable='NO'`), running BEFORE vitest so substrate failures abort the suite. Mirrors Phase 25's HARD CO-LOCATION CONSTRAINT #7 discipline.
- **Property test empirically proves Pitfall 7 mitigation:** across 600 fires (then 5000 stress), the rotation cannot get stuck (distribution within ±20% / ±15%), there are zero consecutive duplicates (deterministic via head-swap guard), and the max gap between any prompt's two appearances is ≤ 11.
- **scripts/regen-snapshots.sh acceptance gate green** against fresh Docker postgres on port 5434 — all 8 migrations replay cleanly and `drizzle-kit generate` reports "No schema changes" (proving schema.ts mirrors the migration chain byte-accurately).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author migration 0007 + extend src/db/schema.ts + extend scripts/regen-snapshots.sh** — `f06a8d4` (feat)
2. **Task 2: Extend scripts/test.sh with migration 0007 apply + 3-leg substrate gate** — `7cdf809` (feat)
3. **Task 3: Author src/rituals/voice-note.ts (constants + chooseNextPromptIndex)** — `b770a01` (feat)
4. **Task 4: Author voice-note.test.ts + prompt-rotation-property.test.ts (VOICE-02 + VOICE-03)** — `dc9a07a` (test)
5. **Task 5: Run full Docker test suite** — no code change; verification only (substrate gates green; new tests green; baseline failures unchanged)

**Plan metadata:** [pending — added by final commit]

## Files Created/Modified

### Created

- `src/db/migrations/0007_daily_voice_note_seed.sql` — Hand-authored DDL: ALTER TABLE prompt_text (DEFAULT '' then DROP DEFAULT, idempotent via IF NOT EXISTS) + INSERT seed for daily_voice_note ritual ON CONFLICT DO NOTHING (next 21:00 Europe/Paris from migration timestamp; first cron tick recomputes via computeNextRunAt) + CREATE INDEX IF NOT EXISTS for the PP#5 hot-path partial index.
- `src/db/migrations/meta/0007_snapshot.json` — Drizzle meta snapshot regenerated via drizzle-kit generate; id `b26a7cd0...`, prevId `07abf23e...` (chains from 0006). 8-column ritual_pending_responses; 1 partial index.
- `src/rituals/voice-note.ts` — Module header docstring covers all of Plans 26-01..26-03 surface (HARD CO-LOC #1 + #5 references). Constants block with PROMPTS (frozen 6-element tuple), PROMPT_SET_VERSION='v1', RESPONSE_WINDOW_HOURS=18, RITUAL_SUPPRESS_DEPOSIT_THRESHOLD=5. chooseNextPromptIndex pure function (Fisher-Yates refill with seedable rng + head-swap guard).
- `src/rituals/__tests__/voice-note.test.ts` — 11 unit tests for PROMPTS array shape + constants + chooseNextPromptIndex smoke tests including the rng-not-called-on-non-empty-bag invariant (exploding rng proves it) and the 50-trial uniform-coverage invariant.
- `src/rituals/__tests__/prompt-rotation-property.test.ts` — 2 property tests: 600 fires assert all 3 VOICE-03 invariants (uniform distribution, zero consecutive duplicates, max-gap ≤ 11); 5000-fire stress confirms distribution stays uniform at scale.

### Modified

- `src/db/schema.ts` — `ritualPendingResponses` pgTable gains `promptText: text('prompt_text').notNull()` column + partial index declared via `.where(sql`${table.consumedAt} IS NULL`)`. The pgTable now uses the second-arg-array form (matching Phase 25's `rituals` and `wellbeingSnapshots` precedent) instead of the column-only form.
- `src/db/migrations/meta/_journal.json` — Idx 7 entry: `0007_daily_voice_note_seed`, chained from 0006.
- `src/db/migrations/meta/0001_snapshot.json` + `0003_snapshot.json` — IDs rotated by regen-snapshots.sh (Plan 20-01 chain-rotation design); `0002_snapshot.json` + `0004_snapshot.json` had prevId re-chained accordingly. No schema content changes.
- `scripts/regen-snapshots.sh` — `MIGRATION_7` constant + apply step in the acceptance-gate replay loop. Cleanup-trap flag renamed `REGEN_PRODUCED_0006` → `REGEN_PRODUCED_ACCEPTANCE` and the post-acceptance sequence-counter slot updated from 0007 to 0008 (so a future Plan 27-01 / 28-01 / etc. extension just adds MIGRATION_N+1 + flips the cleanup glob suffix).
- `scripts/test.sh` — `MIGRATION_7_SQL` constant + apply line peer to `MIGRATION_6_SQL`. Three-leg substrate gate (SEED_CHECK / INDEX_CHECK / PROMPT_TEXT_CHECK) inserted between Phase 25's 6|1|3 gate and `npx vitest run`. Failure exits 1 BEFORE vitest, mirroring Phase 25's discipline.

## Decisions Made

See key-decisions in frontmatter for the four implementation decisions captured during execution. Headlines:

1. **Partial index declared in schema.ts** (not just migration SQL) — keeps drizzle-kit snapshot/schema parity tight; matches Phase 25 precedent.
2. **drizzle-kit's auto-generated SQL discarded** in favor of hand-authored idempotent variant — drizzle-kit cannot model INSERT seed rows or DEFAULT-then-DROP-DEFAULT pattern.
3. **REGEN_PRODUCED_ACCEPTANCE generic flag name** in scripts/regen-snapshots.sh — future-N safety per the future-plan-N pattern.
4. **chooseNextPromptIndex test expectations** derived by hand-tracing the in-place Fisher-Yates loop with rng()=0 — initial fresh=[0..5] becomes [1,2,3,4,5,0] post-shuffle (every iteration swaps fresh[i] with fresh[0]).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test expectations for chooseNextPromptIndex with rng()=0 were initially wrong**
- **Found during:** Task 4 (Author voice-note.test.ts)
- **Issue:** Initial test wrote `expect(result.index).toBe(0)` and `expect(result.newBag).toEqual([1,2,3,4,5])` for the rng()=0 + empty-bag case. Three of 11 tests failed with the actual implementation correctly producing index=1, newBag=[2,3,4,5,0]. The bug was in the TEST expectations, NOT the rotation primitive — I misread Fisher-Yates as a no-op when j=0 always (forgetting that the algorithm swaps fresh[i] with fresh[j]; with j=0 every iteration, the original fresh[5] rotates to position 0 first, then fresh[4] swaps into position 0 displacing 5 to position 4, etc.).
- **Fix:** Re-derived the 5-step swap trace by hand, confirmed final fresh=[1,2,3,4,5,0], updated test expectations + comments. All 13 tests now pass.
- **Files modified:** src/rituals/__tests__/voice-note.test.ts (3 test bodies + their inline comments).
- **Verification:** `npx vitest run src/rituals/__tests__/voice-note.test.ts src/rituals/__tests__/prompt-rotation-property.test.ts` returns 13 passed.
- **Committed in:** `dc9a07a` (Task 4 commit; the corrected expectations are in the committed file).

**2. [Rule 2 - Missing Critical] Renamed regen-snapshots.sh cleanup flag for future-N safety**
- **Found during:** Task 1 (extend scripts/regen-snapshots.sh)
- **Issue:** The Phase 25 cleanup trap used a hardcoded variable name `REGEN_PRODUCED_0006` that was specific to that plan's migration. Each subsequent plan (Plan 26-01, 27-01, 28-01, etc.) would otherwise either (a) reuse the misleading name, (b) introduce a per-plan name like `REGEN_PRODUCED_0007`, or (c) leave the flag untouched and accidentally delete a legitimate committed snapshot.
- **Fix:** Renamed the flag to `REGEN_PRODUCED_ACCEPTANCE` (semantic — the post-acceptance-gate snapshot is whatever sequence-counter drizzle-kit chooses, currently 0008). Updated the cleanup glob from 0007*.json to 0008*.json. Future plans flip the glob suffix +1 each time.
- **Files modified:** scripts/regen-snapshots.sh.
- **Verification:** bash scripts/regen-snapshots.sh exits 0 with "No schema changes" against fresh Docker postgres; the trap correctly preserves committed 0007_snapshot.json and only wipes the post-acceptance 0008_*.json artifact when this run produced it.
- **Committed in:** `f06a8d4` (Task 1 commit).

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical pattern improvement).
**Impact on plan:** Both deviations were required for correctness (deviation 1) and future-N maintainability (deviation 2). No scope creep — both stayed inside the files Plan 26-01's `<files>` blocks listed.

## Issues Encountered

### Pre-existing baseline test failures (NOT caused by Plan 26-01)

`bash scripts/test.sh` exits 1 due to **57 vitest failures**, all of which are pre-existing baseline failures unrelated to this plan's work. None of the failing tests are in `src/rituals/__tests__/`. Failure breakdown:

- **`src/chris/__tests__/contradiction-false-positive.test.ts` (20 failures)** — HuggingFace transformers `EACCES: permission denied, mkdir '/home/claude/chris/node_modules/@huggingface/transformers/.cache'`. Documented in STATE.md as "vitest-4 fork-IPC HuggingFace EACCES env-level baseline". Pre-existing env constraint.
- **`src/chris/__tests__/engine-mute.test.ts` (7 failures)** — `connect ECONNREFUSED ::1:5432` for the `getActiveDecisionCapture` query. The test does NOT mock `decisions/capture-state.js` so the real DB module loads and tries IPv6 localhost:5432. Plan 26-02 will land the mock-chain coverage update for this test family (HARD CO-LOC #5). Confirmed unchanged from prior commit (`git diff HEAD~4 HEAD -- src/chris/__tests__/engine-mute.test.ts src/chris/engine.ts` returns empty).
- **`src/chris/__tests__/live-integration.test.ts` (15 failures)** — All require real Anthropic API key; failing with 401 because test.sh sets `ANTHROPIC_API_KEY=test-key`. Pre-existing.
- **`src/decisions/__tests__/live-accountability.test.ts` (3 failures)** — Same 401 cause.
- **`src/decisions/__tests__/vague-validator-live.test.ts` (2 failures)** — Same.
- **`src/episodic/__tests__/live-anti-flattery.test.ts` (1 failure)** — Same.
- **`src/llm/__tests__/models-smoke.test.ts` (3 failures)** — Same (smoke test for live API model IDs).

The plan's stop conditions document this baseline: "vitest-4 fork-IPC HuggingFace EACCES env-level baseline: ~32 pre-existing test failures unrelated to your work". The actual count today is 57 (not 32) because the live LLM tests count more failures when ANTHROPIC_API_KEY is unset, but the substantive baseline is unchanged. **No Plan 26-01 file caused any of these failures.**

### Plan grep verification quirks (not actionable)

- The Task 1 acceptance check `grep -v '^--' ... | grep -c '^--> statement-breakpoint$'` strips `^-->` lines because `-v '^--'` matches both `^--` (comments) AND `^-->` (statement-breakpoints). The actual statement-breakpoint count is 3 (not 4), which matches the plan's enumeration ("ALTER ADD + ALTER DROP DEFAULT + INSERT + index has none required at end" = 3). The grep formula and the "expect: >= 4" comment were inconsistent in the plan; my migration's 3 breakpoints are correct.
- The Task 1 acceptance check `grep -v "^#" scripts/regen-snapshots.sh | grep -c "yes ''"` returns 1 because of an INDENTED comment line (starts with whitespace, not `#`) that DOCUMENTS the Phase 25 SIGPIPE bug as a warning to future maintainers. The grep is supposed to detect REINTRODUCTION of `yes '' |` piping in actual code, but it catches the documentation comment too. No code-level reintroduction occurred (verified by inspection: the SIGPIPE-fix `</dev/null` redirect is intact). This was already true in HEAD before Plan 26-01.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 26-02 (voice note handler + PP#5 detector + mock-chain coverage update — HARD CO-LOC #1 + #5 atomic) is fully unblocked.** It can:
  - import PROMPTS, PROMPT_SET_VERSION, RESPONSE_WINDOW_HOURS, chooseNextPromptIndex from src/rituals/voice-note.js;
  - INSERT into ritual_pending_responses with the new prompt_text column populated by `PROMPTS[promptIdx]`;
  - SELECT from ritual_pending_responses by chat_id with `expires_at > now() AND consumed_at IS NULL` backed by the new partial index (sub-millisecond lookup even with hundreds of historical responses);
  - extend the engine.test.ts / engine-mute.test.ts / engine-refusal.test.ts mock chains with `vi.mock('../../rituals/voice-note.js')` to cover the new PP#5 module import (and incidentally fix the engine-mute.test.ts pre-existing failures by adding decision-capture mocks at the same time).
- **Plan 26-03 (pre-fire suppression — VOICE-04)** can import `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD` from voice-note.js.
- **Plan 26-04 (polite-decline voice handler — VOICE-05)** is independent and unaffected by Plan 26-01.
- **VOICE-03 partial completion noted:** the rotation primitive (`chooseNextPromptIndex`) lands in this plan, but handler-side bag-state-management (reading `rituals.config.prompt_bag` → calling chooseNextPromptIndex → writing the updated bag back) lands in Plan 26-02 with `fireVoiceNote`. Plan 26-02 closes VOICE-03.

## TDD Gate Compliance

Plan 26-01 is `type: execute` (not `type: tdd`) per its frontmatter. Tests in Task 4 follow the green-bar increment pattern (write tests + run + see green) rather than RED → GREEN → REFACTOR gate sequence. No gate compliance check applies.

## Self-Check: PASSED

All 9 claimed files exist on disk and all 4 task commits are present in `git log --all`:

- Files verified: `src/db/migrations/0007_daily_voice_note_seed.sql`, `src/db/migrations/meta/0007_snapshot.json`, `src/rituals/voice-note.ts`, `src/rituals/__tests__/voice-note.test.ts`, `src/rituals/__tests__/prompt-rotation-property.test.ts`, `src/db/schema.ts`, `src/db/migrations/meta/_journal.json`, `scripts/regen-snapshots.sh`, `scripts/test.sh`.
- Commits verified: `f06a8d4` (Task 1 — migration + schema + regen-script), `7cdf809` (Task 2 — test.sh substrate gate), `b770a01` (Task 3 — voice-note.ts substrate), `dc9a07a` (Task 4 — tests).

---
*Phase: 26-daily-voice-note-ritual*
*Completed: 2026-04-28*
