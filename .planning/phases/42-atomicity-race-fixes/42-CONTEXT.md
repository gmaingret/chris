# Phase 42: Atomicity & Race Fixes - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected; recommended option chosen for each)

<domain>
## Phase Boundary

Six independent production-correctness fixes (RACE-01..RACE-06) that close atomicity, idempotency, and DST-edge race-window defects in the ritual-scheduling, wellbeing, and weekly-review code paths. Concurrent fires, mid-transaction throws, and DST edges must no longer silently drop audit-log entries, skip-counter increments, or weekly-review fires.

**In scope (six fixes, all application-layer):**
1. RACE-01 — `tryFireRitualAtomic` uses `sql\`now()\`` (defeats ms-resolution JS-clock collisions). `src/rituals/idempotency.ts:111-119`.
2. RACE-02 — `ritualResponseWindowSweep` paired-insert (window_missed + fired_no_response + skip_count++) wrapped in single `db.transaction`. `src/rituals/scheduler.ts:374-425`.
3. RACE-03 — Wellbeing rapid-tap completion idempotent via "completion-claim" `UPDATE ritual_responses SET respondedAt = now() WHERE id = $1 AND respondedAt IS NULL RETURNING`. `src/rituals/wellbeing.ts:227-258, 263-324`.
4. RACE-04 — Wellbeing skip path uses `jsonb_set` nested merge (matching tap path), not full-jsonb overwrite. `src/rituals/wellbeing.ts:328-346`.
5. RACE-05 — `findOpenWellbeingRow` filter tightened with `fired_at >= now() - interval '24 hours'` belt-and-suspenders against DST edge. `src/rituals/wellbeing.ts:422-450`.
6. RACE-06 — Weekly-review fire transactional: Telegram send gates `respondedAt` + `fire_event` INSERT + `next_run_at` advance. `src/rituals/weekly-review.ts:627-691`.

**Out of scope:**
- T10 operational hygiene items (poison-pill `config_invalid`, `incrementRitualDailyCount` TOCTOU, scheduler reentrancy advisory lock, channel-cap timezone) — explicitly deferred to v2.7 per `REQUIREMENTS.md` Future Requirements.
- Localization (the EN-only `WEEKLY_REVIEW_HEADER` regression that shipped 2026-05-10 lives in Phase 46 L10N-02, not here).
- New ritual capabilities — atomicity hardening only.
- Schema changes / migrations — no DB migration ships in this phase.

</domain>

<decisions>
## Implementation Decisions

### Test Harness Strategy

- **D-42-01:** Ship a shared concurrent-invocation harness helper at `src/__tests__/helpers/concurrent-harness.ts` that 4 of 6 fixes consume (RACE-01, 02, 03, 06 all need `Promise.all` against real Postgres). Helper exposes `runConcurrently<T>(n: number, fn: () => Promise<T>): Promise<T[]>` and a `freezeClock(date)` utility that uses `vi.useFakeTimers()` to pin `Date.now()` to a single ms across all racers — the exact failure surface RACE-01 must close. RACE-04 and RACE-05 are non-concurrent (jsonb merge + DST edge) and use inline test setup. **Rationale:** `idempotency.test.ts` (Phase 25 RIT-10) already proves the `Promise.all + real Postgres` pattern works; extracting it now keeps four RACE tests symmetric and prevents copy-paste drift across phases.

### RACE-01 — `tryFireRitualAtomic` clock fix

- **D-42-02:** SET clause uses `lastRunAt: sql\`now()\`` (postgres-clock, monotonic per-transaction) — replaces `new Date()`. Predicate becomes `or(isNull(rituals.lastRunAt), lt(rituals.lastRunAt, sql\`now()\`))` — strict `<` against `now()` per Phase 25 BL-01 fix recommendation. The `lastObserved` parameter is no longer load-bearing for the race semantics (postgres `now()` advances strictly monotonically per-tx); keep it for caller-visibility/logging but document the semantic shift.
- **D-42-03:** Regression test fires `Promise.all([...])` of two `tryFireRitualAtomic` calls inside a frozen-clock JS macrotask (using harness `freezeClock`) and asserts EXACTLY ONE `{fired: true}`. Extends the existing Test 2 in `idempotency.test.ts:44` rather than replacing it.

### RACE-02 — `ritualResponseWindowSweep` transactional paired-insert

- **D-42-04:** Wrap the atomic-consume (`UPDATE ritualPendingResponses SET consumedAt`) + both `ritualFireEvents` INSERTs (WINDOW_MISSED, FIRED_NO_RESPONSE) + `rituals.skipCount++` UPDATE in a single `db.transaction(async (tx) => {...})` per-row. Mirrors the precedent at `src/proactive/state.ts:284-299` (`setEscalationState`). The "PAIRED EMIT" comment at `scheduler.ts:396` is updated to claim transactional atomicity, not unique-PK retry idempotency (that claim was wrong — there is no retry loop).
- **D-42-05:** Outer `try/catch` per row stays — if a row's transaction fails, log + continue to next row. The transaction is per-row, NOT per-sweep, so a single bad row does not roll back the entire sweep.

### RACE-03 — Wellbeing rapid-tap completion idempotency

- **D-42-06:** Adopt option (a) from Phase 27 BL-01: add an atomic "completion-claim" UPDATE before running side-effects. Pattern:
  ```ts
  const [claimed] = await db
    .update(ritualResponses)
    .set({ respondedAt: new Date() })
    .where(and(
      eq(ritualResponses.id, openRow.id),
      isNull(ritualResponses.respondedAt),
    ))
    .returning({ id: ritualResponses.id });
  if (!claimed) return; // race lost — peer is completing
  // ... only the winner runs wellbeing_snapshots upsert + fire_event INSERT + skip_count=0 + editMessageText
  ```
  This is the canonical idempotency key — `ritual_responses.respondedAt` IS NULL is the winner predicate, consistent with Phase 25's `tryFireRitualAtomic` pattern. Rejected alternatives: (b) wrap in `SELECT FOR UPDATE` transaction (heavier; same semantics); (c) idempotency on `wellbeing_snapshots.snapshot_date` (already idempotent via `ON CONFLICT` — but does NOT dedupe `ritual_fire_events` or `editMessageText` calls, which is the bug surface).
- **D-42-07:** The `wellbeing_completed` `ritual_fire_events` INSERT, `skip_count = 0` UPDATE, and `editMessageText` + `answerCallbackQuery` all run AFTER the claim wins, and ONLY for the winning handler. Non-winning handlers silently return (no error, no log noise — log at DEBUG level once per skipped completion for forensics).

### RACE-04 — Wellbeing skip jsonb_set merge

- **D-42-08:** Use the same `jsonb_set` pattern as the tap path at `wellbeing.ts:237`, nested for the two skip flags:
  ```ts
  metadata: sql`jsonb_set(jsonb_set(
    coalesce(${ritualResponses.metadata}, '{}'::jsonb),
    '{skipped}', 'true'::jsonb, true),
    '{adjustment_eligible}', 'false'::jsonb, true)`
  ```
  Preserves any concurrent `metadata.partial.{e|m|a}` writes that landed between `findOpenWellbeingRow` and the skip UPDATE. Closes the data-fidelity-mandate violation called out in Phase 27 BL-02.
- **D-42-09:** Skip path also adopts the completion-claim guard from D-42-06 against `respondedAt IS NULL` — even though skip itself sets `respondedAt`, the guard prevents a skip from overriding a concurrent completion (or vice versa). Two-way safety on the response row.

### RACE-05 — `findOpenWellbeingRow` DST edge

- **D-42-10:** Add `fired_at >= now() - interval '24 hours'` to the WHERE alongside the existing `date_trunc` filter. Belt-and-suspenders defense: even if DST arithmetic shifts the local-day boundary, the 24-hour absolute window cannot match a row from a prior DST-different day. Rejected alternative: joining against `ritual_fire_events` to exclude rows with terminal outcomes — heavier query, and the 24-hour window is sufficient because `fireWellbeing` runs at 10:00 Paris (next fire ≥ 22 hours away under any DST transition).

### RACE-06 — Weekly-review transactional Telegram send

- **D-42-11:** Reorder the fire pipeline per Phase 29 BL-01 fix recommendation. New order:
  1. INSERT `ritual_responses` (NO `respondedAt`)
  2. Persist Pensieve entry
  3. `bot.api.sendMessage` — wrapped in `try { ... } catch (err) { ... }`
  4. **On send success:** `db.transaction(async (tx) => { tx.update(ritualResponses).set({respondedAt, pensieveEntryId}); tx.insert(ritualFireEvents).values({outcome:'fired', ...}); })`
  5. **On send failure:** INSERT `ritualFireEvents` with `outcome='fired'` + `metadata.telegram_failed: true` (audit log gets the row for skip-tracking visibility) + `db.update(rituals).set({nextRunAt: previousNextRunAt})` to revert the `next_run_at` advance so next Sunday's sweep retries. `ritual_responses.respondedAt` stays NULL. Pensieve entry stays — orphans on a failed weekly send are acceptable (the observation text was generated and may be useful for forensics; the back-reference resolves on retry).
- **D-42-12:** Pre-allocate-then-update is preferred over deferred-trigger pattern. **Rationale:** Drizzle does not expose deferred constraints/triggers in a portable way; the pre-allocate pattern is already used by `journal.ts` (Phase 26 PP#5 pattern) and `wellbeing.ts` `fireWellbeing` — keeps the codebase consistent.
- **D-42-13:** Capture `previousNextRunAt` from the `tryFireRitualAtomic` returned row BEFORE the send so the failure path can revert atomically. Logged as `'rituals.weekly.send_failed'` at ERROR level with `nextRunAt` revert confirmation.

### Migration / Schema Posture

- **D-42-14:** NO migration in this phase. All six fixes are application-layer (transactions, atomic UPDATE predicates, jsonb_set merge, WHERE-clause tightening). `wellbeing_snapshots` already has the right idempotency via `ON CONFLICT (snapshot_date)`. The deferred-fire-event-uniqueness question (could a unique index on `(ritual_id, outcome, fired_at-truncated-to-day)` prevent the RACE-03 dup INSERTs without an app-layer guard?) is rejected: timestamp-truncation indexes are fragile and the completion-claim UPDATE is the cleaner contract.

### Cross-Cutting Patterns

- **D-42-15:** Postgres `now()` in SQL fragments is the canonical "current time" for race semantics — application `new Date()` is reserved for log lines, jsonb metadata payloads, and Telegram message timestamps. Codified in this phase's comment block at `idempotency.ts:96-110`.
- **D-42-16:** `db.transaction` is the canonical pattern for paired writes that must commit-or-rollback together. Precedent: `src/proactive/state.ts:284-299`. Phase 42 extends the pattern to `scheduler.ts` and `weekly-review.ts`.

### Claude's Discretion
- Test file organization: extend existing `idempotency.test.ts` / `wellbeing.test.ts` / `scheduler.test.ts` / `weekly-review.test.ts` rather than creating new files. Add the shared harness as a new helper module only.
- Log levels: WARN for race losses that may indicate operator concern, DEBUG for routine race-losses in the completion-claim path.
- Whether RACE-03 completion-claim helper extracts to a named `claimRitualResponseCompletion(rowId): Promise<boolean>` function or stays inline — extract if it appears in three or more callsites (currently only wellbeing tap + skip).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements + scope
- `.planning/REQUIREMENTS.md` §RACE-01..06 — the six requirements with file:line anchors and exact contract statements.
- `.planning/ROADMAP.md` lines 83-94 — Phase 42 goal + six success criteria (each criterion maps 1:1 to a RACE-N requirement).
- `.planning/milestones/v2.6.1-REVIEW-SYNTHESIS.md` §T2 (lines 46-53) — cross-phase atomicity theme summary, root-cause grouping.

### Source code review reports (the exact diagnoses behind the six fixes)
- `.planning/milestones/v2.4-phases/25-ritual-scheduling-foundation-process-gate/25-REVIEW.md` §BL-01 (lines 42-93) — RACE-01 diagnosis + fix recipe with the `sql\`now()\`` snippet.
- `.planning/milestones/v2.4-phases/25-ritual-scheduling-foundation-process-gate/25-REVIEW.md` §BL-02 (lines 96-156) — RACE-02 diagnosis + transaction wrap snippet.
- `.planning/milestones/v2.4-phases/27-daily-wellbeing-snapshot/27-REVIEW.md` §BL-01 (lines 33-38) — RACE-03 diagnosis + option (a) recommended.
- `.planning/milestones/v2.4-phases/27-daily-wellbeing-snapshot/27-REVIEW.md` §BL-02 (lines 40-54) — RACE-04 diagnosis + `jsonb_set` skip-path snippet.
- `.planning/milestones/v2.4-phases/27-daily-wellbeing-snapshot/27-REVIEW.md` §BL-03 (lines 56-65) — RACE-05 diagnosis + 24-hour-window fix.
- `.planning/milestones/v2.4-phases/29-weekly-review/29-REVIEW.md` §BL-01 (lines 37-46) — RACE-06 diagnosis + recommended ordering with try/catch wrap.

### Source files under change
- `src/rituals/idempotency.ts:111-119` — RACE-01 SET clause + predicate.
- `src/rituals/scheduler.ts:374-425` — RACE-02 paired-insert loop.
- `src/rituals/wellbeing.ts:227-258` — RACE-03 tap completion path (handleTap re-read + isComplete check).
- `src/rituals/wellbeing.ts:263-324` — RACE-03 completeSnapshot body.
- `src/rituals/wellbeing.ts:328-346` — RACE-04 handleSkip body.
- `src/rituals/wellbeing.ts:422-450` — RACE-05 findOpenWellbeingRow WHERE clause.
- `src/rituals/weekly-review.ts:627-691` — RACE-06 fireWeeklyReview orchestrator.

### Codebase precedents (existing patterns to mirror)
- `src/proactive/state.ts:284-299` — `setEscalationState` `db.transaction` precedent for RACE-02 + RACE-06.
- `src/rituals/idempotency.ts:111-128` — `tryFireRitualAtomic` predicate pattern: precedent for RACE-03 completion-claim UPDATE.
- `src/rituals/__tests__/idempotency.test.ts:44-...` — `Promise.all` against real Postgres pattern: precedent for the shared concurrent-invocation harness (D-42-01).
- `src/rituals/__tests__/wellbeing.test.ts:281-312` — existing rapid-tap concurrency test (Test 5) — tighten assertions to require exactly one `wellbeing_completed` fire_event under three-way Promise.all per D-42-06.

### Project conventions
- `.planning/codebase/CONVENTIONS.md` §Code Style — strict ESM, `.js` suffix on internal imports, drizzle parameterized SQL templates only (no `sql.raw` with user-controllable data).
- `.planning/codebase/TESTING.md` lines 22-46 — `fileParallelism: false` is load-bearing; full Docker tests are canonical (`bash scripts/test.sh`); MEMORY note `feedback_always_run_docker_tests` is binding.
- `CLAUDE.md` (project root) — does not exist; project-level guidance lives in `.planning/codebase/*.md` + `.planning/PROJECT.md`.

### Project memory / live state
- MEMORY note `project_m009_first_fire_pending.md` — RACE-01 is the permanent fix for the `lt → lte` bug class that shipped 2026-05-10 (commit c76cb86). Phase 42 RACE-01 closes the ms-clock-collision back-door that the `lt → lte` fix left open.
- `.planning/STATE.md` — milestone v2.6.1, planning status; first weekly_review fired 2026-05-10 20:00 Paris on the broken EN-header path (the RACE-06 silent-miss failure mode has not yet manifested in production).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`db.transaction` from `src/db/connection.ts`** (Drizzle wrapper) — used by `src/proactive/state.ts:284`. The canonical precedent for RACE-02 + RACE-06 transactional wraps.
- **`tryFireRitualAtomic` UPDATE-with-predicate pattern** at `src/rituals/idempotency.ts:115-119` — pattern reused for the RACE-03 completion-claim UPDATE on `ritual_responses.respondedAt IS NULL`.
- **`jsonb_set` merge pattern** at `src/rituals/wellbeing.ts:237` (tap path) — RACE-04 reuses this verbatim for the skip path.
- **`vi.useFakeTimers()` clock freeze** — already imported in `idempotency.test.ts`; harness wraps this into `freezeClock(ms)` for the four concurrent tests.
- **Postgres `sql\`now()\``** — already imported as `sql` from `drizzle-orm` across the rituals module; no new imports needed.

### Established Patterns
- **Real Postgres for concurrency tests (no mocks).** `idempotency.test.ts:5-26` is explicit: "Postgres concurrent-update semantics MUST be tested with REAL postgres" — mock-based concurrency tests are insufficient. All RACE-N concurrency tests run under `bash scripts/test.sh` (Docker postgres on port 5433).
- **Per-row error isolation in sweep loops.** `runRitualSweep` outer try/catch at `scheduler.ts:104-108` catches per-row errors and continues. RACE-02's transactional wrap stays INSIDE this outer try/catch — transaction failure in one row does not abort the whole sweep.
- **Drizzle parameterized SQL only.** No `sql.raw` with user-controllable values. RACE-04's `jsonb_set` snippet uses `sql\`...\`` templates and bound string parameters.
- **Side-effect ordering: send-then-bookkeep.** Project pattern is "send first, mark complete on success" (per `journal.ts` PP#5 and the corrected ordering for RACE-06). The current weekly-review.ts inversion is the bug.

### Integration Points
- **Sibling phase 41 (Adjustment-Dialogue Rework)** modifies the same files (`adjustment-dialogue.ts`, `skip-tracking.ts`) but DIFFERENT LINES. Per ROADMAP.md, Phase 41 and Phase 42 are independent — no merge conflicts expected, but planner should confirm no overlap on the `rituals.skip_count` mutation paths in `wellbeing.ts:312` (RACE-03 keeps `skip_count = 0` on completion, untouched by ADJ-04).
- **Phase 28 SKIP-01 invariants** (skip-tracking reads `ritual_fire_events.outcome = 'wellbeing_completed'`) — RACE-03 must preserve exactly-once `wellbeing_completed` emission. Phase 28's contract is what makes the dup-event a real bug, not a cosmetic issue.
- **Phase 25 RIT-10 invariants** (exactly-once-per-observation contract on `tryFireRitualAtomic`) — RACE-01 strengthens this from JS-clock to postgres-clock. No behavior change for the steady-state caller.

</code_context>

<specifics>
## Specific Ideas

- **Harness API shape suggestion (`src/__tests__/helpers/concurrent-harness.ts`):**
  ```ts
  export async function runConcurrently<T>(n: number, fn: (idx: number) => Promise<T>): Promise<T[]> {
    return Promise.all(Array.from({length: n}, (_, i) => fn(i)));
  }
  export function freezeClock(at: Date | number): () => void {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    return () => vi.useRealTimers();
  }
  // Used by tests in idempotency.test.ts, scheduler.test.ts, wellbeing.test.ts, weekly-review.test.ts.
  ```
- **Failure-mode regression test for RACE-06:** mock `bot.api.sendMessage` to throw a transient `GrammyError('429')`, fire `fireWeeklyReview`, assert (a) `ritual_responses.respondedAt IS NULL`, (b) one `ritual_fire_events` row with `metadata.telegram_failed = true`, (c) `rituals.nextRunAt` reverted to the prior value, (d) Pensieve entry exists (acceptable orphan).
- **RACE-01 dual-fire test:** `freezeClock(T1)` then `runConcurrently(2, () => tryFireRitualAtomic(id, T1_minus_1, newNext))` — under the OLD code with `new Date()` SET clause, both invocations' WHERE re-eval would pass at frozen clock. Under the NEW `sql\`now()\`` code, postgres `now()` advances per-tx and the second invocation's WHERE matches zero rows. This test is the gate that proves the M009 second-fire bug class is permanently closed.
- **No new fire_event outcomes:** RACE-06 uses the existing `'fired'` outcome with discriminator `metadata.telegram_failed: true` (matching D-28's discriminator-via-metadata convention). No type-union extension needed.

</specifics>

<deferred>
## Deferred Ideas

- **Postgres advisory lock on `runRitualSweep`** (Phase 25 WR-05) — defense-in-depth against concurrent sweep callers (cron tick + proactive sweep + manual-sweep.ts). Deferred to v2.7 per REQUIREMENTS.md "Future Requirements / T10 Operational hygiene".
- **6-field cron validation** (Phase 25 WR-02) — operator-trust footgun. Deferred to v2.7.
- **Poison-pill `config_invalid` next_run_at advance** (Phase 25 WR-06) — Phase 42's transactional wraps do not change this behavior; orthogonal concern.
- **Channel-cap timezone consistency** (Phase 25 WR-01) — latent; only matters when a non-Paris ritual ships. Deferred.
- **`incrementRitualDailyCount` TOCTOU** (Phase 25 WR-04) — single-statement UPSERT; deferred to v2.7.
- **Weekly-review `respondedAt` semantic overload** (Phase 29 WR-05) — naming/semantics, not atomicity. Phase 42's RACE-06 keeps the existing pattern (respondedAt as system-completion marker on success); a discriminator column (`responded_by`) is a v2.7+ concern.
- **`fireWellbeing` insert-failure return value** (Phase 27 WR-05) — silent fire-event loss on `db.insert` returning empty. Tangentially related to RACE-06 but distinct surface — kept out of this phase to bound the change set.
- **`wellbeing_completed` event uniqueness via partial DB unique index** — considered as an alternative idempotency mechanism for RACE-03; rejected (timestamp-truncation indexes are fragile + the completion-claim UPDATE is the cleaner contract). Documented for future revisit if app-layer guards ever drift.
- **Curly-apostrophe FR regex fix** (Phase 29 WR-03) — localization concern, lives in Phase 46 L10N-03.

</deferred>

---

*Phase: 42-atomicity-race-fixes*
*Context gathered: 2026-05-14*
*Mode: --auto (single-pass, all gray areas auto-selected, recommended option chosen)*
