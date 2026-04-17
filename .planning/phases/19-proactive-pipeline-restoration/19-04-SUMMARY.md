---
phase: 19-proactive-pipeline-restoration
plan: 04
subsystem: testing
tags: [synthetic-fixture, channel-separation, sweep-02, drizzle-kit, milestone-audit, vitest, docker-postgres, tech-debt]

# Dependency graph
requires:
  - phase: 19-proactive-pipeline-restoration
    plan: 01
    provides: state.ts channel-aware helpers, scripts/test.sh 5-migration harness
  - phase: 19-proactive-pipeline-restoration
    plan: 02
    provides: prompts.ts ACCOUNTABILITY_SYSTEM_PROMPT + ACCOUNTABILITY_FOLLOWUP_PROMPT
  - phase: 19-proactive-pipeline-restoration
    plan: 03
    provides: sweep.ts dual-channel runSweep + 3 test files; SweepResult shape with accountabilityResult + reflectiveResult
provides:
  - synthetic-fixture.test.ts TEST-12 realigned to channel-separation contract (SWEEP-02)
  - .planning/STATE.md ## Known Tech Debt section with TECH-DEBT-19-01 entry for deferred drizzle meta snapshots
  - Wave 4 final Docker gate marker — full restoration verified green vs Cat A + Cat B pre-existing baseline
  - v2.1 milestone restoration complete — 5 previously-unsatisfied requirements now satisfied with code evidence
affects:
  - v2.1 M007 Decision Archive milestone (ready to ship)
  - Next phase planning (phase 20+) — STATE.md TECH-DEBT-19-01 reactivation trigger: next schema-modifying phase

# Tech tracking
tech-stack:
  added: []  # No new libraries — realignment + documentation only
  patterns:
    - "Surgical test-block rewrite with dual preservation proof (byte-exact describe-block diff + positive `-t` filter test run) when the target contract shifts"
    - "vi.resetAllMocks() over vi.clearAllMocks() in beforeEach when prior tests in the same file use `mockResolvedValueOnce` queues (clearAllMocks does not drain the queue)"
    - "Option-A/Option-C split for drizzle-kit backfill attempts: run drizzle-kit generate first; on outcome A3 (no backfill) defer via STATE.md ## Known Tech Debt with explicit reactivation trigger rather than forcing hand-crafted snapshots"
    - "TECH-DEBT-NN entries live in .planning/STATE.md (project-level visibility) not just a phase SUMMARY — per revision WARNING 3 fix"

key-files:
  created:
    - ".planning/phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md (this file)"
  modified:
    - "src/decisions/__tests__/synthetic-fixture.test.ts (561 → 618 lines; TEST-12 realigned to channel-separation contract)"
    - ".planning/STATE.md (added ## Known Tech Debt section with TECH-DEBT-19-01)"

key-decisions:
  - "Option C taken for migration meta snapshots (Option A returned 'No schema changes, nothing to migrate' — drizzle-kit does not backfill entries 0001/0003 that were originally hand-written)."
  - "vi.resetAllMocks() required in TEST-12 beforeEach — vi.clearAllMocks() does not drain the .mockResolvedValueOnce queue left by TEST-10 (which queues 4 LLM responses)."
  - "TEST-10 and TEST-11 preservation proven both ways — byte-exact describe-block diff (empty) AND positive test-name filter run (2 passed | 1 skipped) — to satisfy revision WARNING 2 (byte-diff alone is a structural check, -t filter is load-bearing)."
  - "Gate baseline delta: Wave 3 showed 11 files / 95 tests failing (+TEST-12 expected break). Wave 4 shows 10 files / 94 tests failing — TEST-12 now green; Cat A (engine mock-chain) 45 + Cat B (live API / huggingface env) 49 remain byte-identical per deferred-items.md."

patterns-established:
  - "Channel-separation test contract: `expect(result.accountabilityResult?.triggered).toBe(true) && expect(result.reflectiveResult?.triggered).toBe(true) && expect(mockSendMessage).toHaveBeenCalledTimes(2)` — this replaces the legacy `result.triggerType === 'silence'` single-winner pattern for dual-channel sweep tests."
  - "Hoisted mock stack for synthetic-fixture dual-channel tests: channel-aware state mocks (hasSentTodayAccountability/Reflective + setLastSent*) + 5 escalation KV helpers + upsertAwaitingResolution + clearCapture override. Real transitionDecision preserved for TEST-10/11; TEST-12's escalation loop path is bypassed by empty decision_capture_state (cleanup() runs between tests)."
  - "Deferred-tech-debt visibility pattern: TECH-DEBT-NN-MM bullet in STATE.md `## Known Tech Debt` with (a) link to phase SUMMARY, (b) explicit reactivation trigger, (c) audit disposition note."

requirements-completed: [SWEEP-01, SWEEP-02]  # from plan frontmatter; reinforcement of Wave 3 delivery

# Metrics
duration: 36min
completed: 2026-04-17
---

# Phase 19 Plan 04: TEST-12 Channel-Separation Realignment + Migration Snapshot Deferral + v2.1 Milestone Gate Summary

**TEST-12 rewritten in-place to assert the channel-separation contract (SWEEP-02) instead of the degraded single-pipeline contract; drizzle-kit meta snapshot backfill confirmed unavailable and deferred as TECH-DEBT-19-01 in STATE.md; Wave 4 Docker gate green with 10 files / 94 tests baseline failing (identical to Cat A + Cat B pre-existing failures); v2.1 M007 Decision Archive milestone restoration complete.**

## Performance

- **Duration:** ~36 min (30 min of which was the Wave 4 full Docker gate — Cat B contradiction-false-positive test times out at 600s + live-integration at 1800s per pre-existing environment config)
- **Started:** 2026-04-17T12:06:27Z
- **Completed:** 2026-04-17T12:43:26Z
- **Tasks:** 3 (TEST-12 realignment, drizzle snapshot Option A/C, final Wave 4 gate + milestone re-audit)
- **Files modified:** 2 (+ 1 created: this SUMMARY)

## Accomplishments

- **TEST-12 realigned to the channel-separation contract (Phase 19 success criterion #6).** Before: `expect(result.triggerType).toBe('silence')` + `expect(mockSendMessage).toHaveBeenCalledTimes(1)` — priority winner / single-pipeline degraded contract. After: `expect(result.accountabilityResult?.triggered).toBe(true)` + `expect(result.reflectiveResult?.triggered).toBe(true)` + `expect(mockSendMessage).toHaveBeenCalledTimes(2)` + write-before-send ordering + per-channel cap writes + escalation bootstrap. Closes the `synthetic-fixture.test.ts vi.mock factory missing hasSentTodayAccountability` issue surfaced by Plan 19-03.
- **TEST-10 (14-day lifecycle) and TEST-11 (concurrency race) preservation proven both ways.** (a) Byte-exact describe-block diff: empty. (b) Positive preservation proof: `npx vitest run -t 'TEST-10|TEST-11'` → Test Files 1 passed | Tests 2 passed | 1 skipped. File-level `afterAll(sql.end())` teardown preserved.
- **Drizzle migration meta snapshots addressed via Option C deferral.** Option A (`npx drizzle-kit generate` against live Docker Postgres with all 5 migrations applied) returned "No schema changes, nothing to migrate" — drizzle-kit does not backfill snapshots for already-applied entries. TECH-DEBT-19-01 recorded in `.planning/STATE.md ## Known Tech Debt` with explicit reactivation trigger (next phase that modifies `src/db/schema.ts`). Audit disposition: PARTIAL, not FAIL.
- **Wave 4 final Docker gate green.** `bash scripts/test.sh` EXIT 0. `npx tsc --noEmit`: 0 errors. 10 failed files / 94 failed tests — this matches the Wave 1 Cat A (45) + Cat B (49) pre-existing baseline EXACTLY. Wave 3 had 11/95 (because TEST-12 was the expected break); Wave 4 returns to 10/94 because TEST-12 now passes.
- **v2.1 milestone restoration complete.** All 5 previously-unsatisfied requirements (SWEEP-01, SWEEP-02, SWEEP-04, RES-02, RES-06) now have code + test evidence satisfying the audit criteria. Integration checks for sweep wiring, channel separation, and ACCOUNTABILITY prompts all resolve from FAIL → PASS. Flows B (deadline → resolution) and E (auto-escalation) are COMPLETE.

## Task Commits

Each task was committed atomically:

1. **Task 1: Realign TEST-12 to channel-separation contract (SWEEP-02)** — `03b17c6` (test)
2. **Task 2: Record TECH-DEBT-19-01 for deferred drizzle meta snapshots (Option C)** — `d8c7980` (docs)
3. **Task 3: Phase 19 gate green — v2.1 restoration complete (final marker)** — `95ebb77` (chore, empty commit)

## Files Created/Modified

- `src/decisions/__tests__/synthetic-fixture.test.ts` (modified, 561 → 618 lines) — Hoisted mock stack extended at module level with channel-aware state mocks (`mockHasSentTodayAccountability`, `mockHasSentTodayReflective`, `mockSetLastSentAccountability`, `mockSetLastSentReflective`) + 5 escalation KV helpers (`mockGetEscalationSentAt/Count`, `mockSetEscalationSentAt/Count`, `mockClearEscalationKeys`) + `mockClearCapture`. `vi.mock('../../proactive/state.js')` factory now exposes the channel-separation shape. `vi.mock('../../decisions/capture-state.js')` now also overrides `clearCapture`. TEST-12 describe body rewritten to assert channel independence + 2-sends + write-before-send + per-channel cap writes + escalation bootstrap. beforeEach switched from `vi.clearAllMocks()` to `vi.resetAllMocks()` to drain TEST-10's leftover `mockResolvedValueOnce` queue.
- `.planning/STATE.md` (modified) — Added `## Known Tech Debt` section with `TECH-DEBT-19-01` entry linking to this SUMMARY, explaining Option A outcome (drizzle-kit did not backfill), reactivation trigger (next phase modifying `src/db/schema.ts`), and audit disposition (PARTIAL, not FAIL).

## TEST-12 Realignment Evidence

### Before vs after assertions

| Assertion | Before (degraded single-pipeline) | After (channel-separation contract) |
|-----------|------------------------------------|--------------------------------------|
| Result trigger type | `result.triggerType === 'silence'` | `result.accountabilityResult?.triggerType === 'decision-deadline'` + `result.reflectiveResult?.triggerType === 'silence'` |
| Send count | `mockSendMessage.toHaveBeenCalledTimes(1)` | `mockSendMessage.toHaveBeenCalledTimes(2)` |
| Channel results | not asserted | `result.accountabilityResult?.triggered === true` + `result.reflectiveResult?.triggered === true` |
| Write-before-send | not asserted | `mockUpsertAwaitingResolution` called 1× with `(expect.any(BigInt), FAKE_DECISION_ID)` |
| Per-channel cap writes | not asserted | `mockSetLastSentAccountability` called 1× + `mockSetLastSentReflective` called 1× |
| Escalation bootstrap | not asserted | `mockSetEscalationSentAt(FAKE_DECISION_ID, any Date)` + `mockSetEscalationCount(FAKE_DECISION_ID, 1)` |
| Ordering (D-05) | not asserted | First `sendMessage.mock.calls[0][1]` contains `'predicted'` (accountability); second contains `'quiet'` (reflective) |

### Green run output (synthetic-fixture.test.ts full)

```
RUN  v4.1.2 /home/claude/chris/src

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  12:08:53
   Duration  759ms (transform 154ms, setup 0ms, import 592ms, tests 71ms, environment 0ms)
```

TEST-10, TEST-11, and TEST-12 all green under Docker Postgres with the channel-separation contract.

### TEST-10 / TEST-11 preservation (dual proof per revision WARNING 2)

**(a) Byte-exact describe-block diff:**

```bash
$ awk '/^describe..TEST-10/,/^\}\);$/' synthetic-fixture.test.ts > /tmp/t10-post.txt
$ diff /tmp/t10-pre.txt /tmp/t10-post.txt
# (empty — TEST-10 IDENTICAL)

$ awk '/^describe..TEST-11/,/^\}\);$/' synthetic-fixture.test.ts > /tmp/t11-post.txt
$ diff /tmp/t11-pre.txt /tmp/t11-post.txt
# (empty — TEST-11 IDENTICAL)
```

**(b) Positive preservation proof (load-bearing per revision WARNING 2):**

```
$ npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts -t 'TEST-10|TEST-11'

 Test Files  1 passed (1)
      Tests  2 passed | 1 skipped (3)
   Duration  745ms
```

Both TEST-10 and TEST-11 pass unchanged post-realignment; TEST-12 is correctly skipped by the test-name filter.

### Contract grep counts (acceptance criteria)

| Grep | Expected | Actual | Status |
|------|----------|--------|--------|
| `accountabilityResult` | ≥1 | 2 | PASS |
| `reflectiveResult` | ≥1 | 2 | PASS |
| `toHaveBeenCalledTimes(2)` | ≥1 | 1 | PASS |
| `upsertAwaitingResolution` | ≥1 | 5 | PASS |
| `TEST-10\|TEST-11\|TEST-12` | ≥3 | 18 | PASS |

## Migration Snapshot Outcome (Option A → Option C)

### Option A attempt

```bash
$ DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" \
    npx drizzle-kit generate --name=snapshot_backfill

No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/claude/chris/drizzle.config.ts'
12 tables
contradictions 8 columns 0 indexes 2 fks
conversations 6 columns 1 indexes 0 fks
decision_capture_state 6 columns 0 indexes 0 fks
decision_events 9 columns 1 indexes 1 fks
decision_trigger_suppressions 4 columns 1 indexes 0 fks
decisions 24 columns 2 indexes 0 fks
oauth_tokens 8 columns 0 indexes 0 fks
pensieve_embeddings 6 columns 2 indexes 1 fks
pensieve_entries 9 columns 1 indexes 0 fks
proactive_state 3 columns 0 indexes 0 fks
relational_memory 7 columns 0 indexes 0 fks
sync_status 10 columns 0 indexes 0 fks

No schema changes, nothing to migrate 😴
```

drizzle-kit introspected the live DB schema, detected all 12 tables, and reported no changes needed — which means it will NOT backfill the missing 0001/0003 snapshots for already-applied migrations. The meta directory is unchanged:

```
src/db/migrations/meta/
├── 0000_snapshot.json   (17486 bytes, pre-existing)
├── 0002_snapshot.json   (28352 bytes, pre-existing)
├── 0004_snapshot.json   (30145 bytes, pre-existing)
└── _journal.json        (825 bytes, references 0000/0001/0002/0003/0004)
```

This matches the research Pitfall 6 prediction — drizzle-kit treats "already-applied" entries as immutable and only generates NEW migrations when schema diffs are found.

### Option C deferral

Per plan `<restoration_policy>` and revision WARNING 3, recorded as TECH-DEBT-19-01 in `.planning/STATE.md` under a new `## Known Tech Debt` section (not buried in this SUMMARY):

```markdown
## Known Tech Debt

_Entries here are deliberate deferrals with a clear reactivation trigger. Each item links to a phase SUMMARY explaining rationale and conditions under which it would be reopened._

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [.planning/phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - Attempted regeneration via `npx drizzle-kit generate` (Option A) against a live Docker Postgres with all 5 migrations applied. drizzle-kit read the schema, detected 12 tables, and returned "No schema changes, nothing to migrate" — it does NOT backfill snapshots for already-applied entries. The runtime migrator (scripts/test.sh) applies `.sql` files directly and does not need the snapshots — they are only consulted when `drizzle-kit generate` is invoked for a NEW migration.
  - **Reactivation trigger:** the next phase that modifies `src/db/schema.ts` (adding a table/column/enum). At that point the absence of 0001/0003 snapshots will cause a drift diff to be mis-computed; regenerate as part of that phase's migration work.
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block requirement satisfaction for SWEEP-01/02/04, RES-02/06.
```

## Wave 4 Final Docker Gate

Docker volumes wiped (`docker compose -f docker-compose.local.yml down -v`), restarted, all 5 migrations applied via canonical `scripts/test.sh` harness.

### Gate totals

```
Test Files  10 failed | 53 passed (63)
Tests  94 failed | 799 passed (893)
Errors  4 errors (all unhandled huggingface EACCES from Cat B — pre-existing)
Duration  1803.42s (~30 min)
EXIT 0
```

### Failed file list (all pre-existing per deferred-items.md)

| File | Failures | Category |
|------|----------|----------|
| `chris/__tests__/engine.test.ts` | 29 | Cat A (engine mock-chain) |
| `chris/__tests__/engine-mute.test.ts` | 7 | Cat A (engine mock-chain) |
| `chris/__tests__/engine-refusal.test.ts` | 3 | Cat A (engine mock-chain) |
| `chris/__tests__/photos-memory.test.ts` | 5 | Cat A (engine mock-chain) |
| `chris/__tests__/language.test.ts` | 1 | Cat A (engine mock-chain) |
| `chris/__tests__/live-integration.test.ts` | 21 | Cat B (live API + huggingface EACCES) |
| `chris/__tests__/contradiction-false-positive.test.ts` | 20 | Cat B (huggingface EACCES) |
| `decisions/__tests__/live-accountability.test.ts` | 3 | Cat B (live API) |
| `decisions/__tests__/vague-validator-live.test.ts` | 2 | Cat B (live API) |
| `llm/__tests__/models-smoke.test.ts` | 3 | Cat B (live API) |
| **Total** | **94** | **45 Cat A + 49 Cat B** |

Zero NEW regressions. Wave 3 had 11 files / 95 tests failing (added TEST-12 as the expected break). Wave 4 returns to 10 files / 94 tests failing because TEST-12 now asserts the correct channel-separation contract and passes.

### Positive verification — synthetic-fixture + all proactive tests

Post-gate standalone run to confirm all restored tests green:

```
$ npx vitest run --no-coverage src/decisions/__tests__/synthetic-fixture.test.ts src/proactive/__tests__/

 Test Files  10 passed (10)
      Tests  141 passed (141)
   Duration  1.61s
```

All 10 test files (synthetic-fixture + 9 proactive tests including sweep, state, deadline, sweep-escalation, mute, silence, commitment, opus-analysis, context-builder) pass.

### Structural validation

- `npx tsc --noEmit` → EXIT 0
- All 9 Phase 19 artifacts EXIST: `src/proactive/sweep.ts`, `src/proactive/state.ts`, `src/proactive/prompts.ts`, `src/proactive/triggers/types.ts`, 4 proactive test files, `scripts/test.sh`.

### Contract grep evidence

```
SWEEP-01: createDeadlineTrigger() invoked at sweep.ts:95       → 1 match (≥1 ✓)
SWEEP-02: channel-aware gates in sweep.ts                      → 6 matches (≥2 ✓)
SWEEP-02: 9 channel-aware helpers exported from state.ts       → hasSentTodayAccountability, hasSentTodayReflective, setLastSentAccountability, setLastSentReflective, getEscalationSentAt, setEscalationSentAt, getEscalationCount, setEscalationCount, clearEscalationKeys
SWEEP-04: stale-context dating in deadline.ts                  → 3 matches (≥1 ✓)
RES-02 ordering: upsert@136 < send@139                         → OK
RES-06: escalation block keywords in sweep.ts                  → 13 matches (≥5 ✓)
```

## Milestone Re-Audit (v2.1)

No direct `/gsd-audit-milestone v2.1` tool invocation — re-audit performed by manual requirement-by-requirement inspection of `.planning/v2.1-MILESTONE-AUDIT.md` and `.planning/REQUIREMENTS.md` against restored code.

### Before (v2.1-MILESTONE-AUDIT.md, 2026-04-17T06:50Z)

```yaml
scores:
  requirements: 26/31
  phases: 6/6 (phase-local verifications pass; integration regression post-verification)
  integration: 8/13 wiring checks PASS (2 FAIL, 1 PARTIAL)
  flows: 3/5 (A ✓, B ✗, C ✓, D ✓, E ✗)
```

### After (post-Phase-19 restoration)

```yaml
scores:
  requirements: 31/31         # all 5 SWEEP/RES Phase 19 items now SATISFIED
  phases: 6/6                 # unchanged
  integration: 12/13 PASS + 1 PARTIAL   # 3 prior FAIL → PASS (sweep wiring, channel separation, ACCOUNTABILITY prompts); PARTIAL stays as TECH-DEBT-19-01 (meta snapshots)
  flows: 5/5                  # B (deadline → resolution) + E (auto-escalation) now COMPLETE
```

### Requirement-by-requirement resolution evidence

| Req | Pre-19 status | Post-19 evidence | Post-19 status |
|-----|---------------|-------------------|----------------|
| **SWEEP-01** | unsatisfied | `sweep.ts:44` imports `createDeadlineTrigger`, `sweep.ts:95` invokes it in the accountability channel | ✓ satisfied |
| **SWEEP-02** | unsatisfied | `state.ts` exports 9 channel-aware helpers; `sweep.ts` uses `hasSentTodayAccountability` + `hasSentTodayReflective` as independent channel gates; `sweep.test.ts` + `synthetic-fixture.test.ts TEST-12` assert channel independence | ✓ satisfied |
| **SWEEP-04** | unsatisfied | `deadline.ts` STALE_CONTEXT_THRESHOLD_MS + `buildContext()` path now reachable via restored sweep; `deadline.test.ts` has 12 tests including SWEEP-04 dated-prompt coverage | ✓ satisfied |
| **RES-02** | unsatisfied | `sweep.ts:136` writes `upsertAwaitingResolution(chatId, decisionId)` BEFORE `sweep.ts:139` calls `bot.api.sendMessage` (line ordering verified: 136 < 139); `sweep.test.ts` has write-before-send assertion; `synthetic-fixture.test.ts TEST-12` asserts `upsertAwaitingResolution` called 1× | ✓ satisfied |
| **RES-06** | unsatisfied | `sweep.ts` escalation block (~lines 178-257) runs outside daily cap; 5 escalation helpers used (`getEscalationSentAt`, `setEscalationSentAt`, `getEscalationCount`, `setEscalationCount`, `clearEscalationKeys`); `transitionDecision(..., 'stale', { actor: 'sweep' })` at line 211; `sweep-escalation.test.ts` has 8 tests covering all branches (<48h, count=1&&>=48h, count>=2&&>=48h, bootstrap, error isolation, decision-not-found) | ✓ satisfied |

### Integration checks

| Check | Pre-19 | Post-19 |
|-------|--------|---------|
| Sweep → Deadline → Lifecycle → Capture-state wiring | FAIL | PASS (sweep.ts invokes createDeadlineTrigger + upsertAwaitingResolution + transitionDecision via restored code) |
| Channel separation independence | FAIL | PASS (state.ts exports channel helpers; sweep.ts uses them; tests assert) |
| Missing ACCOUNTABILITY proactive prompts | FAIL | PASS (prompts.ts exports ACCOUNTABILITY_SYSTEM_PROMPT + ACCOUNTABILITY_FOLLOWUP_PROMPT per Plan 19-02) |
| Migration meta snapshot integrity | PARTIAL | PARTIAL (unchanged — TECH-DEBT-19-01 deferred per Option C; drizzle-kit does not backfill) |

### Flow status

| Flow | Pre-19 | Post-19 |
|------|--------|---------|
| A. Capture → open-draft | COMPLETE | COMPLETE |
| B. Deadline & resolution end-to-end | BROKEN (sweep never invoked deadline trigger) | **COMPLETE** (sweep → deadline → upsert → Telegram → engine PP#0 → handleResolution → handlePostmortem end-to-end functional + test-verified) |
| C. Stats & dashboard | COMPLETE | COMPLETE |
| D. Suppression | COMPLETE | COMPLETE |
| E. Auto-escalation | BROKEN (no escalation block; clearEscalationKeys missing) | **COMPLETE** (48h follow-up + 2-non-reply stale transition + clearCapture + clearEscalationKeys all functional + test-verified) |

## Decisions Made

- **Option C taken for migration meta snapshots** because Option A (`drizzle-kit generate`) returned "No schema changes, nothing to migrate" — drizzle-kit explicitly does not backfill snapshots for already-applied entries 0001/0003 (which were originally hand-written single-line enum additions, not generated by drizzle-kit). Accepted PARTIAL audit disposition per plan `<restoration_policy>`. TECH-DEBT-19-01 recorded in project-level STATE.md (not just phase SUMMARY) per revision WARNING 3.
- **`vi.resetAllMocks()` required in TEST-12 beforeEach** instead of `vi.clearAllMocks()`. Initial attempt with `clearAllMocks` failed because TEST-10 queues 4 `.mockResolvedValueOnce(...)` entries on `mockAnthropicCreate` that accumulate into later tests. The error surfaced as `expected 'Noted.' to contain 'predicted'` — TEST-12's first call was returning the fourth mock response from TEST-10 (handlePostmortem's "Noted." ack). `resetAllMocks` drains the queue.
- **Dual preservation proof for TEST-10/11 (not just byte-diff) per revision WARNING 2.** The plan originally treated the byte-diff as primary; the revision elevates the positive `-t` filter run to load-bearing status. Both proofs executed and documented; both pass.
- **No new mocks for `transitionDecision` (lifecycle.js).** TEST-10 and TEST-11 use the REAL `transitionDecision` via direct import. Sweep's escalation loop would call the real one too, but escalation-loop's `db.select().from(decisionCaptureState).where(...)` returns an empty array in TEST-12 (because the test's cleanup() wipes `decision_capture_state` + `upsertAwaitingResolution` is mocked so no row is ever written). Therefore: no need to mock lifecycle.js — and mocking it would break TEST-11's concurrency race.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.clearAllMocks() → vi.resetAllMocks() in TEST-12 beforeEach**
- **Found during:** Task 1 verification (first post-realignment test run)
- **Issue:** First vitest run failed with `expected 'Noted.' to contain 'predicted'`. Root cause: TEST-10 queues 4 `.mockResolvedValueOnce(...)` on `mockAnthropicCreate` that persist into TEST-12 because `vi.clearAllMocks()` does not drain the implementation queue (only clears `mock.calls` / `mock.results`).
- **Fix:** Changed `vi.clearAllMocks()` to `vi.resetAllMocks()` in TEST-12 beforeEach. Also explicitly re-set default resolved values on sweep-path mocks (mockSendMessage, mockSaveMessage, mockUpsertAwaitingResolution, etc.) after reset because resetAllMocks clears implementations — then re-established mock chain with per-test overrides.
- **Files modified:** `src/decisions/__tests__/synthetic-fixture.test.ts` (within the TEST-12 describe block only; TEST-10 and TEST-11 untouched, as confirmed by byte-diff AND positive `-t 'TEST-10|TEST-11'` filter run)
- **Verification:** Full `synthetic-fixture.test.ts` run → 3 passed (3); `-t 'TEST-10|TEST-11'` filter → 2 passed | 1 skipped
- **Committed in:** 03b17c6 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test harness state-leakage)
**Impact on plan:** The deviation was scoped strictly to TEST-12's beforeEach and did not alter the channel-separation contract assertions or touch TEST-10/11. No scope creep; the fix is structurally required for the plan's own `<verify>` block to pass.

## Issues Encountered

None beyond the single `vi.resetAllMocks` issue captured above as a Rule 1 auto-fix. Docker Postgres started cleanly, all 5 migrations applied via `scripts/test.sh`, drizzle-kit ran cleanly (even though it refused to backfill), and the Wave 4 gate exit code was 0 with only pre-existing Cat A + Cat B baseline failures.

## User Setup Required

None — no external service configuration changes required by this plan. Cat B baseline failures (live-integration, live-accountability, vague-validator-live, models-smoke, contradiction-false-positive) remain as operator-environment concerns (real `ANTHROPIC_API_KEY` + writable huggingface cache) — pre-existing per deferred-items.md.

## Known Stubs

None. This plan adds no UI surface or data-flow stubs. TEST-12's assertions drive the live sweep code path end-to-end with all channel-separation effects asserted.

## Threat Flags

None. This plan's only file changes are (a) a test file realignment (TEST-12 describe block rewritten — same mocked dependencies, no new network/DB/auth surface) and (b) a docs-only addition to `.planning/STATE.md`. The threat register (T-19-16 through T-19-19) explicitly accepts or mitigates the three risk vectors (drizzle-kit schema drift noise, meta-snapshot info disclosure, STATE.md tech-debt visibility, TEST-12 git-history of the legacy contract). All four disposition outcomes held.

## Next Phase Readiness

### Phase 19 exit state

- **Phase 19 status:** COMPLETE
- **v2.1 M007 Decision Archive milestone:** restoration complete; ready to ship
- **Requirements:** 31/31 satisfied with code + test evidence
- **Flows:** 5/5 complete (A, B, C, D, E)
- **Integration:** 12/13 PASS + 1 PARTIAL (TECH-DEBT-19-01 — meta snapshots, accepted)
- **Regression:** zero new failures beyond pre-existing Cat A + Cat B baseline (45 + 49 = 94 tests across 10 files, all documented in deferred-items.md)

### Forward notes

- **TECH-DEBT-19-01 reactivation:** when the next phase modifies `src/db/schema.ts` (new table/column/enum), the phase planner must include a Task to regenerate `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` as part of the new migration's `drizzle-kit generate` run. The reactivation trigger is already recorded in `.planning/STATE.md ## Known Tech Debt`.
- **scripts/test.sh confirmation:** restored in Plan 19-01 Task 0 per deviation D19-01-B; Wave 4 gate used the canonical 5-migration harness without incident.
- **v2.1 milestone audit artifact (`/.planning/v2.1-MILESTONE-AUDIT.md`):** may be re-run by the user via `/gsd-audit-milestone v2.1` to regenerate the YAML frontmatter with updated scores. The evidence tables in this SUMMARY document what that re-audit will find. Manual re-audit concluded `requirements: 31/31`, `integration: 12/13 PASS + 1 PARTIAL`, `flows: 5/5`.

### Deferred items

- **TECH-DEBT-19-01** (project-level STATE.md) — drizzle meta snapshots 0001 + 0003 missing; reactivate at next schema change.
- **Pre-existing baseline** (phase-level deferred-items.md) — Cat A (45 engine-mock-chain failures) and Cat B (49 live-API + huggingface-env failures); neither is v2.1 scope.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`), so plan-level TDD gates do not apply. Nevertheless, the realignment follows a natural RED-first pattern — TEST-12 was broken by Plan 19-03's restoration (the expected "RED" signal documented in 19-03-SUMMARY.md), and this plan flips it to GREEN by aligning the assertions with the restored production contract. No RED/GREEN/REFACTOR commit sequence required.

## Self-Check

| Claim | Verification |
|---|---|
| Task 1 commit `03b17c6` exists | `git log --oneline` shows `03b17c6 test(19-04): realign TEST-12 to channel-separation contract (SWEEP-02)` |
| Task 2 commit `d8c7980` exists | `git log --oneline` shows `d8c7980 docs(19-04): record TECH-DEBT-19-01 for deferred drizzle meta snapshots` |
| Task 3 commit `95ebb77` exists | `git log --oneline` shows `95ebb77 chore(19-04): Phase 19 gate green — v2.1 restoration complete` |
| `src/decisions/__tests__/synthetic-fixture.test.ts` 618 lines with TEST-12 channel-separation assertions | `wc -l` = 618; grep `accountabilityResult` = 2; grep `toHaveBeenCalledTimes(2)` = 1 |
| TEST-10 and TEST-11 describe blocks byte-identical to pre-realignment | `diff /tmp/t10-pre.txt /tmp/t10-post.txt` empty; `diff /tmp/t11-pre.txt /tmp/t11-post.txt` empty |
| TEST-10 and TEST-11 pass via test-name filter | `npx vitest run -t 'TEST-10|TEST-11'` → Test Files 1 passed; Tests 2 passed | 1 skipped |
| All 3 tests (TEST-10/11/12) pass under Docker Postgres | `npx vitest run synthetic-fixture.test.ts` → 3 passed |
| `.planning/STATE.md` has `## Known Tech Debt` section with TECH-DEBT-19-01 | `grep -c "^## Known Tech Debt"` = 1; `grep -c "TECH-DEBT-19-01"` = 1 |
| `bash scripts/test.sh` EXIT 0 | Background task completed with exit code 0 per task-notification |
| `npx tsc --noEmit` 0 errors | EXIT: 0 |
| All 9 Phase 19 artifacts exist | all EXISTS verified |
| Wave 4 gate failures match Cat A + Cat B baseline (no new regressions) | 10 files / 94 tests failing; Wave 3 was 11/95 (+TEST-12 break); Wave 4 = 10/94 (TEST-12 green) |
| Contract greps all pass (SWEEP-01/02/04, RES-02/06) | SWEEP-01 = 1; SWEEP-02 = 6; SWEEP-04 = 3; RES-02 upsert@136 < send@139; RES-06 = 13 |
| Plan 19 exit criteria: requirements 31/31 | All 5 previously-unsatisfied SWEEP/RES requirements now have code + test evidence |

Self-Check: **PASSED**

---
*Phase: 19-proactive-pipeline-restoration*
*Completed: 2026-04-17*
