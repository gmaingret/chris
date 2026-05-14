---
phase: 25-ritual-scheduling-foundation-process-gate
reviewed_at: 2026-05-14
files_reviewed: 11
blocker_count: 2
warning_count: 7
---

# Phase 25: Code Review

**Reviewed:** 2026-05-14
**Depth:** standard
**Status:** issues_found

## Summary

Phase 25 substrate has shipped and been deployed; the famous `lt → lte` P0 bug
(memory note `project_m009_first_fire_pending.md`) was already fixed in
`idempotency.ts:111-113`. This review re-reads the **current** source against
the project-specific guard rails (cron timezones, atomic-fire races,
scheduler reentrancy, raw SQL, Telegram input).

Two new BLOCKER-class issues surface in the **current** code:

1. A subtle clock-resolution race in `tryFireRitualAtomic` that can break
   exactly-once when two ticks run inside the same ms.
2. The `ritualResponseWindowSweep` runs the per-row PAIRED INSERT + skip-count
   UPDATE **outside a transaction** (3 writes per row), so a mid-row failure
   leaks half a fire event into the audit log.

Seven WARNING-class issues cover cron registration races, missing input
validation on `RITUAL_SWEEP_CRON` content, jsonb type-coercion footguns,
timezone inconsistency between channel-cap and per-ritual `time_zone`, and
an EN-only logger key surface that won't affect Greg but matches the project
guardrail flag for FR/RU localization expectations.

No raw-SQL-concat against Telegram-supplied input found. No injection, no
secret leakage. The drizzle parameterized layer holds.

---

## Blockers

### BL-01: Clock-resolution race in `tryFireRitualAtomic` defeats exactly-once under Promise.all

- **File:** `src/rituals/idempotency.ts:111-119` (predicate + UPDATE)
- **Issue:** The guard predicate `lte(rituals.lastRunAt, lastObserved)` is
  load-bearing for race semantics, but the SET clause writes
  `lastRunAt: new Date()` from **application clock**. Trace two concurrent
  invocations against the same row with `lastObserved = T1`:

  1. Sweep A and Sweep B both call `tryFireRitualAtomic(id, T1, …)` inside
     the same JS event-loop tick. Both create a `new Date()` value `T_now`.
     **`Date.now()` resolution is 1 ms**; under Promise.all on a fast box
     both `new Date()` calls can return the **same** integer ms.
  2. Postgres row-level locking serializes. Sweep A wins → row’s
     `last_run_at` = `T_now`.
  3. Sweep B’s WHERE re-evaluates: `last_run_at(=T_now) <= T1`. If
     `T_now === T1` (i.e. caller’s observation was also taken in the same
     ms) the predicate is TRUE → second UPDATE fires.

  This is exactly the failure class the M009 lt→lte fix was supposed to
  close. With `lte`, the only thing preventing the dual-fire is the JS
  clock advancing by ≥1 ms between Sweep A’s `new Date()` call and Sweep
  B’s predicate re-evaluation against the post-commit row state. That is
  not guaranteed on a hot path.
- **Impact:** Under high-frequency sweeps (the every-minute
  `RITUAL_SWEEP_CRON: '* * * * *'` shipping in `config.ts:73` plus the
  every-minute `ritualConfirmationSweep` from `cron-registration.ts:151`)
  two sweep callers can collide. Net effect: ritual fires twice in one
  observation window → Greg receives duplicate Telegram prompts and the
  channel-cap counter increments twice. This is the M009 “second fire”
  failure class re-armed via the back door.
- **Fix:** Use postgres `now()` for the SET clause and tighten the
  predicate to strict `<` against `lastObserved` **plus** the existing
  isNull branch:
  ```ts
  const updated = await db
    .update(rituals)
    .set({ lastRunAt: sql`now()`, nextRunAt: newNextRunAt })
    .where(and(
      eq(rituals.id, ritualId),
      lastObserved
        ? or(isNull(rituals.lastRunAt), lt(rituals.lastRunAt, sql`now()`))
        : isNull(rituals.lastRunAt)
    ))
    .returning();
  ```
  Postgres `now()` advances monotonically per transaction and is strictly
  greater than any previously committed `now()` from a different
  transaction, restoring the exactly-once contract regardless of JS clock
  granularity. Add a regression test that fires two `Promise.all`
  invocations in the same JS macrotask with `vi.useFakeTimers()` frozen.

### BL-02: `ritualResponseWindowSweep` per-row inserts are not transactional → audit-log can desync from `skip_count`

- **File:** `src/rituals/scheduler.ts:374-425` (per-row loop)
- **Issue:** Each expired pending row performs **three independent writes**
  in sequence:
  1. `INSERT ritualFireEvents (outcome=WINDOW_MISSED)`
  2. `INSERT ritualFireEvents (outcome=FIRED_NO_RESPONSE)`
  3. `UPDATE rituals SET skip_count = skip_count + 1`

  The atomic-consume in step 0 (`UPDATE ritualPendingResponses SET
  consumedAt = now WHERE consumed_at IS NULL RETURNING`) already committed,
  so a failure in any of the three writes after that point leaves the
  pending row CONSUMED but the audit log incomplete. The SUMMARY comment
  on line 397 admits “Two sequential inserts, NOT a transaction — both
  are idempotent under retry because each has a unique uuid PK”. That
  claim is wrong: there is no retry loop. If `db.insert(ritualFireEvents)`
  for WINDOW_MISSED throws after the consume commit, the loop’s outer
  try/catch (in `runRitualSweep:104-108`) swallows the error and the
  iteration is **never re-attempted** (the pending row is already
  `consumedAt != null`, so the next sweep tick’s `isNull(consumedAt)`
  predicate excludes it).
- **Impact:** Data-fidelity violation (project guardrail: “flag silent
  loss”). On a single failed insert mid-iteration:
  - `skip_count` can be left un-incremented even though the policy said the
    skip happened (Phase 28 SKIP-01 contract violated).
  - The `ritual_fire_events` audit log will be missing either
    `window_missed`, `fired_no_response`, or both — downstream Phase 28
    projections that count skips from events will silently
    under-report. Greg’s skip-threshold-driven adjustment dialogue gate
    becomes off-by-N forever.
  - Worst case: one INSERT succeeds, second throws → asymmetric pair in
    the audit log that the “PAIRED EMIT” contract (line 396 comment)
    explicitly disclaims.
- **Fix:** Wrap steps 1–3 in `db.transaction(async (tx) => …)` and move the
  atomic-consume into the same transaction so all four writes commit or
  none do:
  ```ts
  for (const row of expired) {
    try {
      await db.transaction(async (tx) => {
        const [consumed] = await tx.update(ritualPendingResponses)
          .set({ consumedAt: now })
          .where(and(
            eq(ritualPendingResponses.id, row.id),
            isNull(ritualPendingResponses.consumedAt),
          ))
          .returning({ id: ritualPendingResponses.id });
        if (!consumed) return; // race lost
        await tx.insert(ritualFireEvents).values({ … WINDOW_MISSED });
        await tx.insert(ritualFireEvents).values({ … FIRED_NO_RESPONSE });
        await tx.update(rituals).set({ skipCount: sql`${rituals.skipCount} + 1` })
          .where(eq(rituals.id, row.ritualId));
      });
      emittedCount++;
    } catch (err) {
      logger.error({ err, rowId: row.id }, 'rituals.window_sweep.row.error');
      // continue — next row's transaction is independent
    }
  }
  ```
  Mirrors the precedent already in this codebase at
  `src/proactive/state.ts:284-299` (`setEscalationState` transaction).

---

## Warnings

### WR-01: Channel-cap counter uses `config.proactiveTimezone` instead of per-ritual `time_zone`

- **File:** `src/rituals/scheduler.ts:114, 221, 230, 252, 272`
- **Issue:** `hasReachedRitualDailyCap(config.proactiveTimezone)` and the
  matching increments use the **system-wide** proactive timezone. Each
  ritual carries its own `time_zone` field in the validated `RitualConfig`
  (`src/rituals/types.ts:81`). If the operator ever configures a ritual in
  a non-Paris timezone (e.g. travel, vacation rituals), the 3/day rollover
  fires at Paris midnight rather than the ritual’s local midnight.
- **Impact:** Today this is latent (every ritual is Europe/Paris). The
  moment Greg seeds a ritual with `time_zone: 'America/New_York'` the
  channel cap rolls over at the wrong wall-clock instant and either
  silently suppresses or silently permits an extra ritual.
- **Fix:** Either (a) document that the channel cap key is intentionally
  system-tz and add a startup assertion that all `rituals.config.time_zone`
  match `config.proactiveTimezone`, or (b) key the counter per local-date
  *of the ritual being fired*. (a) is the simpler short-term gate.

### WR-02: `validatedCron()` only checks syntactic validity — not semantic safety (e.g. `* * * * * *` 6-field)

- **File:** `src/config.ts:20-26`
- **Issue:** `node-cron.validate()` returns `true` for any syntactically
  parseable expression including 6-field (with seconds) forms. The
  ritual sweep is now `'* * * * *'` (every minute, line 73). An operator
  who fat-fingers `'* * * * * *'` (every second) will pass `validate` and
  ship a 60× cron storm to a production DB sweep. The shape of valid
  expressions is wide and the fail-fast assertion does nothing to bound
  it.
- **Impact:** Operational footgun. Telegram input is untrusted but env is
  operator-trusted, so this is degraded-quality rather than a security
  hole. Greg edits env in one place; a typo blasts the DB.
- **Fix:** After `validate()` returns true, additionally assert
  `expr.trim().split(/\s+/).length === 5` and reject 6-field expressions
  (or any non-5-field form) explicitly. Add a test case.

### WR-03: `scripts/manual-sweep.ts` ESM entry-point guard is fragile under symlinks / Windows

- **File:** `scripts/manual-sweep.ts:45` and `src/index.ts:155`
- **Issue:** `import.meta.url === \`file://${process.argv[1]}\`` does NOT
  match when `process.argv[1]` is a symlinked path, an absolute path with
  trailing differences, or contains URL-unsafe characters. On Greg’s Linux
  Proxmox the failure mode is silent: `npx tsx scripts/manual-sweep.ts`
  resolves the script through a `.bin/` symlink in `node_modules` and the
  comparison may evaluate false → `main()` never runs, exit 0, empty
  output. Operator sees “success” but no sweep ran.
- **Impact:** Silent no-op on operator command — directly contradicts
  D-07’s “invocable via `npx tsx scripts/manual-sweep.ts`” success
  criterion. Worse: same idiom in `src/index.ts:155` could cause the bot
  to silently fail to start under unusual launcher configurations.
- **Fix:** Use `fileURLToPath(import.meta.url) === realpathSync(process.argv[1])`
  via `node:url` + `node:fs`, or the simpler community pattern
  `process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url`.

### WR-04: `incrementRitualDailyCount` TOCTOU acknowledged but exposed by the new every-minute cron

- **File:** `src/proactive/state.ts:192-204`
- **Issue:** The function comment (line 186-191) says the TOCTOU between
  `getValue` and `setValue` is “acceptable for Phase 25 because the ritual
  cron fires once per day at 21:00 Paris and per-tick max-1 ensures only 1
  ritual processes per tick”. **Neither premise holds in the current
  code.** `config.ts:73` ships `'* * * * *'` (every minute) post-deploy
  2026-05-05, and the every-minute `ritualConfirmationSweep` runs
  concurrently. Two ticks in the same minute can both read the same count
  before either writes — both then write `count: N+1`, losing one
  increment. Channel cap is now allow-extra rather than prevent-extra.
- **Impact:** Channel cap can let through 4–5 fires/day rather than the
  documented 3. Defense-in-depth weakened; Pitfall 1 mitigation degraded.
- **Fix:** Replace getValue/setValue with a single atomic JSONB UPSERT.
  The comment already shows the intended fix:
  ```ts
  await db.execute(sql`
    INSERT INTO proactive_state (key, value, updated_at)
    VALUES (${RITUAL_DAILY_COUNT_KEY}, jsonb_build_object('date', ${todayKey}, 'count', 1), now())
    ON CONFLICT (key) DO UPDATE SET
      value = CASE
        WHEN proactive_state.value->>'date' = ${todayKey}
          THEN jsonb_set(proactive_state.value, '{count}', to_jsonb((proactive_state.value->>'count')::int + 1))
        ELSE jsonb_build_object('date', ${todayKey}, 'count', 1)
      END,
      updated_at = now()
  `);
  ```

### WR-05: Scheduler reentrancy — concurrent `runRitualSweep` calls from sweep.ts + cron + manual-sweep.ts

- **File:** `src/rituals/scheduler.ts:85` + call sites
  `src/proactive/sweep.ts:415`, `src/cron-registration.ts:133`,
  `scripts/manual-sweep.ts:33`
- **Issue:** `runRitualSweep` has no in-process mutex. Three independent
  entry points can invoke it concurrently:
  1. The 21:00 Paris (or now `* * * * *`) ritual cron tick.
  2. The proactive sweep at 10:00 Paris (sweep.ts:415 calls
     `runRitualSweep(new Date())` inline).
  3. Greg running `npx tsx scripts/manual-sweep.ts`.

  The DB-level atomic fire (idempotency.ts) prevents *duplicate fires* of
  the same ritual, but the channel-cap increment, the
  `ritualResponseWindowSweep`, and the `autoReEnableExpiredMutes` helper
  all have non-atomic read-modify-write paths. Two callers can each
  observe `hasReachedRitualDailyCap === false`, both proceed past STEP 0,
  both select different due rituals (per-tick max-1 is *per call*, not
  *per tick globally*), both fire — channel cap allows 4–6 fires.
- **Impact:** Defense-in-depth claim weakened. Project guardrail
  “scheduler reentrancy issues” flagged.
- **Fix:** Add a postgres advisory lock at the top of `runRitualSweep`:
  ```ts
  const [{ locked }] = await db.execute(sql`SELECT pg_try_advisory_lock(${RITUAL_SWEEP_LOCK_KEY}) AS locked`);
  if (!locked) { logger.info('rituals.sweep.lock_held'); return []; }
  try { … } finally { await db.execute(sql`SELECT pg_advisory_unlock(${RITUAL_SWEEP_LOCK_KEY})`); }
  ```

### WR-06: `parseRitualConfig` ZodError swallowed as `config_invalid` outcome — no `next_run_at` advance, ritual loops

- **File:** `src/rituals/scheduler.ts:138-293` (outer try/catch)
- **Issue:** If `parseRitualConfig(ritual.config)` throws (ZodError on a
  corrupt jsonb blob or a `schema_version` drift), the catch at line 284
  pushes `{ outcome: 'config_invalid' }` but **does not advance
  `next_run_at`**. The next sweep tick selects the **same ritual** again
  (it is still `next_run_at <= now AND enabled = true`), parses again,
  throws again. The ritual now permanently consumes the per-tick max-1
  slot every minute, starving every other ritual.
- **Impact:** A single bad config row turns one minute’s sweep into an
  infinite poison-pill loop. All other rituals stop firing — silent
  cascade of the kind Phase 25 was built to prevent.
- **Fix:** On `config_invalid`, either (a) disable the ritual (`UPDATE
  rituals SET enabled = false`) and emit an audit event, or (b) advance
  `next_run_at` by the cadence period using best-effort default fields so
  the bad row gets out of the hot path. Option (a) is safer and matches
  the “fail loud, recover deliberately” posture.

### WR-07: Catch-up branch logs `outcome: 'caught_up'` even when the atomic UPDATE race-lost

- **File:** `src/rituals/scheduler.ts:167-180`
- **Issue:** STEP 4 (catch-up ceiling) calls `tryFireRitualAtomic` and
  ignores its return value:
  ```ts
  await tryFireRitualAtomic(ritual.id, ritual.lastRunAt, newNextRunAt);
  results.push({ … outcome: 'caught_up' });
  ```
  If the atomic UPDATE race-lost (peer sweep won), the result still
  reports `caught_up` — misleading audit-log claim. `caught_up` implies
  `next_run_at` was advanced; on a race-loss it wasn’t (by this caller).
- **Impact:** Quality issue. Audit log mis-attribution; obscures real race
  signal in production debugging. Not a data-loss bug because the peer
  did advance, but it's an EN-only logger key that lies about what
  happened.
- **Fix:** Branch on the return:
  ```ts
  const r = await tryFireRitualAtomic(…);
  results.push({ …, outcome: r.fired ? 'caught_up' : 'race_lost' });
  ```

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
