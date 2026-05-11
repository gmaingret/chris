# Phase 25: Ritual Scheduling Foundation + Process Gate — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults auto-selected for each gray area)

<domain>
## Phase Boundary

Phase 25 lays the **substrate non-negotiable** for v2.4 M009. Migration `0006_rituals_wellbeing.sql` lands the 6 new tables (`rituals`, `wellbeing_snapshots`, `ritual_responses`, `ritual_fire_events`, `ritual_config_events`, `ritual_pending_responses`) + `RITUAL_RESPONSE` 14th enum value + 3 indexes from day one (D034 precedent). The Luxon-based DST-safe cadence helper (`src/rituals/cadence.ts`), the bounded Zod-validated `RitualConfig` schema (8 fields + `schema_version`), the atomic `UPDATE rituals … RETURNING *` idempotency helper, the ritual channel slot inside `runSweep()` between accountability and reflective, and the second cron tick at 21:00 Europe/Paris in `src/index.ts` all ship together. After Phase 25 lands, Phases 26 / 27 / 29 can ship in parallel against this substrate.

**In scope (12 requirements after PROC verdict — see decisions below):**
- RIT-01..06 — Migration 0006 (tables + enum + indexes + meta-snapshot + scripts/test.sh psql line — HARD CO-LOCATION #7)
- RIT-07 — `RitualConfig` Zod schema (8 fields + `schema_version`)
- RIT-08 — `src/rituals/cadence.ts` Luxon-based `computeNextRunAt`; DST-safe across 2026-03-29 + 2026-10-25
- RIT-09 — Ritual channel slot in `runSweep` between accountability and reflective
- RIT-10 — Atomic `UPDATE rituals … RETURNING *` idempotency
- RIT-11 — Second cron tick at 21:00 Europe/Paris in `src/index.ts`
- RIT-12 — `ritualSweepCron` env var + `cron.validate` at config load + `/health` reports `ritual_cron_registered`

**Out of scope (deferred to later phases or upstream):**
- PROC-01, PROC-02 — verdict REDUNDANT post-GSD 1.38.5 (verdict block in `STATE.md` Open Items, evidence in `.claude/get-shit-done/workflows/execute-phase.md:1338-1376` and `.claude/get-shit-done/templates/summary.md:41`). Recommend marking both `[x] (upstream: GSD 1.38.4/1.38.5)` in REQUIREMENTS.md before planning.
- All ritual handlers (voice note, wellbeing keyboard, weekly review, skip-tracking) — Phases 26-29
- HARN-04..06 fixture refresh — Phase 30
- PP#5 ritual-response detector — co-locates with Phase 26 voice note handler (HARD CO-LOCATION #1)

</domain>

<decisions>
## Implementation Decisions

### Process gate carry-in disposition (D-01)

**D-01:** **Drop PROC-01 and PROC-02 from Phase 25 scope.** Both verified REDUNDANT post-GSD 1.38.5 (full verdict + evidence in `.planning/STATE.md` Open Items section, written 2026-04-26).

- **Rationale:** GSD 1.38.4 wired `gsd-verifier` into `/gsd-execute-phase` and made the verifier read VERIFICATION.md status from disk (`grep "^status:" "$PHASE_DIR"/*-VERIFICATION.md` at `~/.claude/get-shit-done/workflows/execute-phase.md:1374-1376`); 1.38.5 + the templates/summary.md change make `requirements-completed` frontmatter MANDATORY (`~/.claude/get-shit-done/templates/summary.md:41`) with the executor copying the array verbatim from PLAN.md (`~/.claude/get-shit-done/workflows/execute-plan.md:336`) and `gsd-sdk query summary-extract --pick requirements_completed` parsing it (`~/.claude/get-shit-done/bin/lib/commands.cjs:463`). Both deliverables have shipped upstream.
- **Scope impact:** Phase 25 plan budget shrinks from ~4 plans to **3 plans** (one less plan-task and ~30-50 LoC of regression test that's already covered by upstream gsd-sdk tests).
- **Required follow-up before planning:** Greg edits `.planning/REQUIREMENTS.md` to mark PROC-01 and PROC-02 as `[x] (upstream: GSD 1.38.4/1.38.5)`, edits `.planning/ROADMAP.md` to update Phase 25 requirement count (14 → 12) and milestone total (54 → 52). The planner CANNOT do this — Greg owns scope edits per the verification todo's instruction.
- **Rejected alternative:** Ship a Chris-side regression test confirming the new GSD behavior. Rejected because that test belongs in the upstream `gsd-sdk` test suite (the original PROC-01 spec said "Regression test in `gsd-sdk` test suite asserts the gate fires") — not in Chris's repo.

### Plan split structure (D-02)

**D-02:** **3 plans** for Phase 25, partitioned by HARD CO-LOCATION constraint #7 (which forces migration + meta-snapshot + scripts/test.sh into ONE plan) and by surface-area cleavage between schema, in-process helpers, and process boundaries (cron + sweep entry-point).

- **Plan 25-01 (Migration substrate, atomic):** Migration `0006_rituals_wellbeing.sql` + drizzle meta-snapshot regenerated via `scripts/regen-snapshots.sh` clean-slate iterative replay (TECH-DEBT-19-01 pattern) + `scripts/test.sh` psql line. Tables: `rituals`, `wellbeing_snapshots`, `ritual_responses`, `ritual_fire_events`, `ritual_config_events`, `ritual_pending_responses`. Enum: `RITUAL_RESPONSE` (14th value). Indexes: partial `btree(next_run_at) WHERE enabled = true`, `btree(snapshot_date)`, `(ritual_id, fired_at DESC)` on `ritual_responses`. Drizzle schema additions in `src/db/schema.ts`. **Requirements: RIT-01, RIT-02, RIT-03, RIT-04, RIT-05, RIT-06.** **HARD CO-LOCATION #7 enforced — splitting any of the three creates lineage breakage.**
- **Plan 25-02 (Pure-function helpers):** `src/rituals/types.ts` with `RitualConfigSchema` (Zod, 8 fields + `schema_version`) and discriminated `RitualFireOutcome` union scaffold; `src/rituals/cadence.ts` exporting `computeNextRunAt(now, config)` using Luxon (`DateTime.plus({ days/weeks/months })` + `setZone(tz)`) for all 4 cadences (daily / weekly / monthly / quarterly per TS-10 forward-compat); `src/rituals/idempotency.ts` (or co-located in `scheduler.ts`) exporting the atomic `UPDATE rituals SET last_run_at=now(), next_run_at=$NEW WHERE id=$ID AND (last_run_at IS NULL OR last_run_at < $LAST_OBSERVED) RETURNING *` query helper (mirrors M007 D-28 pattern). DST property tests pinned at 2026-03-29 + 2026-10-25. **Requirements: RIT-07, RIT-08, RIT-10.**
- **Plan 25-03 (Process boundaries):** `src/rituals/scheduler.ts` exporting `runRitualSweep(now, deps)`; integration into `src/proactive/sweep.ts` as the third channel between accountability and reflective (per Disagreement #1 resolution + ARCHITECTURE.md framing); second `cron.schedule()` registration in `src/index.ts` at 21:00 Europe/Paris peer to existing 10:00 + 23:00 ticks; `ritualSweepCron` env var with safe default `0 21 * * *` in `src/config.ts`; `cron.validate` short-circuit at config load (NEW pattern — existing config has none); `/health` route in `src/index.ts` reports `ritual_cron_registered: true`. **Requirements: RIT-09, RIT-11, RIT-12.**

- **Rejected alternative — 4 plans split by separating idempotency from cadence:** Splitting D-02's Plan 25-02 into "schema/types" + "cadence + idempotency" breaks the natural cohesion of pure-function helpers and creates an extra integration boundary for nothing. The atomic-update helper is ~10 LoC; it has no business being its own plan.
- **Rejected alternative — 2 plans collapsing helpers into substrate:** Bundling cadence + schema into Plan 25-01 violates the spirit of HARD CO-LOCATION #7 (which is about migration lineage, not "everything goes in one plan") and creates a >10 file plan that's hard to review.

### Cron expression validation behavior at config load (D-03)

**D-03:** **Fail-fast at config load** — `cron.validate(config.ritualSweepCron)` runs in `src/config.ts` immediately after `process.env.RITUAL_SWEEP_CRON` is read; on `false`, throw a startup error with the offending expression in the message. Container fails its `/health` check and Docker Compose restart-loops until env is fixed.

- **Rationale:** A silently-broken cron expression means rituals never fire — the symptom is "Greg notices the bot didn't message him for several days" which is exactly the trust-breaking failure mode this milestone is built to prevent. Existing M008 patterns (e.g. `src/episodic/consolidate.ts` config preconditions) already throw at config load; M009 inherits that posture.
- **Mechanism:** `import * as cron from 'node-cron';` at top of `src/config.ts`; `if (!cron.validate(ritualSweepCron)) throw new Error(\`config: invalid RITUAL_SWEEP_CRON expression "\${ritualSweepCron}"\`);`. Runs before any `db.connect()` so the failure surface is small and obvious.
- **Test:** `RITUAL_SWEEP_CRON=garbage` in `src/config.test.ts` (or `src/__tests__/config.test.ts`) asserts `import('../config.js')` rejects with a message matching `/invalid RITUAL_SWEEP_CRON/`. Mirrors how Phase 22 tested `EPISODIC_CRON_TIME` (or analogous).
- **Rejected:** Warn-and-continue. Rejected because the failure is invisible — Greg has no way to notice "ritual didn't fire" until Phase 26's voice note ritual is supposed to send and doesn't, by which point days of trust have eroded.

### Ritual channel daily counter (D-04 — REFINED 2026-04-26 post-RESEARCH Q3)

**D-04:** **One independent counter for the ritual channel as a whole, shared across all rituals, with a daily ceiling of 3.** The ritual channel uses its own `ritualCount` (or `dailyRitualCount` — naming at planner discretion) inside `runSweep`'s closure / shared state, independent of `accountability` and `reflective` counters and NOT split per-ritual-type.

- **Rationale:** Per-tick max-1-ritual cap (TS-11) is the rate-limit mechanism for *individual* rituals — it prevents storms (Pitfall 1). The channel-level daily counter is for the *channel* (rituals as a group), not for each ritual; per-ritual-type counters would over-fragment the rate model and create tracking noise that nobody consumes. The "independent daily counter from reflective/accountability" phrasing in research SUMMARY (TS-11) means *across channels*, not *across rituals within the channel*.
- **Why ceiling = 3:** RESEARCH.md Open Question 3 surfaced a real conflict — the existing accountability/reflective channels use a boolean `hasSentTodayX` cap (effectively 1/day), but M009's three rituals naturally produce up to **3 fires on a single calendar day**: morning wellbeing (09:00 Paris), evening voice note (21:00 Paris), and Sunday weekly review (20:00 Paris). A boolean cap would suppress two of them. A 3/day ceiling cleanly accommodates the worst case (Sunday: all three fire) without requiring per-ritual-type bookkeeping. Defense in depth against ritual storms (Pitfall 1) is preserved: per-tick max-1 cap + per-ritual cadence advancement (`next_run_at += 24h` after fire) + 3/day channel ceiling.
- **Concrete shape:** `runSweep()` already has `accountabilityCount` and `reflectiveCount` (or equivalent — planner verifies). Add `ritualCount` peer with ceiling 3. Use `hasReachedRitualDailyCap()` or equivalent helper following the same shape as `hasSentTodayReflective`/`hasSentTodayAccountability` in `src/proactive/state.ts` lines 102-148. Persist via the same `proactive_state` KV table — add a new key like `ritual_daily_count` keyed by local date so the counter resets at midnight Europe/Paris.
- **Rejected:** (a) NO daily channel cap. Rejected because the only safety net would be per-tick max-1 + per-ritual cadence, which is fine in steady-state but provides no defense against future bugs that double-advance `next_run_at` or skip the cadence helper. (b) Per-ritual-type counter (`voiceNoteCount`, `wellbeingCount`, etc.). Rejected because the per-tick max-1 cap inside the channel already serializes them. (c) Boolean `hasSentTodayRitual`. Rejected because it conflicts with the wellbeing+voice note same-day requirement.

### Test approach for cron registration (D-05)

**D-05:** **Both** approaches — `/health` endpoint reports `ritual_cron_registered: true` (operator-visible runtime check), AND a startup-side test asserts `cron.schedule` was invoked with the expected expression and timezone (deterministic unit test, no real cron firing).

- **Rationale:** `/health` covers the production-runtime case (operator can curl `/health` after `docker compose up` to confirm cron is alive without waiting until 21:00); the unit test covers the build-time regression case (someone refactors `src/index.ts` and breaks the registration call — caught in CI, not at the next 21:00 fire). HARD CO-LOCATION #4 (Pitfall 23) about fixture vs cron-registration tests being two distinct plans applies to **Phase 30** (live fixture run) — for Phase 25 substrate, both Phase-25 tests live in Plan 25-03.
- **Unit-test mechanism:** `vi.mock('node-cron', ...)` with a `cron.schedule` spy; import `src/index.ts` (or its `registerCrons()` extracted helper — see D-06), assert `expect(scheduleSpy).toHaveBeenCalledWith('0 21 * * *', expect.any(Function), { timezone: 'Europe/Paris' })`. Existing pattern: `src/proactive/__tests__/sweep.test.ts` and `src/episodic/__tests__/cron.test.ts` (planner verifies exact form).
- **`/health` mechanism:** Track registration outcome in a module-scoped `cronRegistrationStatus` map populated by `registerCrons()`; `/health` route reads it and includes `ritual_cron_registered: cronRegistrationStatus.ritual === 'registered'` in the JSON response. Existing `/health` already reports basic status — extends, not replaces.
- **Rejected:** `/health` only. Rejected because a refactor that drops the cron call also drops the registration-status update, making `/health` lie. The unit test is the trustworthy gate; `/health` is the operator-facing convenience.

### Cron registration extraction from src/index.ts (D-06)

**D-06:** **Extract a `registerCrons(deps)` helper** in `src/index.ts` (or a new `src/cron-registration.ts`) so all three cron registrations (sync 6h, proactive 10:00 + ritual 21:00, episodic 23:00) live behind one testable function call.

- **Rationale:** Today the cron registrations are inline in `main()` — each new registration adds another inline block + `logger.info` line. With three registrations becoming four, extracting a helper makes the unit test from D-05 trivial (test the helper in isolation, no need to fully boot `src/index.ts`) and centralizes the "what crons run on this server" answer. Mirrors how `src/proactive/sweep.ts` extracted `runSweep` from inline.
- **Signature:** `function registerCrons(deps: { config: typeof config, runSweep: () => Promise<void>, runRitualSweep: () => Promise<void>, runConsolidateYesterday: () => Promise<void>, runSync: () => Promise<void> }): CronRegistrationStatus`. Returns the status map for `/health` to consume (D-05).
- **Rejected:** Keep inline + spy `cron.schedule` directly. Rejected because importing `src/index.ts` to spy means importing the entire bot + Express + Drizzle init chain — slow, brittle, and a bunch of setup that doesn't matter for the test.

### `runRitualSweep()` invocability for manual operator testing (D-07)

**D-07:** **`scripts/manual-sweep.ts`** (NEW thin wrapper) imports `runRitualSweep()` from `src/rituals/scheduler.js` and runs it once against the live DB connection, prints any fired rows as JSON, exits 0. Lives next to `scripts/regen-snapshots.sh`, `scripts/backfill-episodic.ts`, etc. (existing convention).

- **Rationale:** Success criterion 3 in ROADMAP.md says `runRitualSweep()` must be invocable via `npx tsx scripts/manual-sweep.ts` (or REPL) — script form is cleaner for CI parity and matches the existing `scripts/*.ts` convention. REPL-only would mean operators have to remember the import path.
- **Behavior:** Hard-fails on missing DB connection (no fallback). Logs each fired ritual + outcome. Exits 0 if no rituals fired (clean DB → `[]` per success criterion 3). No try/finally cleanup (matches `backfill-episodic.ts` pattern noted in STATE.md as "safe as-is").
- **Rejected:** REPL-only via `node --experimental-repl-await`. Rejected per the existing scripts convention.

### `computeNextRunAt` signature (D-09 — ADDED 2026-04-26 post-checker PC-25-03)

**D-09:** **`computeNextRunAt(now: Date, cadence: RitualCadence, config: RitualConfig): Date`** — accept the 3-argument signature deviation from D-02's earlier 2-arg shape. `cadence` is sourced from `rituals.type` (the enum column), NOT from `RitualConfig` (the jsonb column).

- **Rationale:** D-02 originally specified `computeNextRunAt(now, config)`, mirroring RESEARCH.md §4 Example 2's pseudocode. While drafting Plan 25-02, the planner correctly observed that `RitualConfigSchema` (D-02 + RIT-07) deliberately omits a `cadence` field — `rituals.type` is the source of truth for cadence, while `rituals.config` jsonb holds tunables (`fire_at`, `fire_dow`, `prompt_bag`, `skip_threshold`, `mute_until`, `time_zone`, `prompt_set_version`, `schema_version`). Folding `cadence` into `RitualConfigSchema` to preserve the 2-arg signature would denormalize a column that already lives elsewhere and force every downstream caller to keep both in sync.
- **Tradeoff accepted:** A 3-arg signature is slightly less ergonomic at call sites, but every call site already has `ritual.type` in scope (the row was just fetched). The clean type/config separation outweighs the call-site cost.
- **Effect on Plan 25-02 + 25-03:** Both plans use `computeNextRunAt(now, cadence, config)`. RESEARCH.md §4 should be read as illustrative pseudocode whose `config.cadence` lookup is provided by the caller via the explicit `cadence` argument.
- **Rejected:** Adding `cadence` to `RitualConfigSchema`. Rejected per the schema-vs-column rationale above.

### Migration meta-snapshot regeneration approach (D-08)

**D-08:** Use **`scripts/regen-snapshots.sh` clean-slate iterative replay** (TECH-DEBT-19-01 + Phase 19 v2.1 pattern), NOT `npx drizzle-kit generate --custom` against an unstable journal.

- **Rationale:** Drizzle's `meta/_journal.json` lineage breaks when migrations are added out-of-order or when a manual SQL migration (like the `RITUAL_RESPONSE` enum extension) is mixed with auto-generated SQL. The clean-slate replay (drop containers → run all migrations 0001..0006 in order → snapshot) is what landed in v2.1 Phase 19 to fix TECH-DEBT-19-01 and was used again in v2.2 + v2.3.
- **Concrete steps in Plan 25-01:** (1) Author `0006_rituals_wellbeing.sql` by hand (mixed CREATE TABLE / ALTER TYPE / CREATE INDEX). (2) Run `scripts/regen-snapshots.sh` against a clean Docker Postgres on port 5434 (precedent). (3) Inspect the regenerated `0000_*.sql..0006_*.sql` snapshots match expected. (4) Update `src/db/schema.ts` to declare the new tables in Drizzle TypeScript form (so subsequent `drizzle-kit generate` against schema.ts produces a CLEAN diff per ROADMAP.md success criterion 1). (5) Add the new psql line to `scripts/test.sh` that confirms tables / enum value / 3 indexes are present after migration.
- **Rejected:** Auto-generate `0006_*.sql` from `schema.ts` via `drizzle-kit generate`. Rejected because `ALTER TYPE epistemic_tag ADD VALUE 'RITUAL_RESPONSE'` is not auto-generatable from schema.ts in Drizzle 0.45 (enum extensions are a known weak point); hand-authored SQL + clean-slate replay is the established escape hatch.

### Claude's Discretion

- **Naming details** — exact file names within `src/rituals/` (`types.ts` vs `schema.ts`, `idempotency.ts` vs co-locating in `scheduler.ts`), exact env-var name capitalization, exact log-event names (`rituals.cron.scheduled` vs `ritual.cron.registered`), exact test file locations (`src/rituals/__tests__/cadence.test.ts` is the obvious choice). Planner picks per existing project conventions in `.planning/codebase/CONVENTIONS.md`.
- **`scripts/manual-sweep.ts` JSON output schema** — pretty-printed array of fired rows; planner picks reasonable shape based on what `runRitualSweep()` returns.
- **Test data approach** — existing primed-fixture pipeline (D041, v2.3 Phase 24) is available; planner picks whether Plan 25-01's migration tests need primed fixtures or run against clean Docker Postgres only (success criterion 1 reads "clean Docker Postgres", so probably the latter).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research (the bedrock for Phase 25)
- `.planning/research/SUMMARY.md` — Executive summary, recommended stack (no new deps), expected features, architecture, top 5 pitfalls, all 7 HARD CO-LOCATION constraints, resolved disagreements (esp. #1 ritual-channel-vs-trigger and #2 phase count). **Read first.**
- `.planning/research/STACK.md` — Per-package version-bump assessment; confirms zero version bumps for M009.
- `.planning/research/ARCHITECTURE.md` — Module shape for `src/rituals/` subsystem; integration points with `runSweep`, `processMessage`, `src/index.ts`.
- `.planning/research/PITFALLS.md` — Full taxonomy of 29 pitfalls; Phase 25 specifically defends against Pitfalls 1, 2, 3, 28.
- `.planning/research/FEATURES.md` — TS-9..TS-16 + TS-17..TS-19 are the Phase 25 / 30 carry-in scope.

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 25 — Goal, requirements list, HARD CO-LOCATION #7, 4 success criteria. **Authoritative scope.**
- `.planning/REQUIREMENTS.md` — RIT-01..12 verbatim; PROC-01/02 verbatim (to be marked upstream-shipped per D-01 before planning).
- `.planning/STATE.md` — Current position, accumulated context, **PROC-01/PROC-02 verdict block in Open Items (2026-04-26)**, decisions in force from prior milestones.

### Project plan + decisions
- `PLAN.md` — Project Chris implementation plan; Key Decisions table (D004 append-only Pensieve, D034 episodic_summaries 8 columns + 3 indexes locked, D041 primed-fixture pipeline supersedes calendar-time waits, D026 wellbeing separate from voice note).

### Codebase intel (subset relevant to Phase 25)
- `.planning/codebase/ARCHITECTURE.md` — Layered monolith overview; "Idempotent cron jobs" subsection; cron registration peer pattern in `src/index.ts`.
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict ESM, `.js` suffix imports, 2-space, no path aliases, kebab-case files; SCREAMING_SNAKE_CASE constants; box-drawing section dividers for modules >100 lines.
- `.planning/codebase/STACK.md` — Existing Drizzle 0.45.2 + drizzle-kit 0.31.10 patterns; node-cron 4.2.1; Luxon 3.7.2.
- `.planning/codebase/TESTING.md` — Existing vitest patterns; primed-fixture pipeline §; `scripts/test.sh` Docker postgres harness; **vitest-4 fork-IPC hang under HuggingFace EACCES env-level issue noted in STATE.md** (M009's new `src/rituals/__tests__/` suites must not trigger).

### Source files Phase 25 reads or modifies (full paths)
- `src/index.ts` — Cron registration site (existing 10:00 sweep + 23:00 episodic; Phase 25 adds 21:00 ritual peer); `/health` endpoint owner.
- `src/config.ts` — Env var pattern (`proactiveSweepCron: process.env.PROACTIVE_SWEEP_CRON || '0 10 * * *'`); Phase 25 adds `ritualSweepCron` + `cron.validate` short-circuit.
- `src/db/schema.ts` — Drizzle table definitions; pgEnum + jsonb + smallint + .check() patterns; epistemicTagEnum (Phase 25 extends with `RITUAL_RESPONSE`).
- `src/db/migrations/` — 0001..0005 hand-audited SQL; Phase 25 adds 0006 + meta-snapshot.
- `src/proactive/sweep.ts` — `runSweep` orchestrator with accountability + reflective channels; Phase 25 inserts ritual channel between them.
- `src/episodic/sources.ts` — Canonical `dayBoundaryUtc` Luxon pattern + `setZone(tz)`; cadence.ts mirrors this.
- `src/episodic/consolidate.ts:33-81` — v3/v4 Zod dual-schema pattern at SDK boundary; RitualConfig schema follows the v3 pattern (no SDK boundary needed for Phase 25 itself).
- `scripts/regen-snapshots.sh` — Clean-slate iterative replay for migration meta-snapshot regeneration (TECH-DEBT-19-01 fix pattern); Phase 25 invokes for 0006.
- `scripts/test.sh` — Docker postgres harness; Phase 25 adds psql line confirming new tables / enum value / 3 indexes.

### Upstream tooling refs (for D-01 verdict — NOT consumed by planner, evidence only)
- `~/.claude/get-shit-done/workflows/execute-phase.md:1338-1376` — `verify_phase_goal` step that wires `gsd-verifier` and reads VERIFICATION.md from disk.
- `~/.claude/get-shit-done/templates/summary.md:41` — `requirements-completed` frontmatter REQUIRED.
- `~/.claude/get-shit-done/workflows/execute-plan.md:336` — Executor copies `requirements` from PLAN.md verbatim.
- `~/.claude/get-shit-done/bin/lib/commands.cjs:463` — SDK parses `fm['requirements-completed']`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/episodic/sources.ts` `dayBoundaryUtc` Luxon pattern** — `cadence.ts` inherits the exact same DST-safe approach: `DateTime.fromJSDate(now).setZone(config.time_zone).startOf('day').plus({ days: N }).toUTC().toJSDate()`. Don't reinvent.
- **`src/proactive/sweep.ts` channel-orchestration shape** — accountability + reflective are the existing two channels with their per-channel daily counters and shared global mute (`isMuted()`). Ritual channel extends this pattern as a peer; reuse the daily-counter and mute-gate plumbing.
- **`src/index.ts` cron registration block** — three peer `cron.schedule(expr, handler, { timezone })` registrations + matching `logger.info` lines. Phase 25 D-06 extracts these into `registerCrons(deps)` rather than just appending a fourth inline block.
- **`src/db/schema.ts` Drizzle declarative pattern** — `pgEnum`, `jsonb`, `smallint`, `.check()`, `timestamp({ withTimezone: true })`, partial indexes via `index().on(...).where(...)`. All M009 tables follow these existing forms.
- **`scripts/regen-snapshots.sh` clean-slate replay** — already proven in v2.1 Phase 19 + v2.2 + v2.3. Plan 25-01 invokes it verbatim.
- **v2.3 D-05 wellbeing-snapshots feature-detection** — `scripts/synthesize-delta.ts` already feature-detects `wellbeing_snapshots` via `SELECT to_regclass('public.wellbeing_snapshots') IS NOT NULL`. Once Phase 25 ships the table, that script's wellbeing branch activates with no code change.
- **v2.3 D041 primed-fixture pipeline** — `tests/fixtures/primed/` + `loadPrimedFixture()` available; supersedes calendar-time waits. Phase 25 itself probably doesn't need primed fixtures (substrate, no real-data behaviors), but Phases 26-29 will.

### Established Patterns
- **`.js` suffix on every internal import** — non-negotiable; Drizzle/Luxon/Zod stay bare.
- **SCREAMING_SNAKE_CASE for tunables** — `RESPONSE_WINDOW_HOURS`, `PROMPT_SET_VERSION`, `MAX_DAILY_RITUALS`, etc. Lives at top of the module that owns the constant.
- **Box-drawing section dividers for modules >100 lines** — `src/rituals/scheduler.ts` and `src/rituals/cadence.ts` likely cross 100 lines; mirror the `// ── Section ─────` form from `src/episodic/sources.ts`.
- **Test files co-located** in `__tests__/<module>.test.ts` next to the source.
- **Migration files hand-audited SQL**, not auto-generated. ALTER TYPE enum extensions explicitly hand-written.
- **Idempotency via atomic `UPDATE … RETURNING *` with conditional WHERE** — M007 D-28 precedent (decision lifecycle transitions). Same shape works for ritual fire.
- **Config preconditions throw at module load** — pattern from `src/config.ts` existing logic; cron.validate fits cleanly here (D-03).

### Integration Points
- **`src/index.ts` `main()`** — Phase 25 D-06 extracts cron registrations into `registerCrons(deps)` which `main()` calls; the helper also produces the registration-status map that `/health` reads.
- **`src/proactive/sweep.ts` `runSweep()`** — Phase 25 inserts the ritual channel between accountability and reflective. Order matters: accountability (deadline-driven) is highest priority, ritual (cadence-driven) is middle, reflective (open-ended) is lowest.
- **`src/db/schema.ts` `epistemicTagEnum`** — Phase 25 appends `'RITUAL_RESPONSE'` as 14th value; downstream `pensieve_entries` consumers (PP#5 in Phase 26) read it via `eq(pensieveEntries.epistemic_tag, 'RITUAL_RESPONSE')`.
- **`src/config.ts`** — Phase 25 adds `ritualSweepCron` env var + `cron.validate` short-circuit.
- **No engine integration in Phase 25** — PP#5 lives in Phase 26 (HARD CO-LOCATION #1). Phase 25 only ships the SUBSTRATE the detector will read against (`ritual_pending_responses` table).

</code_context>

<specifics>
## Specific Ideas

- **Migration file name:** `0006_rituals_wellbeing.sql` (per research SUMMARY); planner confirms via existing 0001..0005 naming.
- **`RITUAL_RESPONSE` enum value name:** Exactly `'RITUAL_RESPONSE'` (uppercase per existing 13 values pattern in `epistemic_tag` enum).
- **Cadence enum support from day one:** All 4 cadences (daily / weekly / monthly / quarterly) — TS-10 forward-compat for M013 monthly/quarterly rituals. `computeNextRunAt` handles all 4 even though Phase 25 itself ships no monthly/quarterly rituals.
- **`scripts/test.sh` psql line shape:** Confirms presence of all 6 new tables + the `RITUAL_RESPONSE` enum value + the 3 indexes via a single `psql -c "SELECT ..."` invocation. Planner writes the exact SQL based on success criterion 1's expected outputs.
- **DST property test pinning dates:** `2026-03-29` (spring forward) + `2026-10-25` (fall back) — both Europe/Paris transitions. Tests assert `computeNextRunAt(beforeTransition, dailyConfig)` produces a result that's exactly 24 wall-clock hours later, not 23 or 25.
- **Cron expression `0 21 * * *`:** Standard 5-field POSIX cron; node-cron supports it. Default; configurable via `RITUAL_SWEEP_CRON` env var.

</specifics>

<deferred>
## Deferred Ideas

- **Per-ritual-type daily counters** — considered in D-04 and rejected. If real-use shows a per-tick max-1 cap is insufficient, revisit in v2.5.
- **Hourly cron sweep** (Disagreement #1 alternative) — more granular firing for non-09:00/21:00 fire times. Defer until a future ritual genuinely needs a third cron tick.
- **Cron expression parsing for Greg-friendly config UI** (e.g. natural-language "every weekday at 9pm" → cron) — deferred indefinitely; OOS-9 (Anti-feature: Cron-expression-based ritual config opaque to Greg) explicitly rules this out at the ritual-config level. Greg edits cron via env var only.
- **Wellbeing trajectory as 3rd weekly-observation source** (DIFF-2) — defer to v2.5 per research SUMMARY.
- **Generic `nextRunAt` scheduler primitive abstracted from rituals** (DIFF-6) — research recommends shipping in M009; Phase 25's `cadence.ts` IS the primitive, so this is satisfied implicitly. No defer needed.
- **Server-side Whisper transcription** (OOS-3) — explicitly anti-feature per PLAN.md `## Out of Scope`.

</deferred>

---

*Phase: 25-Ritual Scheduling Foundation + Process Gate*
*Context gathered: 2026-04-26*
