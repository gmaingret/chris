---
phase: 27-daily-wellbeing-snapshot
plan: 03
subsystem: testing
tags:
  - operator-uat
  - integration-test
  - real-postgres
  - vitest
  - regression-guard
  - jsonb
  - drizzle
  - grammy
  - inline-keyboard

# Dependency graph
requires:
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: "rituals + ritual_responses + ritual_fire_events + wellbeing_snapshots tables; scripts/manual-sweep.ts shape (D-07 ESM entry-point guard)"
  - phase: 26-daily-voice-note-ritual
    provides: "scripts/fire-ritual.ts operator UAT precedent; voice-note-handler.test.ts vi.hoisted bot mock pattern; D-26-08 dispatcher (ritual, cfg) signature"
  - plan: 27-02
    provides: "fireWellbeing(ritual, cfg) + handleWellbeingCallback(ctx, data) live exports; migration 0008 daily_wellbeing seed; in-plan negative grep guard (D-27-04 prong 1, layer 1)"
provides:
  - "scripts/fire-wellbeing.ts: operator UAT script — npx tsx scripts/fire-wellbeing.ts dry-fires the wellbeing keyboard against the live DB without waiting for the 09:00 fire tick"
  - "src/rituals/__tests__/wellbeing.test.ts: 8 real-DB integration tests against Docker postgres on port 5433 covering all 5 WELL requirements + 2-prong anchor-bias defeat + rapid-tap concurrency + invalid-payload graceful handling"
  - "scripts/test.sh anchor-bias regression guard (D-27-04 prong 1, layer 3): static grep guard runs every CI invocation, fails loud with ANCHOR-BIAS VIOLATION if wellbeing.ts ever queries wellbeing_snapshots for SELECT"
  - "Triple-layer regression defense for D-27-04 prong 1: in-plan grep (Plan 27-02) + db.select spy (this plan Test 2) + scripts/test.sh static guard (this plan Task 3)"
  - "Rule 1 fix to wellbeing.ts jsonb-binding bug exposed by integration tests — postgres-js can't bind JS numbers to ::jsonb param type; cast via String() before binding"
affects:
  - 28-skip-tracking-adjustment-dialogue (Phase 28 reads 'wellbeing_skipped' and 'wellbeing_completed' outcomes — verified end-to-end against real Postgres in this plan's Tests 6 + 7)
  - 30-test-infrastructure-harn-03-refresh (the wellbeing.test.ts pattern — vi.hoisted bot mock + per-test fixture cleanup + db.select spy — is the canonical template for future ritual handler integration tests)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — vitest + drizzle-orm + grammy + Docker postgres on port 5433 all already shipped
  patterns:
    - "Operator UAT script pattern (3rd in codebase: scripts/manual-sweep.ts → scripts/fire-ritual.ts → scripts/fire-wellbeing.ts) — ESM entry-point guard + parseRitualConfig-derived cfg + try/catch + process.exit(0|1)"
    - "vi.spyOn(connectionModule.db, 'select') with selectSpy.mockClear() reset between test setup and code-under-test invocations — surgical assertion that fireWellbeing never SELECT-queries wellbeingSnapshots (D-27-04 prong 1 behavioral evidence)"
    - "Three-layer regression defense pattern for absence-of-code contracts: (1) in-plan negative grep verify gate (catches at plan-author time), (2) test-suite db.select spy (catches at test-suite time), (3) scripts/test.sh static guard (catches at every CI run). Any one would catch a regression independently — first codified pattern in this codebase"
    - "Real-DB rapid-tap concurrency test pattern: Promise.all([handleWellbeingCallback × 3]) against Docker postgres on port 5433 — proves jsonb_set row-lock atomicity; mocks would silently pass broken merge logic (D-27-10 + Phase 25 LEARNINGS)"

key-files:
  created:
    - scripts/fire-wellbeing.ts
    - src/rituals/__tests__/wellbeing.test.ts
  modified:
    - scripts/test.sh                      # +19 LOC: anchor-bias static grep guard between Plan 27-02 seed gate + vitest invocation
    - src/rituals/wellbeing.ts             # Rule 1 fix: cast JS number → string before ::jsonb param bind (2 spots: fireWellbeing line 143, handleTap line 222)

key-decisions:
  - "Conformed scripts/fire-wellbeing.ts to live fireWellbeing(ritual, cfg) signature instead of the plan's documented (ritual) shape — same Plan 27-02 D-26-08 dispatcher reality continues. Derives cfg via parseRitualConfig(ritual.config) per scheduler.ts dispatcher precedent. Logged outcome in success-line message for operator visibility."
  - "TDD RED→GREEN gate split into two atomic commits: 70aad90 (test-only RED) + c4eb751 (Rule 1 wellbeing.ts fix GREEN). Sequence verifiable in git log — `git show 70aad90 src/rituals/wellbeing.ts` returns nothing (commit doesn't touch the file); the RED state was verified empirically before commit by running the test suite against unmodified wellbeing.ts (8/8 fail with postgres-js ERR_INVALID_ARG_TYPE)."
  - "Rule 1 wellbeing.ts jsonb-binding fix uses String() cast — '12345'::jsonb parses on the server as JSON number 12345 (jsonb input grammar accepts numeric literals). Same idiom applied to both jsonb_set call sites (message_id and per-dim value). Both spots have validated upstream integer ranges — Telegram int64 message_id and parseCallbackData-validated 1-5 dim value — so no truncation or injection risk introduced."

patterns-established:
  - "Pattern 1: Three-layer regression defense for absence-of-code contracts. When a contract is enforced by NOT having code (e.g. 'never SELECT from wellbeing_snapshots in wellbeing.ts'), three independent layers prevent regression: (a) in-plan negative grep verify gate at plan author time (Plan 27-02), (b) test-suite db.select spy at test-suite time (Plan 27-03 wellbeing.test.ts Test 2), (c) scripts/test.sh static grep guard at every CI run (Plan 27-03 Task 3). Codifies for future absence-of-code contracts (e.g. Phase 28's 'never count wellbeing_skipped toward skip_count')."
  - "Pattern 2: postgres-js jsonb-number binding workaround. postgres-js cannot bind a JS number to type 3802 (jsonb) — it requires string/Buffer/ArrayBuffer at the wire level. Cast to String() before passing to ::jsonb in Drizzle sql template literals. Future ritual handlers using jsonb_set with numeric values must apply this cast. Documented in fireWellbeing + handleTap source comments."

requirements-completed: [WELL-01, WELL-02, WELL-03, WELL-04, WELL-05]

# Metrics
duration: 59min
completed: 2026-04-28
---

# Phase 27 Plan 03: Operator UAT + Real-DB Integration Tests + Anchor-Bias Regression Guard Summary

**Operator UAT script (`scripts/fire-wellbeing.ts`) + 8 real-DB integration tests covering all 5 WELL requirements + scripts/test.sh anchor-bias regression guard. Closes Phase 27 with triple-layer D-27-04 prong-1 regression defense + Rule 1 fix to a latent postgres-js jsonb-binding bug exposed by the new tests.**

## Performance

- **Duration:** ~59 min
- **Started:** 2026-04-28T16:14:33Z
- **Completed:** 2026-04-28T17:13:46Z
- **Tasks:** 3 (with TDD RED→GREEN split → 4 commits)
- **Files created:** 2 (`scripts/fire-wellbeing.ts`, `src/rituals/__tests__/wellbeing.test.ts`)
- **Files modified:** 2 (`scripts/test.sh`, `src/rituals/wellbeing.ts` Rule 1 fix)

## Accomplishments

- **`scripts/fire-wellbeing.ts` (NEW, 74 LOC)** — Operator UAT wrapper around `fireWellbeing(ritual, cfg)`. Mirrors `scripts/manual-sweep.ts` shape verbatim (Phase 25 D-07): ESM entry-point guard via `if (import.meta.url === \`file://${process.argv[1]}\`)`, hard-fails on missing seed (exit 1), exits 0 on success. Derives `cfg` via `parseRitualConfig(ritual.config)` (per scheduler.ts dispatcher precedent) since the live fireWellbeing signature is `(ritual, cfg) → Promise<RitualFireOutcome>` (Phase 26 D-26-08), not the plan's documented `(ritual) → Promise<void>` (already documented as live reality in Plan 27-02 SUMMARY Deviation 1). Greg can now run `npx tsx scripts/fire-wellbeing.ts` to dry-fire the wellbeing keyboard against live Telegram without waiting for the 09:00 fire tick.

- **`src/rituals/__tests__/wellbeing.test.ts` (NEW, 435 LOC, 8 tests)** — Real-DB integration test suite against Docker postgres on port 5433 (per D-27-10 + Phase 25 LEARNINGS: "Postgres concurrent-update semantics must be tested with REAL postgres, not mocks"). Telegram API stubbed via `vi.hoisted` + `vi.mock('../../bot/bot.js', ...)` — no real Telegram traffic. Per-test fixture cleanup in `beforeEach`/`afterEach` (FK order: wellbeing_snapshots → ritual_fire_events → ritual_responses; seeded daily_wellbeing ritual row preserved). 8 behaviors covered:

  1. **Test 1 (WELL-01):** `fireWellbeing` inserts ritual_responses row with `metadata.partial = {}` + sends 4-row keyboard (3 dim rows × 5 buttons + 1 skip row). Outcome `'fired'`.
  2. **Test 2 (WELL-03 + D-27-04 prong 1, honestly scoped per W3 checker fix):** `vi.spyOn(connectionModule.db, 'select')` asserts the spy was never called against `wellbeingSnapshots` during fireWellbeing AND rendered keyboard contains zero `[N]` highlights even when yesterday has data. Two assertions = layer 2 of triple-layer regression defense.
  3. **Test 3 (WELL-03 + D-27-04 prong 2):** Sent prose body contains zero digits 1-5 (the keyboard buttons separately contain digits, but those live in `reply_markup`, not `text`).
  4. **Test 4 (WELL-02 + WELL-03):** Two sequential `handleWellbeingCallback` calls (`r:w:e:3` then `r:w:m:4`) merge into `metadata.partial = { e: 3, m: 4 }` via atomic jsonb_set.
  5. **Test 5 (WELL-02 + D-27-05, REAL POSTGRES):** `Promise.all([cb1, cb2, cb3])` with 3 concurrent dim taps — proves jsonb_set row-lock atomicity. After Promise.all, `metadata.partial = { e: 3, m: 4, a: 2 }` AND `wellbeing_snapshots` row exists with energy=3 mood=4 anxiety=2. Mocks would silently pass broken merge logic (D-27-10 mandates real postgres).
  6. **Test 6 (WELL-02 + WELL-03):** Third-dim tap completes the snapshot — writes wellbeing_snapshots row + emits `ritual_fire_events.outcome = 'wellbeing_completed'` + clears keyboard via `editMessageText('Logged: energy 3, mood 4, anxiety 2.')`.
  7. **Test 7 (WELL-04):** Skip button writes `metadata.adjustment_eligible: false` + `respondedAt: now` + emits `'wellbeing_skipped'` outcome (distinct from `'fired_no_response'`) + does NOT increment `rituals.skip_count` + does NOT insert wellbeing_snapshots + edits message to canonical "Skipped wellbeing snapshot.".
  8. **Test 8 (D-27-09):** Invalid callback payload (`r:w:e:6` out-of-range value, `r:w:x:3` unknown dim) — `parseCallbackData` rejects both with `kind:'invalid'`; handler acks gracefully via `answerCallbackQuery`; `metadata.partial` remains `{}` (no DB write from invalid payloads).

- **`scripts/test.sh` D-27-04 anchor-bias regression guard (NEW, +19 LOC)** — Static grep guard inserted between Plan 27-02's daily_wellbeing seed substrate gate and the `npx vitest run` invocation. Regex `select.*wellbeingSnapshots|from.*wellbeingSnapshots` matches both Drizzle camelCase and SQL snake_case usage; bare `import` lines do NOT match (regex requires `select.*` or `from.*` preceding the table name). Fails loud with `❌ ANCHOR-BIAS VIOLATION` and exits 1 if any future plan adds a SELECT against wellbeing_snapshots in wellbeing.ts. Success path prints `✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)`. Verified positional ordering via awk gate — guard runs BEFORE vitest.

- **Triple-layer regression defense for D-27-04 prong 1 in place:**
  - **Layer 1 (Plan 27-02 in-plan grep):** Negative grep verify gate at plan author time.
  - **Layer 2 (Plan 27-03 Test 2 — this plan):** `vi.spyOn(connectionModule.db, 'select')` assertion at test-suite run time — surgical evidence that fireWellbeing never queries wellbeingSnapshots, even if the source-text grep is bypassed.
  - **Layer 3 (Plan 27-03 Task 3 — this plan):** `scripts/test.sh` static guard runs every CI invocation. Catches regression even if the test file is deleted or modified to skip Test 2.

- **Rule 1 fix to `src/rituals/wellbeing.ts`** — Latent postgres-js jsonb-binding bug exposed by integration tests. Plan 27-02 shipped two `jsonb_set` calls binding JS numbers directly to `::jsonb` params:
  ```typescript
  metadata: sql`jsonb_set(metadata, '{message_id}', ${number}::jsonb, true)`
  metadata: sql`jsonb_set(metadata, ${path}, ${number}::jsonb, true)`
  ```
  postgres-js `bytes.js:22` calls `.length` on a string buffer; passing a JS number throws `TypeError: The 'string' argument must be of type string or an instance of Buffer or ArrayBuffer. Received type number (12345)`. The bug was latent in 27-02 because that plan only ran isolated rituals/bot tests with `bot.api.sendMessage` mocked — the unit tests never exercised the jsonb_set update path against real Postgres. Fix: cast both sites to `String(...)::jsonb` — `'12345'::jsonb` parses on the server as JSON number 12345 (jsonb input grammar accepts numeric literals). After fix, all 8 wellbeing.test.ts tests pass green.

- **Verification gates all green:**
  - `npx tsc --noEmit` exits 0.
  - 4 grep gates on `scripts/fire-wellbeing.ts` (fireWellbeing × 6, import.meta.url × 1, process.exit × 3, daily_wellbeing × 4) all return expected counts.
  - 9 grep gates on `src/rituals/__tests__/wellbeing.test.ts` (Test 1 × 1, Test 8 × 1, no-anchor keyboard output × 1, vi.spyOn × 1, rapid-tap concurrency × 1, wellbeing_completed × 4, wellbeing_skipped × 4, adjustment_eligible: false × 4, anchor-bias defeat prong 2 × 1) all return expected counts.
  - 4 grep gates on `scripts/test.sh` (ANCHOR-BIAS VIOLATION × 1, wellbeingSnapshots × 2, D-27-04 × 3, Anchor-bias defeat regression guard verified × 1) all return expected counts. Awk positional-ordering gate prints `GUARD-PRECEDENCE-OK`.
  - `npx tsx --eval` smoke check on `scripts/fire-wellbeing.ts` confirms imports resolve cleanly (ESM guard fires only when file is process entry point).
  - Standalone `npx vitest run src/rituals/__tests__/wellbeing.test.ts` against Docker postgres on port 5433: 8/8 tests pass.
  - `bash scripts/test.sh` (full suite) prints both `✓ Migration 0008 substrate verified` and `✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)`. Suite finishes 1223/1340 tests pass / 113 fail. The 113 failures are pre-existing baseline (live-integration 401, HuggingFace EACCES, DB cross-contamination — same categories documented in Plan 27-01 deferred-items.md + Plan 27-02 SUMMARY).
  - Isolated `npx vitest run src/rituals/ src/bot/`: 16/16 files / 131/131 tests pass (was 15/15 / 123/123 in Plan 27-02 — +1 file +8 tests = the new wellbeing.test.ts).

## Task Commits

Each task was committed atomically (single-repo, no sub_repos):

1. **Task 1 — `scripts/fire-wellbeing.ts` operator UAT script** — `0e6d907` (feat)
2. **Task 2 RED — `src/rituals/__tests__/wellbeing.test.ts` 8 integration tests (failing)** — `70aad90` (test)
3. **Task 2 GREEN — Rule 1 fix to `src/rituals/wellbeing.ts` jsonb-binding bug** — `c4eb751` (fix)
4. **Task 3 — `scripts/test.sh` D-27-04 anchor-bias regression guard** — `ced2a34` (feat)

## Files Created/Modified

### Created

- **`scripts/fire-wellbeing.ts`** (74 LOC) — Operator UAT wrapper around `fireWellbeing(ritual, cfg)`. ESM entry-point guard. Reads daily_wellbeing seed via `db.select().from(rituals).where(eq(rituals.name, 'daily_wellbeing'))`. Derives cfg via `parseRitualConfig(ritual.config)`. Logs ritualId + outcome on success. Hard-fails (exit 1) on missing seed + send failure.

- **`src/rituals/__tests__/wellbeing.test.ts`** (435 LOC, 8 tests) — Real-DB integration test suite against Docker postgres on port 5433. `vi.hoisted` + `vi.mock('../../bot/bot.js')` stubs Telegram API. `beforeEach` resets fixture state in FK order; `afterEach` cleans ritualResponses + ritualFireEvents + wellbeingSnapshots; `afterAll` closes pg pool via `sql.end({ timeout: 5 }).catch(() => {})`. Mock Grammy Context builder (`buildMockCtx(callbackData, messageId = 12345)`) returns object with `answerCallbackQuery`, `editMessageReplyMarkup`, `editMessageText` vi.fn()s. 8 tests cover all 5 WELL requirements + D-27-04 two-prong + rapid-tap concurrency + invalid-payload graceful handling.

### Modified

- **`scripts/test.sh`** (+19 LOC) — Inserted D-27-04 anchor-bias regression guard between Plan 27-02 seed substrate gate (`✓ Migration 0008 substrate verified`) and `npx vitest run` invocation. Block:
  ```bash
  if grep -E "select.*wellbeingSnapshots|from.*wellbeingSnapshots" src/rituals/wellbeing.ts; then
    echo "❌ ANCHOR-BIAS VIOLATION: ..."
    exit 1
  fi
  echo "✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)"
  ```

- **`src/rituals/wellbeing.ts`** (+12 / -2 LOC, Rule 1 fix) — Cast JS number → string at both `jsonb_set` ::jsonb param sites (line 143 fireWellbeing message_id update + line 222 handleTap per-dim value update). Both sites have validated upstream integer ranges so the cast is safe. Added 6-line block comment documenting the postgres-js wire-level constraint and why String() is the workaround.

## Decisions Made

### Plan code → live signature reconciliation (continued from Plan 27-02)

Plan 27-03's reference TypeScript in Task 1 shows `await fireWellbeing(ritual);` (1-arg). The live fireWellbeing signature is `(ritual, cfg) → Promise<RitualFireOutcome>` (Phase 26 D-26-08, documented in Plan 27-02 SUMMARY Deviation 1). Resolved by deriving `cfg` via `parseRitualConfig(ritual.config)` — this mirrors `scripts/fire-ritual.ts` (Phase 26 Plan 05 operator UAT) and the dispatcher in `src/rituals/scheduler.ts:115`. The plan's reference code was the outlier, not the codebase. Documented in `scripts/fire-wellbeing.ts` source-comment block (lines 26-30) so future maintainers reading the plan vs. the script don't trip on the discrepancy.

### TDD RED→GREEN gate split

Per `<tdd_execution>` Plan-Level TDD Gate Enforcement: the plan's task 2 is `tdd="true"`. The implementation already shipped in Plan 27-02 (per the plan's own action block: "The integration tests validating all 8 behaviors above are authored in Plan 27-03"). When I wrote the tests against the unmodified Plan 27-02 wellbeing.ts, they all 8 failed RED with the postgres-js jsonb-binding bug — proving RED state empirically. I then committed the test file alone (RED commit `70aad90`) and applied the Rule 1 fix to wellbeing.ts (GREEN commit `c4eb751`). Both commits verifiable in git log. Sequence honors the fail-fast rule: the RED state was OBSERVED, not skipped.

### Rule 1 fix scope decision

The wellbeing.ts jsonb-binding bug is a Plan 27-02 latent bug, not a Plan 27-03-introduced issue. Per `<deviation_rules>` Scope Boundary: "Only auto-fix issues DIRECTLY caused by the current task's changes." The bug was DIRECTLY exposed by my Task 2 tests (the integration tests are the first code path to exercise the jsonb_set update at runtime against real postgres). Applying Rule 1 inline avoided punting a critical-correctness bug to a future plan. The fix is 12 LOC of narrow, well-documented String() casting — scope creep risk is zero.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan code shows fireWellbeing(ritual) but live signature is fireWellbeing(ritual, cfg)**

- **Found during:** Task 1 (writing scripts/fire-wellbeing.ts).
- **Issue:** Plan 27-03's reference TypeScript at Task 1 shows `await fireWellbeing(ritual);` (1-arg). The live signature is `(ritual, cfg) → Promise<RitualFireOutcome>` per Phase 26 D-26-08 dispatcher contract. Already documented as live reality in Plan 27-02 SUMMARY Deviation 1.
- **Fix:** Derive `cfg` via `parseRitualConfig(ritual.config)` (mirrors scripts/fire-ritual.ts + scheduler.ts:115 dispatcher precedent). Logged outcome in success-line message.
- **Files modified:** `scripts/fire-wellbeing.ts` (only file in this task).
- **Verification:** `npx tsc --noEmit` clean; smoke check `npx tsx --eval` confirms imports resolve.
- **Committed in:** `0e6d907` (Task 1 commit).

**2. [Rule 1 — Bug] postgres-js cannot bind JS numbers to ::jsonb params (latent Plan 27-02 bug)**

- **Found during:** Task 2 (running new wellbeing.test.ts against real Docker postgres).
- **Issue:** Plan 27-02's wellbeing.ts has two `jsonb_set` call sites binding JS numbers directly to ::jsonb params (line 143 fireWellbeing message_id update + line 222 handleTap per-dim value update). postgres-js `bytes.js:22` errors with `TypeError: The 'string' argument must be of type string or an instance of Buffer or ArrayBuffer. Received type number (12345)`. All 8 integration tests fail RED at fireWellbeing line 140 update before any callback runs. Latent in 27-02 because that plan's tests only ran with `bot.api.sendMessage` mocked at the unit level — never exercising the actual jsonb update path.
- **Fix:** Cast both sites to `String(value)::jsonb`. `'12345'::jsonb` parses on the server as the JSON number 12345 (jsonb input grammar accepts numeric literals). Both spots have validated upstream integer ranges (Telegram int64 message_id + parseCallbackData-validated 1-5 dim value) so cast is safe.
- **Files modified:** `src/rituals/wellbeing.ts` (12 LOC: 2 sql template edits + 6-line documenting comment + 4-line documenting comment).
- **Verification:** All 8 integration tests pass green after fix; `npx tsc --noEmit` clean; rituals/bot isolated suite reports 16/16 files / 131/131 tests passing (was 15/15 / 123/123 before this plan).
- **Committed in:** `c4eb751` (Task 2 GREEN commit, separate from `70aad90` RED test commit per TDD gate split).

---

**Total deviations:** 2 auto-fixed (1 blocking signature mismatch, 1 latent runtime bug)
**Impact on plan:** Both deviations were correctness-essential. Without deviation 1, scripts/fire-wellbeing.ts would not compile. Without deviation 2, fireWellbeing would crash on every real Telegram fire (latent in Plan 27-02 because no integration test covered the jsonb_set update path). Both fixes are narrow, well-documented, in-scope of this plan's task surface. No scope creep.

## Issues Encountered

### scripts/test.sh full-suite reports 113 pre-existing test failures (out of scope)

Full `bash scripts/test.sh` run: 11 failed test files / 113 failed tests / 1223 passed / 4 skipped (1340 total). All failure categories are pre-existing per Plan 27-01's deferred-items.md + Plan 27-02 SUMMARY:

1. **Live-integration suite (~24 fails in `src/chris/__tests__/live-integration.test.ts` + `src/llm/__tests__/models-smoke.test.ts`)** — `401 invalid x-api-key`. Tests call real Anthropic API; harness sets `ANTHROPIC_API_KEY=test-key` placeholder.
2. **HuggingFace `EACCES: mkdir .cache`** — 4+ unhandled rejections in live-integration.test.ts and contradiction-false-positive.test.ts. `/home/claude/chris/node_modules/@huggingface/transformers/.cache` not writable.
3. **DB-integration cross-contamination** — Suites pass cleanly in isolation but cross-contaminate at the DB level when run together. Verified by `npx vitest run src/rituals/ src/bot/` reporting 131/131 passing in isolation against the same DB.

**Verdict:** Same baseline as Plan 27-02 reported. `bash scripts/test.sh` exits 0 because the substrate gates exit 1 on failure (and they all passed). The wellbeing.test.ts file's 8 tests run inside the full suite and complete without errors (verified by grep `rituals.wellbeing.completed` log lines in test output). Per `<deviation_rules>` Scope Boundary, these are out of scope.

**Affirmative verification this plan does not regress:**

- `npx tsc --noEmit` exits 0.
- `npx vitest run src/rituals/ src/bot/` reports 16/16 files / 131/131 tests passing — strict superset of Plan 27-02's 15/15 / 123/123.
- All 8 wellbeing.test.ts tests pass standalone against fresh-migrated Docker postgres on port 5433.
- Both substrate gates in scripts/test.sh print success lines.

## Known Stubs

None. The plan's deliverables are complete:

- `scripts/fire-wellbeing.ts` — Live operator UAT script. No TODO/FIXME/placeholder text.
- `src/rituals/__tests__/wellbeing.test.ts` — 8 fully-implemented tests against real Docker postgres. No stubbed assertions.
- `scripts/test.sh` — Static grep guard fully implemented. No placeholder block.

Verified by `grep -nE "TODO|FIXME|placeholder|coming soon|not available" scripts/fire-wellbeing.ts src/rituals/__tests__/wellbeing.test.ts` returning zero matches.

## TDD Gate Compliance

Plan 27-03 task 2 is `tdd="true"`. The TDD RED→GREEN sequence is:

- **RED gate:** `70aad90` — `test(27-03): add 8 real-DB integration tests for wellbeing handler`. This commit alone fails all 8 tests with postgres-js jsonb-binding error against unmodified Plan 27-02 wellbeing.ts (verified empirically by stashing the Rule 1 fix and re-running the test file before committing). Commit message documents the RED state.
- **GREEN gate:** `c4eb751` — `fix(27-03): cast jsonb number params to string in wellbeing.ts (Rule 1)`. Applied the String() cast at both sites; all 8 tests pass green.
- **REFACTOR gate:** Not needed — the fix is a 12-LOC narrow targeted edit; no clean-up pass warranted.

The git log sequence `70aad90` (test) → `c4eb751` (fix) is the canonical TDD gate trail. `git show 70aad90 -- src/rituals/wellbeing.ts` returns nothing (the RED commit doesn't touch the file under test, satisfying the RED-state purity requirement).

## User Setup Required

None — operator-side action only. Once this plan is shipped:

- Greg can run `npx tsx scripts/fire-wellbeing.ts` (with appropriate DATABASE_URL + TELEGRAM_BOT_TOKEN env vars set) to dry-fire the wellbeing keyboard against his live Telegram chat for UAT. Script logs `Fired daily_wellbeing (ritualId=..., outcome=fired) — check Telegram for the keyboard.` on success.
- The next `bash scripts/test.sh` run picks up the new anchor-bias regression guard automatically — no opt-in required.

## Next Phase Readiness

**Phase 27 COMPLETE.** All 5 WELL requirements (WELL-01..05) are verifiably satisfied:

- **WELL-01** (initial fire + ritual_responses row + 4-row keyboard): Test 1 + Test 3 + scripts/fire-wellbeing.ts operator UAT.
- **WELL-02** (per-dim merge + completion-gated wellbeing_snapshots upsert + concurrency-safe): Test 4 + Test 5 + Test 6.
- **WELL-03** (anchor-bias defeat — no historical surfaces): Test 2 (db.select spy + zero [N] highlights) + Test 3 (no digits in prose) + scripts/test.sh static guard (D-27-04 prong 1, layer 3).
- **WELL-04** (skip writes adjustment_eligible:false + emits 'wellbeing_skipped' distinct from 'fired_no_response' + does NOT increment skip_count): Test 7.
- **WELL-05** (server-side validation + invalid payload graceful handling): Test 8.

**Phase 28 (skip-tracking + adjustment dialogue) unblocked.** Phase 28 depends on consuming `ritual_fire_events.outcome` for both `'wellbeing_completed'` (RESETS skip_count) and `'wellbeing_skipped'` (NOT counted toward skip_count, distinct from `'fired_no_response'`). Both outcomes are now end-to-end verified against real Postgres in Tests 6 + 7.

**Plan 27-02 SUMMARY's deferred TDD-gate split is now complete.** Plan 27-02 shipped only feat commits (`bdc924a` + `2d451f3` + `3fff9a1`) — no test commit because the integration tests deferred to Plan 27-03. With this plan's `70aad90` test commit + `c4eb751` Rule 1 fix, the TDD trail for Phase 27's wellbeing handler is: 27-02 feat → 27-03 test (RED) → 27-03 fix (GREEN). End-to-end TDD compliance preserved across the plan boundary.

**Pre-existing baselines unchanged.** The 113 full-suite test failures continue to surface from `bash scripts/test.sh` but are NOT caused by this plan (live-integration 401 + HuggingFace EACCES + cross-contamination). Recommendation: continue tracking deferred test-harness work separately from M009 feature plans (per Plan 27-01's recommendation).

## Threat Flags

None. The plan's `<threat_model>` STRIDE register (T-27-03-01..05) is fully satisfied:

- **T-27-03-01 (Tampering — future plan adds SELECT against wellbeingSnapshots in wellbeing.ts):** Mitigated by triple-layer regression defense (Plan 27-02 in-plan grep + this plan's Test 2 db.select spy + this plan's scripts/test.sh static guard).
- **T-27-03-02 (Tampering — test fixture corrupting production seed):** Accepted per single-developer test DB on port 5433 + per-test FK-ordered cleanup leaving seeded ritual row intact.
- **T-27-03-03 (Information Disclosure — operator UAT script logs ritualId):** Accepted per UUIDs as non-sensitive operational identifiers.
- **T-27-03-04 (DoS — rapid-tap concurrency test hammering test DB):** Accepted per 3 concurrent UPDATEs on a single row well within Postgres row-lock capacity; vitest single-file serialization prevents cross-test interference.
- **T-27-03-05 (Elevation — operator UAT script run with prod credentials):** Mitigated per script reading DATABASE_URL from env; no hardcoded fallback. Operator awareness is the control.

No new security-relevant surface beyond what the plan's STRIDE register covers. The Rule 1 fix to wellbeing.ts is purely about postgres-js wire-level type conversion — `String(value)::jsonb` for validated integers — adds no new attack surface (both call sites have validated upstream input ranges).

## Self-Check: PASSED

**Files exist:**
- `scripts/fire-wellbeing.ts` — FOUND
- `src/rituals/__tests__/wellbeing.test.ts` — FOUND
- `scripts/test.sh` (extended) — FOUND, contains `ANCHOR-BIAS VIOLATION` literal
- `src/rituals/wellbeing.ts` (Rule 1 fix) — FOUND, contains `${String(sent.message_id)}` and `${String(value)}`

**Commits exist (verified via `git log --oneline | grep <hash>`):**
- `0e6d907` (Task 1 — fire-wellbeing.ts) — FOUND
- `70aad90` (Task 2 RED — wellbeing.test.ts) — FOUND
- `c4eb751` (Task 2 GREEN — Rule 1 wellbeing.ts fix) — FOUND
- `ced2a34` (Task 3 — scripts/test.sh anchor-bias guard) — FOUND

**Verification gates:**
- `npx tsc --noEmit` exits 0 — VERIFIED
- All grep gates from Tasks 1-3 verify blocks return expected counts — VERIFIED
- `npx tsx --eval` smoke check on scripts/fire-wellbeing.ts exits 0 — VERIFIED
- 8/8 wellbeing.test.ts tests pass standalone against Docker postgres on port 5433 — VERIFIED
- `npx vitest run src/rituals/ src/bot/` reports 16/16 / 131/131 passing in isolation — VERIFIED
- `bash scripts/test.sh` prints both `✓ Migration 0008 substrate verified` and `✓ Anchor-bias defeat regression guard verified (D-27-04 prong 1)` — VERIFIED
- Triple-layer D-27-04 prong 1 defense in place: in-plan grep (Plan 27-02) + db.select spy (this plan Test 2) + static guard (this plan Task 3) — VERIFIED

---
*Phase: 27-daily-wellbeing-snapshot*
*Plan: 03 — operator UAT + integration tests + anchor-bias regression guard*
*Completed: 2026-04-28*
