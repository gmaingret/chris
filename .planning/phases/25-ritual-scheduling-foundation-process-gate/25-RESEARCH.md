# Phase 25: Ritual Scheduling Foundation — Research

**Researched:** 2026-04-26
**Domain:** Cadence-driven ritual substrate (migration 0006 + Luxon cadence helper + Zod-validated config + atomic SQL idempotency + cron registration with safe defaults + ritual channel slot in proactive sweep)
**Confidence:** HIGH — every recommendation either grounded in existing v2.0–v2.3 code (verified by direct file inspection) or in the milestone-level research synthesis already validated during M009 kickoff.
**Mode:** `--auto` follow-up to `/gsd-discuss-phase --auto` (CONTEXT.md decisions D-01..D-08 are LOCKED)

---

## Summary

Phase 25 ships the **non-negotiable substrate** for v2.4 M009. Three plans across 12 requirements, no new dependencies, zero version bumps. The atomic plan (HARD CO-LOCATION #7) lands migration 0006 + drizzle meta-snapshot + `scripts/test.sh` psql line — splitting these reproduces TECH-DEBT-19-01. The pure-helpers plan delivers `RitualConfig` Zod schema, `computeNextRunAt` Luxon cadence math (DST-safe across 2026-03-29 + 2026-10-25), and the atomic `UPDATE rituals … RETURNING *` idempotency helper. The process-boundaries plan delivers `runRitualSweep`, ritual channel insertion in `runSweep`, second 21:00 cron tick, `RITUAL_SWEEP_CRON` env var with `cron.validate` fail-fast, `/health` reporting `ritual_cron_registered`, `scripts/manual-sweep.ts` operator wrapper, and the `registerCrons(deps)` helper extracted from `src/index.ts` (D-06).

**Primary recommendation:** Plan 25-01 must include the `scripts/regen-snapshots.sh` UPDATE (existing script is hardcoded for 0001-0004 — adding 0006 requires extending the iterative-replay loop) AND the `scripts/test.sh` psql line addition AND the meta-snapshot regeneration AND the migration SQL itself in ONE atomic plan. Plan 25-02 ships pure functions with no DB or LLM calls (testable in microseconds). Plan 25-03 wires `runRitualSweep` into the existing dual-channel sweep as a third channel between accountability and reflective, registers the second cron, and exposes `/health` status.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** PROC-01 and PROC-02 dropped from Phase 25 scope. Both verified REDUNDANT post-GSD 1.38.4/1.38.5 (verdict block in `STATE.md` Open Items, 2026-04-26). Greg edits REQUIREMENTS.md / ROADMAP.md to mark `[x] (upstream: GSD 1.38.4/1.38.5)` and update counts (54→52, Phase 25 14→12) before planner runs. Phase 25 active scope: 12 requirements / 3 plans.

**D-02:** **3 plans** for Phase 25:
- **Plan 25-01 (Migration substrate, atomic):** Migration `0006_rituals_wellbeing.sql` + drizzle meta-snapshot regenerated via `scripts/regen-snapshots.sh` + `scripts/test.sh` psql line. Tables: `rituals`, `wellbeing_snapshots`, `ritual_responses`, `ritual_fire_events`, `ritual_config_events`, `ritual_pending_responses`. Enum: `RITUAL_RESPONSE` (14th). Indexes: partial `btree(next_run_at) WHERE enabled = true`, `btree(snapshot_date)`, `(ritual_id, fired_at DESC)` on `ritual_responses`. Drizzle schema additions in `src/db/schema.ts`. **Requirements: RIT-01, RIT-02, RIT-03, RIT-04, RIT-05, RIT-06.** **HARD CO-LOCATION #7 enforced.**
- **Plan 25-02 (Pure-function helpers):** `src/rituals/types.ts` (`RitualConfigSchema` Zod, 8 fields + `schema_version`); `src/rituals/cadence.ts` (`computeNextRunAt` for daily/weekly/monthly/quarterly via Luxon); atomic `UPDATE rituals … RETURNING *` helper (in `src/rituals/idempotency.ts` or co-located in `scheduler.ts` — Claude's discretion). DST property tests pinned at 2026-03-29 + 2026-10-25. **Requirements: RIT-07, RIT-08, RIT-10.**
- **Plan 25-03 (Process boundaries):** `src/rituals/scheduler.ts` exporting `runRitualSweep(now, deps)`; integration into `src/proactive/sweep.ts` as third channel between accountability and reflective; second `cron.schedule()` registration in `src/index.ts` at 21:00 Europe/Paris; `ritualSweepCron` env var with safe default `0 21 * * *` in `src/config.ts`; `cron.validate` short-circuit at config load; `/health` reports `ritual_cron_registered: true`. **Requirements: RIT-09, RIT-11, RIT-12.**

**D-03:** **Cron validation fail-fast at config load.** `cron.validate(config.ritualSweepCron)` runs in `src/config.ts` immediately after `process.env.RITUAL_SWEEP_CRON` is read; on `false`, throw a startup error with the offending expression in the message. Container fails its `/health` check and Docker Compose restart-loops until env is fixed. Test: `RITUAL_SWEEP_CRON=garbage` → assert `import('../config.js')` rejects with `/invalid RITUAL_SWEEP_CRON/`.

**D-04:** **One independent counter for the ritual channel as a whole, shared across all rituals.** Per-tick max-1-ritual cap (TS-11) is the rate-limit mechanism for individual rituals. The channel-level daily counter is for the *channel* (rituals as a group), not per-ritual-type. Channel caps at 1/tick per TS-11; daily ceiling matches existing accountability/reflective pattern (planner verifies exact value).

**D-05:** **Both** approaches for cron registration testing — `/health` endpoint reports `ritual_cron_registered: true` (operator-visible runtime check), AND a startup-side test asserts `cron.schedule` was invoked with the expected expression and timezone (deterministic unit test, no real cron firing). Unit-test mechanism: `vi.mock('node-cron', ...)` with a `cron.schedule` spy; import `registerCrons()` (D-06 extracted helper), assert `expect(scheduleSpy).toHaveBeenCalledWith('0 21 * * *', expect.any(Function), { timezone: 'Europe/Paris' })`.

**D-06:** **Extract `registerCrons(deps)` helper** in `src/index.ts` (or new `src/cron-registration.ts` — Claude's discretion). All three (now four with ritual) cron registrations live behind one testable function call. Signature: `function registerCrons(deps: { config, runSweep, runRitualSweep, runConsolidateYesterday, runSync }): CronRegistrationStatus`. Returns the status map for `/health` to consume.

**D-07:** **`scripts/manual-sweep.ts`** (NEW thin wrapper) imports `runRitualSweep()` from `src/rituals/scheduler.js` and runs once against live DB. Logs each fired ritual + outcome. Exits 0 if no rituals fired. Hard-fails on missing DB connection. Matches `backfill-episodic.ts` pattern (no try/finally cleanup — safe per STATE.md note).

**D-08:** Use **`scripts/regen-snapshots.sh` clean-slate iterative replay**, NOT `npx drizzle-kit generate --custom`. Concrete steps in Plan 25-01:
1. Hand-author `0006_rituals_wellbeing.sql` (mixed CREATE TABLE / ALTER TYPE / CREATE INDEX)
2. Run `scripts/regen-snapshots.sh` against clean Docker Postgres on port 5434 (precedent)
3. Inspect regenerated `0000_*.sql..0006_*.sql` snapshots match expected
4. Update `src/db/schema.ts` with new tables in Drizzle TypeScript form so subsequent `drizzle-kit generate` against schema.ts produces a CLEAN diff
5. Add new psql line to `scripts/test.sh` confirming tables / enum value / 3 indexes after migration

### Claude's Discretion

- Naming details inside `src/rituals/` (`types.ts` vs `schema.ts`, `idempotency.ts` vs co-location in `scheduler.ts`)
- Exact env-var name capitalization (recommendation: `RITUAL_SWEEP_CRON` — matches existing `PROACTIVE_SWEEP_CRON` / `EPISODIC_CRON` pattern)
- Exact log-event names (recommendation: `rituals.cron.scheduled`, `rituals.sweep.start`, `rituals.fire.atomic`, `rituals.fire.success`, `rituals.fire.race_lost`, `rituals.config.invalid`)
- Exact test file locations (recommendation: `src/rituals/__tests__/cadence.test.ts`, `src/rituals/__tests__/idempotency.test.ts`, `src/rituals/__tests__/scheduler.test.ts`, `src/rituals/__tests__/cron-registration.test.ts`)
- Channel cap value for `ritualCount` daily ceiling — planner reads `src/proactive/sweep.ts` to find existing channel caps and matches (existing pattern: `hasSentTodayReflective` / `hasSentTodayAccountability` use a single send-per-day boolean projection, NOT a numeric ceiling — research recommends ritual channel mirror this with `hasSentTodayRitual` boolean)
- `scripts/manual-sweep.ts` JSON output schema — planner picks reasonable shape based on what `runRitualSweep()` returns (research recommends pretty-printed array of `{ ritualId, type, fired_at, outcome }` rows)
- Test data approach — Plan 25-01 migration tests run against clean Docker Postgres only (success criterion 1 reads "clean Docker Postgres"); no primed fixtures needed for substrate

### Deferred Ideas (OUT OF SCOPE)

- Per-ritual-type daily counters (revisit v2.5 if per-tick cap insufficient)
- Hourly cron sweep (Disagreement #1 alternative — defer until a future ritual genuinely needs a third cron tick)
- Cron-expression-based ritual config UI (OOS-9 explicit anti-feature)
- Wellbeing trajectory as 3rd weekly-observation source (DIFF-2, defer v2.5)
- Generic `nextRunAt` scheduler primitive abstracted from rituals (DIFF-6 — Phase 25's `cadence.ts` IS the primitive, satisfied implicitly)
- Server-side Whisper transcription (OOS-3, anti-feature)

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RIT-01 | Migration 0006 ships `rituals` table — id, name (UNIQUE), type (cadence enum), last_run_at (nullable), next_run_at (NOT NULL), enabled (default true), config (jsonb default '{}'), skip_count (default 0), created_at | §1 (Migration 0006 SQL specifics) — exact CREATE TABLE statement with all 9 columns + UNIQUE(name) + DEFAULT clauses |
| RIT-02 | Migration 0006 ships `wellbeing_snapshots` table — id, snapshot_date (UNIQUE), energy/mood/anxiety smallint CHECK 1-5, notes nullable, created_at | §1 — exact CREATE TABLE with smallint CHECK constraints, mirrors `episodic_summaries` UNIQUE pattern (D034) |
| RIT-03 | Migration 0006 ships supporting tables — `ritual_responses`, `ritual_fire_events`, `ritual_config_events`, `ritual_pending_responses` (D004 append-only) | §1 — minimal append-only schemas; `ritual_responses` is the only one Phase 25 substrate REALLY shapes (others get skeleton tables for Phase 26-29 to populate) |
| RIT-04 | Migration 0006 adds `RITUAL_RESPONSE` to `epistemic_tag` enum (14th value) | §1 — `ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'RITUAL_RESPONSE';` mirrors migration 0003 EXACT shape |
| RIT-05 | Migration 0006 ships all indexes from day one (D034) — partial `btree(next_run_at) WHERE enabled = true`; `btree(snapshot_date)`; `(ritual_id, fired_at DESC)` on `ritual_responses` | §1 — verified Drizzle 0.45.2 supports `.where(SQL)` partial indexes via `IndexBuilder.where(condition: SQL): this` (node_modules/drizzle-orm/pg-core/indexes.d.ts:67) |
| RIT-06 | Migration 0006 lineage cleaned via `scripts/regen-snapshots.sh` (TECH-DEBT-19-01 pattern); `scripts/test.sh` extended | §2 (regen-snapshots.sh contract) + §3 (test.sh psql line) — script must be UPDATED to extend its hardcoded 0001-0004 loop to handle 0005 + 0006 |
| RIT-07 | `RitualConfig` Zod schema (8 named fields + `schema_version`) at every read boundary; rejects unknown fields | §5 — exact Zod schema with `.strict()` for unknown-field rejection; mirrors `src/episodic/types.ts` v3 pattern (NOT the v3/v4 dual pattern — no SDK boundary in Phase 25) |
| RIT-08 | `src/rituals/cadence.ts` exports `computeNextRunAt(now, config)` using Luxon; DST-safe across 2026-03-29 + 2026-10-25 | §4 — pseudocode for all 4 cadences; mirrors `dayBoundaryUtc` pattern from `src/episodic/sources.ts:74-83`; test fixtures pinned to both DST instants |
| RIT-09 | Ritual firing as third channel inside `runSweep` between accountability and reflective; per-tick max-1-ritual cap; catch-up ceiling; window-bound firing; shares global mute (`isMuted()`); independent daily counter | §7 — exact insertion point in `src/proactive/sweep.ts` after escalation loop (line 336) and before reflective channel (line 340); shares `isMuted()` (state.ts:90); new `hasSentTodayRitual` peer to existing accountability/reflective KV booleans |
| RIT-10 | Atomic `UPDATE rituals SET last_run_at=now(), next_run_at=$NEW WHERE id=$ID AND (last_run_at IS NULL OR last_run_at < $LAST_OBSERVED) RETURNING *` (write-before-send mirrors M007 D-28) | §6 — exact SQL via `db.execute(sql\`...\`)` raw or Drizzle query builder; concurrency test simulates two `Promise.all([runRitualSweep(), runRitualSweep()])` invocations producing exactly 1 returned row |
| RIT-11 | Second cron tick at 21:00 Europe/Paris registered in `src/index.ts` (peer to existing 10:00 sweep + 23:00 episodic) | §8 — exact cron registration shape mirrors existing `cron.schedule(config.proactiveSweepCron, ...)` block at `src/index.ts:73-80` |
| RIT-12 | `src/config.ts` exports `ritualSweepCron` env var with safe default `0 21 * * *`; `cron.validate` short-circuits on invalid expression at config load; `/health` endpoint reports `ritual_cron_registered` | §9 — exact `src/config.ts` change with `import { validate } from 'node-cron'` + throw on `false`; `/health` change in `src/index.ts:17-57` adds `ritual_cron_registered` field; node-cron's `validate(expression: string): boolean` API confirmed at node_modules/node-cron/dist/esm/node-cron.d.ts:5 |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Migration 0006 SQL (tables + enum + indexes) | Database / Storage | — | Schema lives in Postgres; Drizzle schema.ts is the TypeScript mirror but DB owns the truth |
| Drizzle schema additions in `src/db/schema.ts` | API / Backend | Database | Type bridge between TS code and PG; lives in the data layer per ARCHITECTURE.md "Data layer" |
| `src/rituals/cadence.ts` (`computeNextRunAt`) | API / Backend (pure function) | — | Pure-function helper; no I/O; testable in microseconds |
| `RitualConfig` Zod schema | API / Backend (validation) | — | Validation boundary; per CONVENTIONS.md "Zod for external boundaries" |
| Atomic `UPDATE rituals … RETURNING *` | Database / Storage | API / Backend | Concurrency-safety lives in SQL (the `WHERE last_run_at IS NULL OR last_run_at < $LAST_OBSERVED` predicate is the lock); helper module wraps it |
| `runRitualSweep` orchestrator | API / Backend (Process / Cron) | Database | Lives in `src/rituals/scheduler.ts`; called by cron and ritual channel inside `runSweep`; cron-context tier |
| Ritual channel slot in `runSweep` | API / Backend (Process / Cron) | — | Edits existing `src/proactive/sweep.ts`; same tier as accountability + reflective channels |
| Second cron registration (21:00) | Process / Boot | — | `src/index.ts` boot tier; peer to existing proactive (10:00) + episodic (23:00) cron registrations |
| `cron.validate` short-circuit | Process / Boot (config load) | — | `src/config.ts` import-time check; throws BEFORE any DB connection |
| `/health` ritual_cron_registered field | API / HTTP | Process / Boot | `src/index.ts:createApp` route reads `cronRegistrationStatus` map populated by `registerCrons(deps)` |
| `scripts/manual-sweep.ts` operator wrapper | CLI / Scripts | API / Backend | Operator tier; standalone invocation pattern matches existing `scripts/backfill-episodic.ts` |
| `registerCrons(deps)` helper extraction | Process / Boot | — | New file or in-place extraction inside `src/index.ts`; testability win per D-06 |

**Tier-correctness sanity check:** No capability assigned to wrong tier. Migration SQL, schema.ts type bridge, and pure cadence math each occupy distinct correct tiers. The orchestrator + channel insertion + cron registration form the cron/process triad. The `/health` HTTP route reads but does not own the cron registration state — it pulls from the boot-tier status map.

---

## Standard Stack

### Core (already installed — zero version bumps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | ^0.45.2 | PostgreSQL data layer; `pgEnum`, `jsonb`, `smallint`, `.check()`, `timestamp({ withTimezone: true })`, `.where(SQL)` partial indexes | Already used across 21 existing tables in `src/db/schema.ts`; M009 pattern is identical |
| `drizzle-kit` | ^0.31.10 | Migration meta-snapshot generation; introspect-based regen via `scripts/regen-snapshots.sh` | TECH-DEBT-19-01 fix pattern uses 0.31 introspect; no surface change for 0006 |
| `node-cron` | ^4.2.1 | Cron scheduling (`cron.schedule`) + expression validation (`cron.validate`) | Already used in `src/index.ts` 10:00 + 23:00 ticks; v4 has stable `validate(expr): boolean` surface (verified at node_modules/node-cron/dist/esm/node-cron.d.ts:5) |
| `luxon` | ^3.7.2 | DST-safe wall-clock cadence advancement (`DateTime.plus({ days/weeks/months })` + `setZone(tz)`) | Canonical pattern in `src/episodic/sources.ts` `dayBoundaryUtc` (lines 74-83); M008 + M007 + M004 all use it |
| `zod` | ^3.24.0 | `RitualConfig` schema with `.strict()` for unknown-field rejection | v3 is the source-of-truth schema layer; v3/v4 dual pattern from `src/episodic/consolidate.ts:33-81` only needed at SDK boundary (NOT applicable in Phase 25 — no LLM calls) |

### Supporting (existing, used as-is)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | ^0.90.0 | NOT used in Phase 25 — first ritual handler that calls Sonnet ships in Phase 29 (weekly review) | Not in Phase 25 scope |
| `grammy` | ^1.31.0 | NOT used in Phase 25 — first inline keyboard ships in Phase 27 (wellbeing snapshot) | Not in Phase 25 scope |
| `pino` (logger) | (internal) | Structured logging via `src/utils/logger.ts` singleton | Every Phase 25 module: `logger.info({ ritualId, type }, 'rituals.fire.success')` |
| `postgres` | ^3.4.5 | Low-level PG driver via `src/db/connection.ts` `sql` template tag | Used for raw `db.execute(sql\`...\`)` in atomic UPDATE; verified via existing `src/db/connection.ts` exports |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node-cron` `cron.validate` at config load | Manual regex parse | Reinvents the wheel; node-cron already exposes the function — use it [VERIFIED: node_modules/node-cron/dist/esm/node-cron.d.ts:5] |
| Luxon for cadence math | `date-fns` / `dayjs` | Project standardized on Luxon (CONVENTIONS.md §Timezone Handling line 184) — adding a second date library splits the convention |
| Zod `.strict()` for unknown-field rejection | Manual JSON.parse + key validation | Zod already used for every external boundary; `.strict()` is one line; consistent with existing v3 patterns in `src/episodic/types.ts` |
| Atomic UPDATE...RETURNING in pure SQL | Drizzle query builder | Drizzle 0.45 query builder DOES support `.update().set().where().returning()` — choice between raw `sql\`\`` template and builder is style-only; recommend builder for type safety, mirrors `transitionDecision()` pattern (M007 D-28) |
| `scripts/manual-sweep.ts` thin wrapper | REPL-only via `node --experimental-repl-await` | Operators have to remember import path; script is cleaner for CI parity (matches existing `scripts/backfill-episodic.ts`, `scripts/adversarial-test.ts` convention) |

**Installation:** None. Zero `package.json` diffs in Phase 25.

**Version verification (from package.json + npm registry, 2026-04-26):**
- `@anthropic-ai/sdk@0.90.x` installed; latest 0.91.1 — no bump required (only used in Phase 29)
- `drizzle-orm@0.45.2` installed; current — no bump required
- `drizzle-kit@0.31.10` installed; current — no bump required
- `node-cron@4.2.1` installed (exact match to latest) — no bump required
- `luxon@3.7.2` installed (exact match to latest) — no bump required
- `zod@3.24.0` installed; latest 4.x — intentional v3/v4 dual-schema pattern preserved per CONVENTIONS.md

[VERIFIED: package.json grep at /home/claude/chris/package.json]

---

## Architecture Patterns

### System Architecture Diagram

Phase 25 substrate flow (focuses on data/control through the new substrate; existing Pensieve/engine paths unchanged):

```
                          ┌─────────────────────────┐
                          │   src/config.ts (boot)  │
                          │   import-time:           │
                          │   cron.validate(expr)    │
                          │   ─ throw if invalid ─   │
                          └────────────┬─────────────┘
                                       │ (passes config)
                                       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   src/index.ts main()                                        │
   │   await runMigrations()  ─► applies 0001..0006 in order      │
   │   registerCrons(deps) ──► returns CronRegistrationStatus     │
   │     ├── cron.schedule(syncCron, ...)                         │
   │     ├── cron.schedule(proactiveSweepCron, runSweep, tz)      │
   │     ├── cron.schedule(ritualSweepCron, runSweep, tz)  ◄──NEW │
   │     └── cron.schedule(episodicCron, runConsolidateYesterday) │
   │                                                              │
   │   GET /health ──► reads CronRegistrationStatus               │
   │                   { ritual_cron_registered: true }           │
   └──────────────────────────────────────────────────────────────┘
                                       │
                       21:00 Paris tick │ 10:00 Paris tick
                                       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   src/proactive/sweep.ts runSweep()                          │
   │     1. isMuted() global gate                                 │
   │     2. ACCOUNTABILITY channel (deadline trigger)             │
   │     3. ESCALATION loop (AWAITING_RESOLUTION rows)            │
   │     4. RITUAL CHANNEL ◄────────────────────────── NEW Phase 25│
   │        runRitualSweep() ─► returns RitualFireResult[]        │
   │     5. REFLECTIVE channel (silence/commitment/pattern/thread)│
   └──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   src/rituals/scheduler.ts runRitualSweep(now, deps)         │
   │     1. SELECT * FROM rituals WHERE enabled=true              │
   │          AND next_run_at <= now() ORDER BY next_run_at ASC   │
   │          LIMIT 1   ◄── per-tick max-1 cap (Pitfall 1)        │
   │     2. RitualConfigSchema.parse(row.config)                  │
   │     3. catch-up ceiling check: if next_run_at > 1 cadence    │
   │        period in past, advance without firing (log-only)     │
   │     4. Type-dispatch to handler (Phase 26-29 owns these)     │
   │        Phase 25 ships SKELETON only: throw 'not implemented' │
   │     5. ATOMIC UPDATE rituals SET last_run_at=now(),          │
   │        next_run_at=computeNextRunAt(now, config) WHERE id=$1 │
   │        AND (last_run_at IS NULL OR last_run_at < $observed)  │
   │        RETURNING *  ◄── prevents double-fire under race      │
   └──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (also called by)
   ┌──────────────────────────────────────────────────────────────┐
   │   scripts/manual-sweep.ts (D-07 operator wrapper)            │
   │     await runRitualSweep(new Date(), { db, bot })            │
   │     console.log JSON.stringify(results, null, 2)             │
   │     process.exit(0)  ◄── matches backfill-episodic.ts        │
   └──────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── rituals/                          # NEW Phase 25 subsystem
│   ├── types.ts                      # RitualConfigSchema (Zod, 8 fields + schema_version) + RitualFireOutcome scaffold
│   ├── cadence.ts                    # computeNextRunAt(now, config) Luxon helpers
│   ├── scheduler.ts                  # runRitualSweep + atomic UPDATE helper (or split to idempotency.ts per Claude's discretion)
│   └── __tests__/
│       ├── cadence.test.ts           # DST property tests, 4-cadence unit tests
│       ├── idempotency.test.ts       # Concurrency test (2 parallel invocations → 1 row)
│       ├── scheduler.test.ts         # Skeleton-handler dispatch + per-tick cap + catch-up ceiling
│       └── cron-registration.test.ts # registerCrons spy test (D-05)
├── db/
│   ├── schema.ts                     # MODIFIED — adds 6 ritual tables + RITUAL_RESPONSE enum value
│   └── migrations/
│       ├── 0006_rituals_wellbeing.sql  # NEW hand-authored
│       └── meta/0006_snapshot.json     # NEW regenerated via scripts/regen-snapshots.sh
├── proactive/
│   └── sweep.ts                      # MODIFIED — ritual channel between escalation and reflective
├── config.ts                         # MODIFIED — ritualSweepCron + cron.validate fail-fast
├── index.ts                          # MODIFIED — registerCrons(deps) extraction + /health field
└── (optional) cron-registration.ts   # NEW (Claude's discretion per D-06) — extracted helper

scripts/
├── manual-sweep.ts                   # NEW (D-07) — operator wrapper
├── regen-snapshots.sh                # MODIFIED — extend hardcoded 0001-0004 loop to 0001-0006
└── test.sh                           # MODIFIED — add MIGRATION_6_SQL psql line + post-migration assertion query
```

### Pattern 1: Migration with mixed CREATE TABLE / ALTER TYPE / CREATE INDEX

**What:** Hand-authored SQL combining new tables, enum extension, and indexes — drizzle-kit generate cannot auto-produce `ALTER TYPE epistemic_tag ADD VALUE 'RITUAL_RESPONSE'` so the SQL is hand-written, then `scripts/regen-snapshots.sh` clean-slate replay regenerates the meta-snapshot lineage.

**When to use:** Any migration that extends an existing enum (Drizzle 0.45 weak point per D-08) OR mixes data-shape changes with constraint changes.

**Example (verbatim shape from migration 0002 + 0003):**
```sql
-- Source: src/db/migrations/0002_decision_archive.sql:11-22 + 0003_add_decision_epistemic_tag.sql:1
DO $$ BEGIN
  CREATE TYPE "public"."ritual_cadence" AS ENUM('daily', 'weekly', 'monthly', 'quarterly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'RITUAL_RESPONSE';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "rituals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "type" "ritual_cadence" NOT NULL,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "skip_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rituals_name_unique" UNIQUE ("name")
);
--> statement-breakpoint
-- (5 more tables, then 3 indexes)

CREATE INDEX IF NOT EXISTS "rituals_next_run_at_enabled_idx"
  ON "rituals" USING btree ("next_run_at")
  WHERE "enabled" = true;
```

[CITED: src/db/migrations/0002_decision_archive.sql:11-22 — DO $$ ... EXCEPTION WHEN duplicate_object pattern]
[CITED: src/db/migrations/0003_add_decision_epistemic_tag.sql:1 — `ALTER TYPE ... ADD VALUE IF NOT EXISTS` shape]

### Pattern 2: Drizzle TS schema with partial index

**What:** Mirror the SQL migration in `src/db/schema.ts` so a future `drizzle-kit generate` against schema.ts produces a CLEAN diff (success criterion 1).

**Example:**
```typescript
// Source: src/db/schema.ts:319-340 (episodicSummaries pattern)
// Drizzle 0.45.2 partial index: IndexBuilder.where(condition: SQL): this
// [VERIFIED: node_modules/drizzle-orm/pg-core/indexes.d.ts:67]

export const ritualCadenceEnum = pgEnum('ritual_cadence', [
  'daily', 'weekly', 'monthly', 'quarterly',
]);

// EXTEND existing epistemicTagEnum at src/db/schema.ts:22-36 — add 'RITUAL_RESPONSE' as 14th value
export const epistemicTagEnum = pgEnum('epistemic_tag', [
  'FACT', 'EMOTION', 'BELIEF', 'INTENTION', 'EXPERIENCE', 'PREFERENCE',
  'RELATIONSHIP', 'DREAM', 'FEAR', 'VALUE', 'CONTRADICTION', 'OTHER',
  'DECISION',
  'RITUAL_RESPONSE',  // ← new (Phase 25 RIT-04)
]);

export const rituals = pgTable(
  'rituals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    type: ritualCadenceEnum('type').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    skipCount: integer('skip_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('rituals_name_unique').on(table.name),
    // PARTIAL INDEX — verified Drizzle 0.45 supports .where() on IndexBuilder
    index('rituals_next_run_at_enabled_idx')
      .on(table.nextRunAt)
      .where(sql`${table.enabled} = true`),
  ],
);
```

### Anti-Patterns to Avoid

- **Don't auto-generate 0006 via `drizzle-kit generate`.** D-08 explicitly rejected — `ALTER TYPE epistemic_tag ADD VALUE 'RITUAL_RESPONSE'` is not auto-generatable from schema.ts in Drizzle 0.45 (enum extensions are a known weak point).
- **Don't skip the `scripts/test.sh` psql line.** Pitfall 28 verbatim: "PR diff for the schema phase must include both the .sql migration AND the meta snapshot AND the scripts/test.sh psql line. If any of the three is missing, the migration is incomplete."
- **Don't compute `next_run_at = last_run_at + 24h` (Pitfall 3, CRITICAL).** First fire that runs at 10:00 cron tick instead of configured 21:00 locks `next_run_at` to 10:00 forever. ALWAYS use `computeNextRunAt(now, config)` anchored to wall-clock target time.
- **Don't fire all due rituals in one tick (Pitfall 1, CRITICAL).** SQL query MUST `LIMIT 1` (or be in a `for` loop with `break` after first fire). 3 rituals at once = phone buzzes 3 times in 4 seconds = adjustment-dialogue spiral.
- **Don't skip the `RitualConfigSchema.parse(row.config)` step.** JSONB freedom causes downstream pain (CONVENTIONS.md §Idempotency Patterns); every read of `rituals.config` must `.parse()` through the Zod schema with `.strict()`.
- **Don't use `vi.useFakeTimers` in tests (D-02 in TESTING.md).** Forbidden — breaks postgres.js connection keep-alive. Use `vi.setSystemTime` for the DST property tests.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron expression validation | Regex parse against POSIX cron grammar | `node-cron`'s `cron.validate(expression: string): boolean` | Already exposed at node_modules/node-cron/dist/esm/node-cron.d.ts:5; reinventing this is a Pitfall 27 amplifier (silently broken expression = silent ritual no-fire) |
| DST-safe wall-clock advancement | `next_run_at + 86_400_000` ms arithmetic | Luxon `DateTime.plus({ days: 1 }).setZone(tz).toUTC()` | Pitfall 2 + 3 (CRITICAL); `dayBoundaryUtc` in `src/episodic/sources.ts:74-83` is the canonical pattern |
| JSONB config field validation | Manual `if (typeof config.fire_at !== 'string')` checks | Zod `.strict().refine()` schema with `unknownKeys: 'strict'` | Pitfall 5 (Adjustment Haiku Garbage) prevention; same shape as `src/episodic/types.ts` v3 schemas |
| Concurrency-safe row state transition | `SELECT then UPDATE` two-step in TS | Atomic `UPDATE … WHERE last_run_at IS NULL OR last_run_at < $observed RETURNING *` | M007 D-28 precedent; Postgres handles the race in one round-trip; mirrors `transitionDecision()` optimistic-concurrency pattern |
| Partial index on `next_run_at WHERE enabled` | `CREATE INDEX` without WHERE, full scan filtering enabled in app | `index().on(table.nextRunAt).where(sql\`${table.enabled} = true\`)` | Drizzle 0.45 supports it natively (verified at indexes.d.ts:67); query planner uses partial index automatically; D034 precedent (ship indexes from day one, no retrofitting) |
| Migration meta-snapshot lineage | `npx drizzle-kit generate` against unstable journal | `scripts/regen-snapshots.sh` clean-slate iterative replay | TECH-DEBT-19-01 precedent; Drizzle's enum extension is a known auto-gen weak point; regen-snapshots.sh has shipped 3 times (v2.1, v2.2, v2.3) |
| Cron registration testability | `cron.schedule(...)` inline in `src/index.ts:main()` | Extract `registerCrons(deps): CronRegistrationStatus` (D-06) | Centralizes cron wiring; testable in isolation; status map feeds `/health` |

**Key insight:** Every "don't hand-roll" item in Phase 25 has either a library function ready (cron.validate, Luxon, Zod, Drizzle), an existing project pattern (regen-snapshots.sh, transitionDecision, dayBoundaryUtc), or a hard rule from Pitfalls. Phase 25 ships ZERO custom date math, ZERO custom validation, ZERO custom concurrency primitives.

---

## Common Pitfalls (Phase 25-specific subset of the 29-pitfall taxonomy)

### Pitfall 1: Ritual Storms After Cron Catch-Up — CRITICAL

**What goes wrong:** Server is offline 6h. When it comes back, the proactive sweep finds 3 rituals whose `next_run_at` are all in the past. All three fire in the same sweep tick. Greg's phone buzzes 3 times in 4 seconds. Two get dismissed reflexively, skip_count increments, adjustment dialogue fires for rituals Greg never disengaged from.

**Why it happens:** Natural extension of M008 cron pattern is "fire all matches" — but with the proactive sweep's `hasSentTodayReflective` daily cap, this works for triggers; rituals as a NEW channel without an across-rituals cap repeat the failure.

**How to avoid:**
- **Per-sweep ritual cap of 1.** SQL query is `SELECT … LIMIT 1` (or `for (const ritual of due) { ...; break; }`). Even if 3 rituals are due, fire only the highest-priority one this tick.
- **Catch-up ceiling per ritual.** When `next_run_at` is more than 1 cadence-period in the past (e.g., daily ritual whose next_run_at is 3 days old), advance `next_run_at` to the *next future* slot WITHOUT firing — log `rituals.skipped.catchup` and move on.
- **Independent ritual channel.** Add `hasSentTodayRitual` peer to existing accountability/reflective KV booleans (state.ts:102+124 pattern); global `isMuted()` still gates.

**Warning signs:**
- Code-review: any `for (const ritual of dueRituals) { fire(ritual) }` in `src/rituals/scheduler.ts` without `break`.
- Test: simulate a 48h `vi.setSystemTime` jump forward; assert exactly 1 ritual fires per tick even when 3 are due.

[CITED: .planning/research/PITFALLS.md:15-34]

### Pitfall 2: DST Drift in Ritual Cadence — CRITICAL

**What goes wrong:** Daily voice note configured to fire at "21:00 Europe/Paris" stops firing at right wall-clock time across spring-forward (2026-03-29) and fall-back (2026-10-25) transitions. Naive `+24h` arithmetic drifts an hour every 6 months.

**Why it happens:** `next_run_at` is `timestamptz` stored as UTC. Tempting to compute `next_run_at = old_next_run_at + interval '1 day'` — which is a UTC operation. UTC `+24h` from "21:00 Paris on a spring-forward day" lands at "22:00 Paris" because the calendar day was 23h long.

**How to avoid:**
- **Anchor cadence to wall-clock, not UTC.** Compute `next_run_at` via `DateTime.fromJSDate(prev, { zone: tz }).plus({ days: 1 }).toUTC().toJSDate()` (Luxon). Same shape as `dayBoundaryUtc` in `src/episodic/sources.ts:74-83`.
- **Helper module.** `src/rituals/cadence.ts` exports `computeNextRunAt(now, config)`. Single chokepoint. All ritual config advancement routes through it.
- **Test matrix.** DST property tests pinned to 2026-03-29 (Paris spring-forward) and 2026-10-25 (Paris fall-back) — both as `vi.setSystemTime` fixtures.

**Warning signs:**
- Code-review: `grep -rn '86_400_000\|86400000\|setUTCHours\|setHours' src/rituals/` MUST return zero matches outside test-fixture time math.

[CITED: .planning/research/PITFALLS.md:37-60]

### Pitfall 3: Cadence Drift via `last_run_at + 24h` — CRITICAL

**What goes wrong:** `next_run_at = last_run_at + 24h` after each fire. If cron sweep runs at 10:00 Paris but the ritual is configured for 21:00, the ritual fires at 10:00 the next day (when sweep ran after 21:00 the prior day passed). Then `next_run_at = 10:00 + 24h = 10:00 the day after`. Lost the 21:00 anchor on the very first fire.

**How to avoid:**
- **`next_run_at = computeNextRunAt(now, config)` — anchor to wall-clock target time, never to `last_run_at`.** The cadence helper takes the *configured* `fire_at` (from `RitualConfig.fire_at`), not the actual fire time.
- **Test:** 14-day fixture asserts `ritual.fired.at_local_hour === config.fire_at.hour` for every fire across 14 days.

[CITED: .planning/research/PITFALLS.md:64-83]

### Pitfall 28: Migration 0006 Drizzle-Kit Snapshot Lineage Regression — HIGH

**What goes wrong:** Implementer runs `drizzle-kit generate` for 0006 — produces 0006.sql but ALSO produces a meta snapshot 0006_snapshot.json based on the previous lineage. If lineage is broken (TECH-DEBT-19-01 history), generates a non-replayable snapshot or pollutes the lineage. Without explicit discipline, lineage drift is invisible until fresh-deploy.

**How to avoid:**
- **Run `scripts/regen-snapshots.sh`** as part of Plan 25-01. Confirm meta snapshots 0000-0006 are all present and reproducible from clean-slate replay.
- **Add migration 0006 to `scripts/test.sh`'s explicit psql apply list.** Per CONVENTIONS.md TESTING §migrations: `scripts/test.sh` applies migrations explicitly via psql, not drizzle-kit. New migration = new psql line. Mandatory.
- **HARD CO-LOCATION #7:** Migration SQL + meta-snapshot regeneration + `scripts/test.sh` psql line ALL ship in ONE atomic plan (Plan 25-01).

**Operational gotcha specific to Phase 25:** `scripts/regen-snapshots.sh` is HARDCODED for migrations 0000-0004 only (verified at scripts/regen-snapshots.sh:52-56 — `MIGRATION_0..MIGRATION_4` constants). Phase 25 MUST extend the script to handle 0005 + 0006 in the iterative-replay loop. Greg's note in CONTEXT.md says "regenerate via clean-slate iterative replay" — the script's existing comment block (lines 1-37) describes the pattern, but the actual SQL apply sequence + introspect rounds + chain-patching loop hardcodes 4 migrations.

[CITED: .planning/research/PITFALLS.md:701-720 + scripts/regen-snapshots.sh:52-56,247-300 (verified by file read)]

### Pitfall 27 (referenced for context): Cron Env-Var Defaults Must Be Safe — HIGH

**Mitigation already locked in D-03:** `cron.validate` runs at config load (`src/config.ts`) immediately after `process.env.RITUAL_SWEEP_CRON` is read; on `false`, throws startup error. Container fails `/health`, Docker restart-loops until env is fixed. Test: `RITUAL_SWEEP_CRON=garbage` causes `import('../config.js')` to reject.

[CITED: .planning/research/PITFALLS.md:678-700 + CONTEXT.md D-03]

---

## Code Examples (verified patterns from existing source files)

### Example 1: Atomic UPDATE … RETURNING * (M007 D-28 precedent)

**RIT-10 implementation.** The atomic SQL is the lock; no advisory locks, no SELECT-then-UPDATE.

```typescript
// Source: shape inspired by src/decisions/lifecycle.ts transitionDecision()
// (M007 optimistic-concurrency pattern); raw db.execute(sql\`...\`) for clarity
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { rituals } from '../db/schema.js';
import { eq, and, or, isNull, lt } from 'drizzle-orm';

export async function tryFireRitualAtomic(
  ritualId: string,
  lastObserved: Date | null,
  newNextRunAt: Date,
): Promise<{ fired: boolean; row?: typeof rituals.$inferSelect }> {
  const now = new Date();

  // Drizzle query builder version — type-safe, mirrors transitionDecision()
  const rows = await db
    .update(rituals)
    .set({ lastRunAt: now, nextRunAt: newNextRunAt })
    .where(
      and(
        eq(rituals.id, ritualId),
        // Concurrency guard: only fire if our observed last_run_at is still authoritative
        or(
          isNull(rituals.lastRunAt),
          lastObserved ? lt(rituals.lastRunAt, lastObserved) : sql`true`,
        ),
      ),
    )
    .returning();

  if (rows.length === 0) {
    // Race lost — another sweep tick already fired this ritual
    return { fired: false };
  }
  return { fired: true, row: rows[0] };
}
```

**Concurrency test mechanism:**
```typescript
// Two parallel invocations of tryFireRitualAtomic against the same ritual ID
// MUST produce exactly 1 returned row (idempotency proof per success criterion 3)
const [a, b] = await Promise.all([
  tryFireRitualAtomic(ritualId, null, future),
  tryFireRitualAtomic(ritualId, null, future),
]);
expect([a.fired, b.fired].filter(Boolean)).toHaveLength(1);
```

### Example 2: Luxon DST-safe cadence advancement

**RIT-08 implementation.** Mirrors `dayBoundaryUtc` shape verbatim.

```typescript
// Source: src/episodic/sources.ts:74-83 dayBoundaryUtc pattern
// All 4 cadences via Luxon DateTime.plus({ days/weeks/months })
import { DateTime } from 'luxon';
import type { RitualConfig } from './types.js';

export function computeNextRunAt(now: Date, config: RitualConfig): Date {
  // Parse fire_at "HH:mm" in the configured tz, snap to next future slot
  const tz = config.time_zone; // e.g. 'Europe/Paris'
  const [hh, mm] = config.fire_at.split(':').map(Number);

  // Today's fire slot in local tz
  let target = DateTime.fromJSDate(now, { zone: tz })
    .startOf('day')
    .set({ hour: hh!, minute: mm!, second: 0, millisecond: 0 });

  // If today's slot is in the past, start from tomorrow
  if (target.toJSDate() <= now) {
    target = target.plus({ days: 1 });
  }

  // Switch on cadence (the cadence enum value lives on the rituals row, not config —
  // cadence.ts takes the whole row in production; sketch here uses config only)
  switch (config.cadence) {
    case 'daily':
      // target is already tomorrow's slot — return as-is
      break;
    case 'weekly':
      // Advance to next instance of fire_dow (1=Mon..7=Sun ISO)
      const targetWeekday = config.fire_dow ?? 7; // Sunday default for weekly review
      const daysToAdd = ((targetWeekday - target.weekday + 7) % 7) || 7;
      target = target.plus({ days: daysToAdd });
      break;
    case 'monthly':
      target = target.plus({ months: 1 });
      break;
    case 'quarterly':
      target = target.plus({ months: 3 });
      break;
  }

  // Return UTC instant — timestamptz storage is timezone-agnostic at the column
  return target.toUTC().toJSDate();
}
```

**DST property tests pinned to 2026-03-29 + 2026-10-25:**
```typescript
// Source: shape from src/episodic/__tests__/cron.test.ts (DST tests for episodic cron)
import { vi, describe, it, expect } from 'vitest';
import { computeNextRunAt } from '../cadence.js';

describe('cadence DST safety', () => {
  it('preserves wall-clock fire time across spring-forward (2026-03-29 Europe/Paris)', () => {
    // 2026-03-28 21:00 Paris = 20:00 UTC. Next daily fire MUST be 2026-03-29 21:00 Paris = 19:00 UTC
    // (because Paris jumps from 02:00 to 03:00 on 2026-03-29 — the day is 23h long).
    const now = new Date('2026-03-28T20:00:00.000Z'); // 21:00 Paris (CET, UTC+1)
    const config = { fire_at: '21:00', time_zone: 'Europe/Paris', cadence: 'daily', /* ... */ };
    const next = computeNextRunAt(now, config);
    // 21:00 Paris on 2026-03-29 (post-DST) is 19:00 UTC (CEST, UTC+2)
    expect(next.toISOString()).toBe('2026-03-29T19:00:00.000Z');
  });

  it('preserves wall-clock fire time across fall-back (2026-10-25 Europe/Paris)', () => {
    // 2026-10-24 21:00 Paris = 19:00 UTC (CEST). Next: 2026-10-25 21:00 Paris = 20:00 UTC (CET).
    const now = new Date('2026-10-24T19:00:00.000Z');
    const config = { fire_at: '21:00', time_zone: 'Europe/Paris', cadence: 'daily', /* ... */ };
    const next = computeNextRunAt(now, config);
    expect(next.toISOString()).toBe('2026-10-25T20:00:00.000Z');
  });
});
```

### Example 3: Cron registration with cron.validate fail-fast (D-03)

**RIT-12 implementation.**

```typescript
// MODIFIED src/config.ts (around existing line 39 where proactiveSweepCron is defined)
import 'dotenv/config';
import { validate } from 'node-cron'; // [VERIFIED: node-cron@4.2.1 d.ts:5]

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

// Validate cron expressions at module-load time per D-03 fail-fast
function validatedCron(envKey: string, fallback: string): string {
  const expr = process.env[envKey] || fallback;
  if (!validate(expr)) {
    throw new Error(`config: invalid ${envKey} expression "${expr}"`);
  }
  return expr;
}

export const config = {
  // ... existing fields ...
  proactiveSweepCron: validatedCron('PROACTIVE_SWEEP_CRON', '0 10 * * *'),
  ritualSweepCron: validatedCron('RITUAL_SWEEP_CRON', '0 21 * * *'), // ← NEW (RIT-12)
  episodicCron: validatedCron('EPISODIC_CRON', '0 23 * * *'),
} as const;
```

**Test (mirrors src/episodic/__tests__/cron.test.ts mock pattern):**
```typescript
// src/__tests__/config.test.ts (or co-located src/config.test.ts)
import { describe, it, expect } from 'vitest';

describe('config: cron.validate fail-fast', () => {
  it('rejects invalid RITUAL_SWEEP_CRON at config load', async () => {
    // Set garbage env BEFORE the import — config.ts reads it at import time
    process.env.RITUAL_SWEEP_CRON = 'garbage';
    // Force fresh import (vitest cache may already have config.ts)
    await expect(import('../config.js?reload=' + Date.now())).rejects.toThrow(
      /invalid RITUAL_SWEEP_CRON/,
    );
  });
});
```

### Example 4: registerCrons(deps) helper (D-06)

**Per CONTEXT.md D-06 — extract to a helper for testability.**

```typescript
// NEW src/cron-registration.ts (or in-place extraction within src/index.ts)
import cron from 'node-cron';
import { logger } from './utils/logger.js';

export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
}

export interface RegisterCronsDeps {
  config: typeof import('./config.js').config;
  runSweep: () => Promise<unknown>;
  runRitualSweep: () => Promise<unknown>;
  runConsolidateYesterday: () => Promise<void>;
  runSync?: () => Promise<void>; // optional — sync may be disabled
}

export function registerCrons(deps: RegisterCronsDeps): CronRegistrationStatus {
  const status: CronRegistrationStatus = {
    proactive: 'failed',
    ritual: 'failed',
    episodic: 'failed',
    sync: deps.runSync ? 'failed' : 'disabled',
  };

  // Existing 10:00 Paris proactive sweep (mirrors src/index.ts:73-80)
  cron.schedule(deps.config.proactiveSweepCron, async () => {
    try { await deps.runSweep(); }
    catch (err) { logger.error({ err }, 'proactive.cron.error'); }
  }, { timezone: deps.config.proactiveTimezone });
  status.proactive = 'registered';
  logger.info({ cron: deps.config.proactiveSweepCron, timezone: deps.config.proactiveTimezone }, 'proactive.cron.scheduled');

  // NEW 21:00 Paris ritual sweep (RIT-11)
  cron.schedule(deps.config.ritualSweepCron, async () => {
    try { await deps.runRitualSweep(); }
    catch (err) { logger.error({ err }, 'rituals.cron.error'); }
  }, { timezone: deps.config.proactiveTimezone });
  status.ritual = 'registered';
  logger.info({ cron: deps.config.ritualSweepCron, timezone: deps.config.proactiveTimezone }, 'rituals.cron.scheduled');

  // Existing 23:00 Paris episodic (mirrors src/index.ts:89-96)
  cron.schedule(deps.config.episodicCron, async () => {
    try { await deps.runConsolidateYesterday(); }
    catch (err) { logger.error({ err }, 'episodic.cron.error'); }
  }, { timezone: deps.config.proactiveTimezone });
  status.episodic = 'registered';

  return status;
}
```

**Module-scoped status singleton consumed by `/health`:**
```typescript
// src/index.ts changes
import { registerCrons, CronRegistrationStatus } from './cron-registration.js';

let cronStatus: CronRegistrationStatus | undefined;

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/health', async (_req, res) => {
    // ... existing checks (database, immich) ...
    const ritualCronRegistered = cronStatus?.ritual === 'registered';
    res.status(statusCode).json({
      status: overallStatus,
      checks,
      ritual_cron_registered: ritualCronRegistered, // ← NEW (RIT-12)
      timestamp: new Date().toISOString(),
    });
  });
  return app;
}

async function main() {
  await runMigrations();
  cronStatus = registerCrons({
    config,
    runSweep,
    runRitualSweep,
    runConsolidateYesterday,
    // runSync handled by existing startScheduler() conditional
  });
  // ... rest of main() unchanged ...
}
```

### Example 5: scripts/manual-sweep.ts (D-07)

**Mirrors `scripts/backfill-episodic.ts:233-273` exit pattern.**

```typescript
#!/usr/bin/env node
/**
 * scripts/manual-sweep.ts — Phase 25 D-07 operator wrapper.
 *
 * Usage:
 *   npx tsx scripts/manual-sweep.ts
 *
 * Behavior:
 *   - Calls runRitualSweep() once against live DB.
 *   - Prints fired ritual rows as pretty-printed JSON.
 *   - Exits 0 if no rituals fired (clean DB → []).
 *   - Hard-fails on missing DB connection (no fallback per D-07).
 *   - No try/finally cleanup (matches backfill-episodic.ts pattern noted in
 *     STATE.md as "safe as-is").
 */
import { runRitualSweep } from '../src/rituals/scheduler.js';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  try {
    const results = await runRitualSweep(new Date());
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'manual-sweep.error');
    console.error('manual-sweep failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

### Example 6: Ritual channel insertion in runSweep (RIT-09)

**Edit to `src/proactive/sweep.ts`. Insertion point: AFTER escalation loop (line ~336), BEFORE reflective channel (line ~340).**

```typescript
// In src/proactive/sweep.ts, between escalation loop end (line 336) and "REFLECTIVE CHANNEL" comment (line 340):

// ── RITUAL CHANNEL (M009 RIT-09) ───────────────────────────────────────
// Independent of accountability + reflective daily caps. Each ritual has its
// own cadence; firing the daily voice note does NOT consume the reflective
// channel slot. Per-tick max-1 cap inside runRitualSweep enforces no ritual
// storms (Pitfall 1). Shares global mute (already gated above at line 85).
let ritualResults: Awaited<ReturnType<typeof runRitualSweep>> = [];
try {
  ritualResults = await runRitualSweep(new Date());
} catch (err) {
  logger.error({ err }, 'rituals.sweep.error');
  // Per-ritual isolation lives INSIDE runRitualSweep — this catch is the
  // last-line defence so a ritual-system bug does not block the reflective
  // channel below.
}
```

**No changes to existing accountability or reflective channel logic.** The ritual channel is a peer; ordering is "highest priority first" per D-05 spirit:
1. Accountability (deadline-driven, user-promised) — fires first
2. Escalation loop (AWAITING_RESOLUTION 48h follow-ups) — fires after accountability
3. **Ritual (cadence-driven, user-promised) — NEW Phase 25**
4. Reflective (opportunistic, AI-detected) — fires last

---

## Runtime State Inventory

> Phase 25 is a greenfield substrate phase, NOT a rename/refactor. **This section omitted intentionally** — no existing runtime state needs migration. The `RITUAL_RESPONSE` enum extension is a new value, not a rename. The `scripts/regen-snapshots.sh` modification is a code edit (extend hardcoded migration list from 0001-0004 to 0001-0006), not a runtime state change.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next_run_at = last_run_at + 24h` arithmetic | `computeNextRunAt(now, config)` Luxon helper | M008 Phase 22 (CRON-02 lesson) | Fixes Pitfall 3 cadence drift; survives DST transitions |
| `drizzle-kit generate` for enum extensions | Hand-authored SQL + `scripts/regen-snapshots.sh` clean-slate replay | v2.1 Phase 19 (TECH-DEBT-19-01 fix) | Drizzle 0.45 cannot auto-gen `ALTER TYPE ... ADD VALUE`; hand-write + replay is the established escape hatch |
| Cron registration inline in `main()` | `registerCrons(deps): CronRegistrationStatus` helper (Phase 25 D-06) | Phase 25 (this phase) | Centralizes wiring; testable in isolation; status map feeds `/health` |
| Per-test source-tag cleanup with FK ordering | Same pattern (TESTING.md §Fixture Patterns) | v2.0+ stable | Phase 25 tests use this for any DB writes; per-file `FIXTURE_SOURCE` const |
| `vi.useFakeTimers` in time-travel tests | `vi.setSystemTime` ONLY (D-02 in TESTING.md) | v2.1 Phase 18 (WR-01) | DST property tests in Phase 25 use `vi.setSystemTime` exclusively; `vi.useFakeTimers` breaks postgres.js keep-alive |

**Deprecated/outdated:**
- `next_run_at = last_run_at + 24h` — never use; Pitfall 3 CRITICAL
- `Date.setUTCHours(0, 0, 0, 0)` for day boundaries — use `dayBoundaryUtc` from `src/episodic/sources.ts`
- Inline `cron.schedule(...)` in `main()` — use `registerCrons(deps)` (D-06)

---

## Validation Architecture

> `nyquist_validation: true` per `.planning/config.json`. Section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x + @vitest/coverage-v8 |
| Config file | `vitest.config.ts` (root: `src`, `fileParallelism: false` load-bearing per TESTING.md) |
| Quick run command | `npx vitest run src/rituals/__tests__/<file>.test.ts` (unit/pure-function tests, no DB) |
| Full suite command | `bash scripts/test.sh` (boots Docker postgres on port 5433, applies all 6 migrations including 0006, then `npx vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RIT-01 | `rituals` table present after migration with all 9 columns + UNIQUE(name) | smoke (psql query in scripts/test.sh) | `bash scripts/test.sh` (post-migration assertion line) | ❌ Wave 0 |
| RIT-02 | `wellbeing_snapshots` table present with smallint CHECK 1-5 | smoke | same as above | ❌ Wave 0 |
| RIT-03 | 4 supporting append-only tables present | smoke | same as above | ❌ Wave 0 |
| RIT-04 | `RITUAL_RESPONSE` enum value present in `epistemic_tag` | smoke | same as above | ❌ Wave 0 |
| RIT-05 | All 3 indexes present (partial + 2 btree) | smoke | same as above | ❌ Wave 0 |
| RIT-06 | Migration 0006 lineage clean — `npx drizzle-kit generate` produces zero diff | smoke (manual + CI) | `npx drizzle-kit generate` (after `bash scripts/regen-snapshots.sh`) | ❌ Wave 0 |
| RIT-07 | `RitualConfigSchema.parse(invalid)` rejects unknown fields and wrong types | unit | `npx vitest run src/rituals/__tests__/types.test.ts -x` | ❌ Wave 0 |
| RIT-08 | `computeNextRunAt(now, config)` returns correct Date for daily/weekly/monthly/quarterly across normal + DST boundaries | unit (property tests) | `npx vitest run src/rituals/__tests__/cadence.test.ts -x` | ❌ Wave 0 |
| RIT-09 | `runRitualSweep` invoked from `runSweep` between escalation and reflective; per-tick max-1 cap honored | integration (mocked DB or real Docker) | `npx vitest run src/rituals/__tests__/scheduler.test.ts -x` + `npx vitest run src/proactive/__tests__/sweep.test.ts -x` (regression) | ❌ Wave 0 |
| RIT-10 | Atomic UPDATE...RETURNING produces exactly 1 fired row under 2 concurrent invocations | integration (real Docker postgres) | `npx vitest run src/rituals/__tests__/idempotency.test.ts -x` | ❌ Wave 0 |
| RIT-11 | `cron.schedule` called with `'0 21 * * *'` and `{ timezone: 'Europe/Paris' }` | unit (mocked node-cron) | `npx vitest run src/rituals/__tests__/cron-registration.test.ts -x` | ❌ Wave 0 |
| RIT-12 | (a) `RITUAL_SWEEP_CRON=garbage` → `import('../config.js')` rejects; (b) `/health` returns `ritual_cron_registered: true` after `registerCrons` runs | unit (a) + integration (b) | (a) `npx vitest run src/__tests__/config.test.ts -x`; (b) `npx vitest run src/__tests__/health.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Run `npx vitest run src/rituals/__tests__/<modified-file>.test.ts` plus the migration smoke gate (`bash scripts/test.sh src/__tests__/migrations.test.ts` — Wave 0 to create) when schema changes.
- **Per wave merge:** `bash scripts/test.sh src/rituals/` runs all ritual tests against fresh Docker postgres with all 6 migrations applied.
- **Phase gate:** Full `bash scripts/test.sh` green before `/gsd-verify-work` — exercises all 80+ existing test files plus new ritual suites against fresh Postgres.

### Wave 0 Gaps

- [ ] `src/rituals/types.ts` + `src/rituals/__tests__/types.test.ts` — RitualConfigSchema strict-mode rejection tests
- [ ] `src/rituals/cadence.ts` + `src/rituals/__tests__/cadence.test.ts` — DST property tests pinned to 2026-03-29 + 2026-10-25
- [ ] `src/rituals/scheduler.ts` + `src/rituals/__tests__/scheduler.test.ts` — runRitualSweep skeleton + per-tick cap + catch-up ceiling tests
- [ ] `src/rituals/__tests__/idempotency.test.ts` — atomic UPDATE concurrency test (2-parallel-invocation)
- [ ] `src/rituals/__tests__/cron-registration.test.ts` — registerCrons spy test (D-05)
- [ ] `src/__tests__/config.test.ts` — cron.validate fail-fast test (RITUAL_SWEEP_CRON=garbage)
- [ ] Migration smoke test — confirm 6 tables + RITUAL_RESPONSE enum + 3 indexes present (added as psql line in scripts/test.sh, not vitest — see §3 below)
- [ ] `src/cron-registration.ts` (NEW file per D-06 — Claude's discretion whether to extract or in-place)
- [ ] `scripts/manual-sweep.ts` (NEW per D-07)
- [ ] `scripts/regen-snapshots.sh` modification — extend hardcoded 0001-0004 loop to 0001-0006

**Framework install:** None — Vitest already installed; no new test deps.

**Vitest-4 fork-IPC hang mitigation:** New `src/rituals/__tests__/` suites must NOT trigger the env-level vitest-4 fork-IPC hang under HuggingFace EACCES (STATE.md "Open Items"). Mitigation: any test that mocks `@huggingface/transformers`-touching modules (e.g. `src/pensieve/embeddings.ts`) must use `vi.mock` at file top, NOT runtime mock injection. Phase 25 substrate tests don't touch embeddings, so risk is LOW — but verify during Phase 25 Wave 0 by running `bash scripts/test.sh src/rituals/` in isolation and confirming completion in <60s.

---

## Specific Focus-Area Findings (the 12 questions from the spawn brief)

### §1 — Migration 0006 SQL specifics

**Exact CREATE TABLE statements** (mirroring 0002 + 0005 conventions: `DO $$ … EXCEPTION WHEN duplicate_object` for enums, `IF NOT EXISTS` for tables/indexes, two-space indent, `--> statement-breakpoint` separators):

```sql
-- src/db/migrations/0006_rituals_wellbeing.sql
-- Phase 25 (M009 v2.4) — Ritual scheduling foundation.
-- Hand-authored per CONTEXT.md D-08 (drizzle-kit cannot auto-gen ALTER TYPE).
-- Idempotency guards added per migration 0002 MD-02 pattern (DO blocks for
-- enums, IF NOT EXISTS for tables/indexes/constraints).

DO $$ BEGIN
  CREATE TYPE "public"."ritual_cadence" AS ENUM('daily', 'weekly', 'monthly', 'quarterly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'RITUAL_RESPONSE';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "rituals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "type" "ritual_cadence" NOT NULL,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "skip_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rituals_name_unique" UNIQUE ("name")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "wellbeing_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_date" date NOT NULL,
  "energy" smallint NOT NULL,
  "mood" smallint NOT NULL,
  "anxiety" smallint NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "wellbeing_snapshots_snapshot_date_unique" UNIQUE ("snapshot_date"),
  CONSTRAINT "wellbeing_snapshots_energy_bounds" CHECK ("energy" BETWEEN 1 AND 5),
  CONSTRAINT "wellbeing_snapshots_mood_bounds" CHECK ("mood" BETWEEN 1 AND 5),
  CONSTRAINT "wellbeing_snapshots_anxiety_bounds" CHECK ("anxiety" BETWEEN 1 AND 5)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ritual_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ritual_id" uuid NOT NULL,
  "fired_at" timestamp with time zone NOT NULL,
  "responded_at" timestamp with time zone,
  "prompt_text" text NOT NULL,
  "pensieve_entry_id" uuid,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ritual_fire_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ritual_id" uuid NOT NULL,
  "fired_at" timestamp with time zone NOT NULL,
  "outcome" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ritual_config_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ritual_id" uuid NOT NULL,
  "actor" varchar(32) NOT NULL,
  "patch" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ritual_pending_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ritual_id" uuid NOT NULL,
  "chat_id" bigint NOT NULL,
  "fired_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ritual_responses" ADD CONSTRAINT "ritual_responses_ritual_id_rituals_id_fk"
    FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ritual_fire_events" ADD CONSTRAINT "ritual_fire_events_ritual_id_rituals_id_fk"
    FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ritual_config_events" ADD CONSTRAINT "ritual_config_events_ritual_id_rituals_id_fk"
    FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ritual_pending_responses" ADD CONSTRAINT "ritual_pending_responses_ritual_id_rituals_id_fk"
    FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ritual_responses" ADD CONSTRAINT "ritual_responses_pensieve_entry_id_pensieve_entries_id_fk"
    FOREIGN KEY ("pensieve_entry_id") REFERENCES "public"."pensieve_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Indexes shipped from day one (D034 precedent — no retrofitting)
CREATE INDEX IF NOT EXISTS "rituals_next_run_at_enabled_idx"
  ON "rituals" USING btree ("next_run_at")
  WHERE "enabled" = true;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "wellbeing_snapshots_snapshot_date_idx"
  ON "wellbeing_snapshots" USING btree ("snapshot_date");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ritual_responses_ritual_id_fired_at_idx"
  ON "ritual_responses" USING btree ("ritual_id", "fired_at" DESC);
```

**Drizzle TypeScript schema additions** (in `src/db/schema.ts`, after `episodicSummaries` block at line 340):
- `ritualCadenceEnum` — new pgEnum
- Extend `epistemicTagEnum` with `'RITUAL_RESPONSE'` as 14th value (modify line 22-36)
- 6 new pgTable declarations: `rituals`, `wellbeingSnapshots`, `ritualResponses`, `ritualFireEvents`, `ritualConfigEvents`, `ritualPendingResponses`
- All 3 indexes (1 partial via `.where(sql\`${table.enabled} = true\`)`, 2 standard btree)
- `wellbeing_snapshots` CHECK constraints via `.check()` (mirrors `episodic_summaries.check()` at schema.ts:338)

[CITED: src/db/migrations/0002_decision_archive.sql:11-77 — DO block + IF NOT EXISTS pattern]
[CITED: src/db/migrations/0003_add_decision_epistemic_tag.sql:1 — ALTER TYPE shape]
[CITED: src/db/migrations/0005_episodic_summaries.sql:1-16 — UNIQUE + CHECK + index shape]
[VERIFIED: node_modules/drizzle-orm/pg-core/indexes.d.ts:67 — `.where(SQL): this` exists on IndexBuilder]

### §2 — `scripts/regen-snapshots.sh` invocation contract

**Critical finding:** The script is HARDCODED for migrations 0001-0004 only. Phase 25 MUST extend it.

**Current state (verified by file read):**
- `MIGRATION_0..MIGRATION_4` constants at scripts/regen-snapshots.sh:52-56
- Step 2 applies migrations 0000+0001 (line 250-251), introspects, saves 0001_snapshot
- Step 3 applies migrations 0002+0003 (line 269-270), introspects, saves 0003_snapshot
- Step 5 acceptance gate applies 0000-0004 (lines 311-315)
- Re-chain logic only handles 0002.prevId → new 0001.id and 0004.prevId → new 0003.id (lines 297-300)

**Required Phase 25 modifications:**
1. Add `MIGRATION_5_SQL="src/db/migrations/0005_episodic_summaries.sql"` and `MIGRATION_6_SQL="src/db/migrations/0006_rituals_wellbeing.sql"` constants
2. Apply all 7 migrations in acceptance gate (step 5)
3. Decide regen approach: either (a) preserve existing 0001/0003 regeneration (since those snapshots are already broken-and-fixed by v2.1 Plan 19) and APPEND a new "Step 6/7" that regenerates 0005 and 0006 OR (b) regenerate the whole chain end-to-end. Recommendation: option (b) — the whole-chain replay is more defensive and matches D-08 "clean-slate iterative replay".

**Invocation contract (post-modification):**
```bash
bash scripts/regen-snapshots.sh           # regenerates AND installs 0001/0003/0005/0006 snapshots
bash scripts/regen-snapshots.sh --check-only  # dry-run: verifies acceptance gate without installing
```

**Env vars:** None (uses hardcoded `DB_URL=postgresql://chris:localtest123@localhost:5434/chris`).

**Expected outputs after run:**
- Stdout: `✓ Snapshot regeneration acceptance gate: No schema changes`
- File system: `src/db/migrations/meta/0006_snapshot.json` exists, chains from `0005_snapshot.id`
- File system: `src/db/migrations/meta/_journal.json` extended with `0006_rituals_wellbeing` entry
- Cleanup: `.tmp/` directory removed; regen Docker container torn down

[CITED: scripts/regen-snapshots.sh:1-37 (header), 52-56 (constants), 247-345 (full flow)]

### §3 — `scripts/test.sh` psql line shape

**Required additions to `scripts/test.sh`:**

1. **New migration constant** (after line 13):
```bash
MIGRATION_6_SQL="src/db/migrations/0006_rituals_wellbeing.sql"
```

2. **Apply migration 0006** (after line 55):
```bash
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_6_SQL"
```

3. **Post-migration assertion line** (NEW, after migration apply, before `npx vitest run`):
```bash
echo "🔍 Verifying migration 0006 substrate..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name IN ('rituals', 'wellbeing_snapshots', 'ritual_responses',
                          'ritual_fire_events', 'ritual_config_events', 'ritual_pending_responses')) AS table_count,
      (SELECT COUNT(*) FROM pg_enum
       WHERE enumlabel = 'RITUAL_RESPONSE'
       AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'epistemic_tag')) AS enum_value_count,
      (SELECT COUNT(*) FROM pg_indexes
       WHERE schemaname = 'public'
       AND indexname IN ('rituals_next_run_at_enabled_idx',
                         'wellbeing_snapshots_snapshot_date_idx',
                         'ritual_responses_ritual_id_fired_at_idx')) AS index_count;
  " | tee /tmp/m009_smoke.txt
# Expect: 6|1|3 — assert via test, or fail the gate here:
grep -q "^6|1|3$" /tmp/m009_smoke.txt || { echo "❌ Migration 0006 substrate incomplete"; exit 1; }
```

This line is REQUIRED per HARD CO-LOCATION #7 — splitting it from the migration SQL = lineage breakage.

[CITED: scripts/test.sh:1-63 (full file shape) + .planning/research/PITFALLS.md:715-720 (Pitfall 28 mitigation)]

### §4 — Luxon `computeNextRunAt(now, config)` algorithm

**Pseudocode** (full TypeScript in §Code Examples Example 2):

```
Inputs:
  now: Date — current instant (real or vi.setSystemTime mock)
  config: RitualConfig — { fire_at: 'HH:mm', fire_dow?: 1-7, time_zone: 'IANA', cadence: 'daily'|'weekly'|'monthly'|'quarterly', ... }

Algorithm:
  1. Parse `fire_at` → (hh, mm) integers
  2. local_today_slot = DateTime.fromJSDate(now, { zone: config.time_zone })
       .startOf('day')
       .set({ hour: hh, minute: mm, second: 0, millisecond: 0 })
  3. If local_today_slot.toJSDate() <= now:
       target = local_today_slot.plus({ days: 1 })
     Else:
       target = local_today_slot
  4. Switch config.cadence:
       'daily':     # target is already tomorrow if needed; return as-is
       'weekly':    # advance to next ISO weekday matching fire_dow (1=Mon..7=Sun)
                    daysToAdd = ((fire_dow - target.weekday + 7) % 7) || 7
                    target = target.plus({ days: daysToAdd })
       'monthly':   target = target.plus({ months: 1 })
       'quarterly': target = target.plus({ months: 3 })
  5. Return target.toUTC().toJSDate()

Why DST-safe:
  - Luxon's `plus({ days: 1 })` operates on local wall-clock (NOT UTC ms).
  - On 2026-03-29 (Paris spring-forward, 23h day): plus({days:1}) advances local
    wall-clock by 24 wall-clock hours = 23h UTC. The resulting toUTC() correctly
    preserves the configured 21:00 Paris.
  - On 2026-10-25 (Paris fall-back, 25h day): plus({days:1}) again advances local
    wall-clock by 24h = 25h UTC. Still preserves 21:00 Paris.
  - The `|| 7` clause in weekly handles the "Sunday 21:01 → next Sunday" edge case.

Why anchored to wall-clock target, NOT last_run_at:
  Pitfall 3 — if cron sweep runs at 10:00 Paris but ritual configured for 21:00,
  computing next from last_run_at (which is 10:00) drifts the ritual to 10:00
  forever. Computing next from `local_today_slot` (which is 21:00) preserves
  the configured anchor.
```

**Test fixtures pinned dates:**
- **2026-03-29 (spring-forward Europe/Paris):** `now = '2026-03-28T20:00:00.000Z'` (21:00 Paris CET); expect `computeNextRunAt(now, daily-21:00-Paris) = '2026-03-29T19:00:00.000Z'` (21:00 Paris CEST = 19:00 UTC)
- **2026-10-25 (fall-back Europe/Paris):** `now = '2026-10-24T19:00:00.000Z'` (21:00 Paris CEST); expect `computeNextRunAt(now, daily-21:00-Paris) = '2026-10-25T20:00:00.000Z'` (21:00 Paris CET = 20:00 UTC)

[CITED: src/episodic/sources.ts:74-83 — `dayBoundaryUtc` Luxon idiom (lines 78-82): `DateTime.fromJSDate(date, { zone: tz }).startOf('day')` then `.plus({ days: 1 }).toUTC().toJSDate()`]

### §5 — `RitualConfig` Zod schema exact shape

**8 named fields + `schema_version`** (per CONTEXT.md). Z3 strict-mode pattern (NOT v3/v4 dual — Phase 25 has no SDK boundary):

```typescript
// src/rituals/types.ts
import { z } from 'zod';

/**
 * RitualConfig — bounded, validated config block stored in `rituals.config` jsonb.
 *
 * Per RIT-07: 8 named fields + schema_version. Strict mode rejects unknown fields
 * to prevent silent typos / future-fragility (Pitfall 5 prevention).
 *
 * Mirrors src/episodic/types.ts v3 schema pattern (NOT the v3/v4 dual pattern from
 * src/episodic/consolidate.ts:33-81 — that pattern is needed only at the
 * @anthropic-ai/sdk boundary, which Phase 25 does not touch).
 *
 * Forward-compat: all 4 cadences supported even though Phase 25 ships no monthly/
 * quarterly rituals (TS-10 — M013 may add them).
 */
export const RitualConfigSchema = z.object({
  // 1. Wall-clock fire time in tz (HH:mm format)
  fire_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'fire_at must be HH:mm'),

  // 2. Day-of-week for weekly cadence (ISO 1=Mon..7=Sun); required for weekly
  fire_dow: z.number().int().min(1).max(7).optional(),

  // 3. Voice-note shuffled-bag rotation state (Phase 26 owns; Phase 25 ships schema only)
  prompt_bag: z.array(z.number().int().min(0).max(5)).max(6).optional(),

  // 4. Cadence-aware skip threshold (daily=3, weekly=2 defaults at row creation)
  skip_threshold: z.number().int().min(1).max(10),

  // 5. Self-protective mute (set by adjustment dialogue Phase 28)
  mute_until: z.string().datetime().nullable(),

  // 6. IANA timezone (e.g. 'Europe/Paris')
  time_zone: z.string().min(1),

  // 7. Prompt set version (Phase 26 — defends against future prompt rewording)
  prompt_set_version: z.string().min(1),

  // 8. Schema versioning (this schema is v1; future migration changes bump)
  schema_version: z.literal(1),
}).strict();
// .strict() is the unknown-field rejection per RIT-07 — emits ZodError with
// "Unrecognized key(s) in object" for any extra field

export type RitualConfig = z.infer<typeof RitualConfigSchema>;
```

**Comparison to existing Zod patterns:**
- `src/episodic/consolidate.ts:33-81` uses v3+v4 dual schema BECAUSE the SDK's `zodOutputFormat` requires v4. Phase 25 has NO LLM call → NO SDK boundary → NO v4 mirror needed. Single v3 schema is sufficient and matches `src/episodic/types.ts` patterns.
- `RitualConfigSchema.parse(row.config)` happens at every read boundary (per RIT-07 verbatim "at every read boundary"). The `.strict()` mode is what enforces "rejects unknown fields".
- Defaults like `mute_until: null` and `prompt_bag: []` are NOT set in the schema — the Phase 26-29 ritual seed migrations populate them. Phase 25 only ships the schema; row inserts come later.

[CITED: src/episodic/consolidate.ts:33-81 — v3/v4 dual-schema explanation; src/episodic/types.ts (referenced) — v3-only schema for non-SDK boundaries]

### §6 — Atomic `UPDATE rituals … RETURNING *` SQL

**Exact statement form:**
```sql
UPDATE "rituals"
SET "last_run_at" = now(),
    "next_run_at" = $1   -- newly computed via computeNextRunAt
WHERE "id" = $2
  AND ("last_run_at" IS NULL OR "last_run_at" < $3)  -- $3 = lastObserved
RETURNING *;
```

**Drizzle 0.45 invocation (recommended — type-safe, matches `transitionDecision` shape):**
```typescript
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { rituals } from '../db/schema.js';
import { eq, and, or, isNull, lt } from 'drizzle-orm';

const rows = await db
  .update(rituals)
  .set({ lastRunAt: now, nextRunAt: newNextRunAt })
  .where(
    and(
      eq(rituals.id, ritualId),
      or(
        isNull(rituals.lastRunAt),
        lastObserved ? lt(rituals.lastRunAt, lastObserved) : sql`true`,
      ),
    ),
  )
  .returning();
// rows.length === 1 → fired; rows.length === 0 → race lost (peer sweep already fired)
```

**Alternative (raw SQL via `db.execute(sql\`...\`)`):**
```typescript
const rows = await db.execute(sql`
  UPDATE rituals
  SET last_run_at = ${now}, next_run_at = ${newNextRunAt}
  WHERE id = ${ritualId}
    AND (last_run_at IS NULL OR last_run_at < ${lastObserved})
  RETURNING *
`);
```
The raw SQL is one statement instead of the chain; either is fine. Recommend Drizzle builder for type inference on the returned row.

**Concurrency test mechanism (RIT-10 success criterion 3):**
```typescript
// src/rituals/__tests__/idempotency.test.ts (new file)
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, sql } from '../../db/connection.js';
import { rituals } from '../../db/schema.js';
import { tryFireRitualAtomic } from '../scheduler.js'; // or idempotency.ts
import { eq } from 'drizzle-orm';

describe('atomic UPDATE...RETURNING idempotency', () => {
  let ritualId: string;
  const FIXTURE_NAME = 'idem-test-ritual';

  beforeEach(async () => {
    await db.delete(rituals).where(eq(rituals.name, FIXTURE_NAME));
    const [row] = await db.insert(rituals).values({
      name: FIXTURE_NAME,
      type: 'daily',
      nextRunAt: new Date(Date.now() - 1000), // due now
      enabled: true,
      config: { /* valid RitualConfig */ } as any,
    }).returning();
    ritualId = row!.id;
  });

  afterAll(async () => {
    await db.delete(rituals).where(eq(rituals.name, FIXTURE_NAME));
    await sql.end();
  });

  it('two concurrent invocations produce exactly 1 fired-row return', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const [a, b] = await Promise.all([
      tryFireRitualAtomic(ritualId, null, future),
      tryFireRitualAtomic(ritualId, null, future),
    ]);
    const firedCount = [a.fired, b.fired].filter(Boolean).length;
    expect(firedCount).toBe(1); // ← THE assertion (success criterion 3)
  });
});
```

The test relies on Postgres's row-level locking — when two `UPDATE` statements target the same row simultaneously, Postgres serializes them; the second one sees `last_run_at` already set by the first and the WHERE clause's `last_run_at < $observed` (where `$observed = null` in the test) fails for the second invocation, returning 0 rows.

[CITED: src/decisions/lifecycle.ts (referenced — M007 D-28 transitionDecision optimistic-concurrency pattern)]

### §7 — Ritual channel insertion in `runSweep`

**Exact location in `src/proactive/sweep.ts`:** AFTER the escalation loop (line 336) and BEFORE the "REFLECTIVE CHANNEL" comment (line 338). See §Code Examples Example 6 for verbatim insertion code.

**Sweep ordering (after Phase 25 changes):**
1. Global mute gate (line 85) — `if (await isMuted()) return;`
2. ACCOUNTABILITY channel (lines 94-180) — deadline trigger + write-before-send + cap
3. ESCALATION loop (lines 182-336) — AWAITING_RESOLUTION 48h follow-ups
4. **RITUAL CHANNEL (NEW Phase 25)** — `await runRitualSweep(new Date())` between line 336 and 338
5. REFLECTIVE channel (lines 338-393) — silence + commitment + Opus pattern/thread

**Channel signature:** `runRitualSweep(now: Date): Promise<RitualFireResult[]>` where:
```typescript
type RitualFireOutcome = 'fired' | 'caught_up' | 'muted' | 'race_lost' | 'in_dialogue' | 'config_invalid';

interface RitualFireResult {
  ritualId: string;
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  fired: boolean;
  outcome: RitualFireOutcome;
  error?: unknown;
}
```

**Shared global mute:** Already gated at sweep entry point (line 85). The ritual channel does NOT re-check `isMuted()` because the parent sweep has already gated. The Phase 28 self-protective mute (`config.mute_until` per ritual) is checked INSIDE `runRitualSweep` — distinct from the global mute.

**Independent daily counter (D-04 + per-CONTEXT discretion):** Add a new state KV key `ritual_last_sent_at` peer to existing `accountability_last_sent_at` and `reflective_last_sent_at`. Functions `hasSentTodayRitual(timezone)` + `setLastSentRitual(timestamp)` mirror existing `hasSentTodayReflective` / `setLastSentReflective` shape (state.ts:102+116). The ritual channel checks `hasSentTodayRitual(config.proactiveTimezone)` once per sweep — if true, skip the entire ritual sweep this tick. (This complements the per-tick max-1 cap inside `runRitualSweep` itself.)

[CITED: src/proactive/sweep.ts:79-417 — full runSweep flow; lines 85, 94, 182, 338 for insertion point]
[CITED: src/proactive/state.ts:102-148 — `hasSentTodayReflective` / `setLastSentReflective` pattern to mirror]

### §8 — Cron registration extraction (`registerCrons(deps)` helper)

**Per D-06 — exact signature in §Code Examples Example 4.** Choice of file location:
- **Option A (recommended):** New file `src/cron-registration.ts` — clean separation, testable in isolation, no `src/index.ts` import chain pollution
- **Option B:** In-place extraction inside `src/index.ts` — same `main()` file, function defined above `main()`. Marginally simpler diff but worse for testability (importing it pulls in Express + Grammy + database init chain)

Recommend Option A. Test file: `src/__tests__/cron-registration.test.ts` (or co-located `src/rituals/__tests__/cron-registration.test.ts` — Claude's discretion; recommend the latter since the test asserts the ritual cron specifically).

**Test mechanism (D-05 unit-test side):**
```typescript
// src/rituals/__tests__/cron-registration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scheduleSpy = vi.fn();
vi.mock('node-cron', () => ({
  default: { schedule: scheduleSpy, validate: vi.fn(() => true) },
  schedule: scheduleSpy,
  validate: vi.fn(() => true),
}));

describe('registerCrons', () => {
  beforeEach(() => scheduleSpy.mockClear());

  it('registers the ritual cron at 21:00 Europe/Paris (RIT-11)', async () => {
    const { registerCrons } = await import('../../cron-registration.js');
    const status = registerCrons({
      config: { ritualSweepCron: '0 21 * * *', proactiveSweepCron: '0 10 * * *',
                episodicCron: '0 23 * * *', proactiveTimezone: 'Europe/Paris' } as any,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
    });

    expect(scheduleSpy).toHaveBeenCalledWith(
      '0 21 * * *',
      expect.any(Function),
      { timezone: 'Europe/Paris' },
    );
    expect(status.ritual).toBe('registered');
  });
});
```

**Status map shape consumed by `/health`:** `CronRegistrationStatus = { proactive | ritual | episodic | sync: 'registered' | 'failed' | 'disabled' }`. Module-scoped `cronStatus: CronRegistrationStatus | undefined` set by `main()` and read by `/health` route. See §Code Examples Example 4.

[CITED: src/index.ts:62-119 — main() shape with existing cron blocks; src/index.ts:13-60 — createApp() + /health route shape]

### §9 — `cron.validate` short-circuit at config load

**Exact `src/config.ts` change in §Code Examples Example 3.** Key points:
- Import: `import { validate } from 'node-cron';` ([VERIFIED: node_modules/node-cron/dist/esm/node-cron.d.ts:5 — `export declare function validate(expression: string): boolean;`])
- Helper function `validatedCron(envKey, fallback)` wraps each cron expression
- All three cron expressions go through `validatedCron`: `proactiveSweepCron`, `ritualSweepCron`, `episodicCron`
- Throws `Error("config: invalid ${envKey} expression \"${expr}\"")` on `false` — message format chosen for grep-ability and clear error attribution

**Error message format:** `config: invalid RITUAL_SWEEP_CRON expression "garbage"` (matches `/invalid RITUAL_SWEEP_CRON/` regex in test)

**Test mechanism in §Code Examples Example 3.** Cache-bust trick (`'../config.js?reload=' + Date.now()`) is needed because vitest module cache may have already loaded config.ts; alternative is `vi.resetModules()` before the import.

[VERIFIED: node_modules/node-cron/dist/esm/node-cron.d.ts:5 — validate function signature]

### §10 — `scripts/manual-sweep.ts` shape

**Exact code in §Code Examples Example 5.** Key points:
- Imports `runRitualSweep` from `../src/rituals/scheduler.js` (note the `../src/` prefix and `.js` extension — matches `scripts/backfill-episodic.ts:36-37` pattern)
- Imports `logger` from `../src/utils/logger.js`
- `main()` calls `runRitualSweep(new Date())`, prints `JSON.stringify(results, null, 2)` to stdout
- `process.exit(0)` on success — matches `backfill-episodic.ts:255` pattern
- ESM guard `if (import.meta.url === \`file://${process.argv[1]}\`)` — matches `backfill-episodic.ts:268`
- No try/finally cleanup (D-07 + STATE.md note "safe as-is")

[CITED: scripts/backfill-episodic.ts:233-273 — exact shape to mirror]

### §11 — Test infrastructure for Phase 25

**Tests needed:**

| Test file | Type | Purpose |
|-----------|------|---------|
| `src/rituals/__tests__/types.test.ts` | unit | RitualConfigSchema strict-mode rejection (RIT-07) |
| `src/rituals/__tests__/cadence.test.ts` | unit (property tests) | DST-safe cadence math across 2026-03-29 + 2026-10-25 (RIT-08, Pitfall 2 + 3) |
| `src/rituals/__tests__/idempotency.test.ts` | integration (real Docker) | Atomic UPDATE 2-concurrent-invocation test (RIT-10) |
| `src/rituals/__tests__/scheduler.test.ts` | integration | Per-tick max-1 cap (Pitfall 1), catch-up ceiling, skeleton-handler dispatch (RIT-09) |
| `src/rituals/__tests__/cron-registration.test.ts` | unit (mocked node-cron) | registerCrons spy assertion (RIT-11, D-05) |
| `src/__tests__/config.test.ts` | unit | cron.validate fail-fast (RIT-12 part a) |
| `src/__tests__/health.test.ts` (extends if exists) | integration | `/health` reports `ritual_cron_registered: true` (RIT-12 part b) |
| `src/proactive/__tests__/sweep.test.ts` (regression) | integration | Existing sweep tests still pass with ritual channel inserted (RIT-09) |

**Vitest patterns to mirror:**
- `vi.hoisted` + `vi.mock` mock-graph (TESTING.md §Mocking) — `src/episodic/__tests__/cron.test.ts:54-80` is the canonical example for cron + config mocking
- `vi.setSystemTime` for DST property tests (D-02 — `vi.useFakeTimers` is FORBIDDEN per TESTING.md line 178)
- Per-file fixture source tag for cleanup — `FIXTURE_SOURCE = 'rituals-idempotency'` per TESTING.md §Fixture Patterns
- `beforeAll` DB probe + `afterAll` `sql.end()` per TESTING.md line 141

**AVOID the vitest-4 fork-IPC hang (STATE.md):** New `src/rituals/__tests__/` suites must NOT mock `@huggingface/transformers`-touching modules at runtime. Phase 25 substrate doesn't touch embeddings, so risk is naturally LOW. Verify during Phase 25 Wave 0: `bash scripts/test.sh src/rituals/` should complete in <60s without hanging.

[CITED: .planning/codebase/TESTING.md (full doc) + STATE.md "Open Items"]

### §12 — Pitfall mitigations

| Pitfall | Severity | Phase 25 Mechanism |
|---------|----------|--------------------|
| 1: Ritual storms after cron catch-up | CRITICAL | (a) `LIMIT 1` in `runRitualSweep` SQL query, (b) catch-up ceiling check before fire (advance without firing if `next_run_at > 1 cadence period in past`), (c) `hasSentTodayRitual` channel-level cap |
| 2: DST drift | CRITICAL | `computeNextRunAt` exclusively uses Luxon `DateTime.plus({ days/weeks/months })` + `setZone(tz)` + `.toUTC()`; pinned property tests at 2026-03-29 + 2026-10-25 |
| 3: Cadence drift via `last_run_at + 24h` | CRITICAL | `computeNextRunAt(now, config)` anchors to `config.fire_at` wall-clock target, NEVER reads `last_run_at`; code-review grep `'86_400_000\|setUTCHours\|setHours'` in `src/rituals/` MUST return zero hits |
| 28: Migration 0006 lineage regression | HIGH | (a) HARD CO-LOCATION #7 ships .sql + meta + test.sh in ONE atomic plan, (b) `scripts/regen-snapshots.sh` MUST be extended to handle 0005 + 0006, (c) acceptance gate `npx drizzle-kit generate` MUST print "No schema changes" |

[CITED: .planning/research/PITFALLS.md:15-83, 701-720]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drizzle's `IndexBuilder.where(SQL): this` produces a Postgres partial index syntactically equivalent to `CREATE INDEX ... WHERE enabled = true` | Pattern 2 / §1 | If wrong, the generated SQL is a non-partial index — query planner still works, just larger; not load-bearing. Verified at indexes.d.ts:67 but actual SQL output not test-verified in Phase 25 substrate. Mitigation: visual inspection of regenerated `0006.sql` after `bash scripts/regen-snapshots.sh` |
| A2 | Phase 25 ships SKELETON ritual handlers (Phases 26-29 own real implementation); `runRitualSweep` type-dispatches to `throw new Error('not implemented for ' + ritual.type)` for now | §7, ARCHITECTURE.md Section 7 | If wrong (i.e., Phase 25 must ship a working handler), scope balloons. Reading ROADMAP.md Phase 25 success criteria carefully: criterion 3 only requires `runRitualSweep()` returns `[]` against clean DB — NOT that it dispatches to anything. Skeleton-only is correct |
| A3 | Existing `proactive_state` KV table (already in schema at line 206) can hold `ritual_last_sent_at` keyed by string — no schema change needed for `hasSentTodayRitual` | §7 | If wrong, a new table or column is needed. Verified at schema.ts:206-210 — `proactive_state` is `{ key: varchar(255) PK, value: jsonb, updated_at: timestamptz }` — perfectly suitable for new keys without migration |
| A4 | `scripts/regen-snapshots.sh` extension to handle 0005+0006 in the iterative-replay loop is straightforward (add MIGRATION_5/6 constants, extend the apply sequences) — no fundamental rewrite needed | §2 | If wrong (i.e., the existing 0001/0003 chain-patching logic doesn't generalize), Plan 25-01 grows. Risk is MEDIUM — the script's chain-patching uses fixed UUIDs at fixed positions; extending to 0005+0006 may require similar bespoke handling. Recommend Plan 25-01 budget ~1 day for script modification + acceptance-gate validation |
| A5 | Drizzle 0.45 query builder supports `.update().set().where().returning()` with `or(isNull(col), lt(col, val))` predicate composition | §6 | If wrong, fall back to raw `db.execute(sql\`...\`)`. Drizzle docs confirm builder supports all four; v0.45 has been stable on this surface since v0.30 |
| A6 | Reading `.planning/config.json` shows `nyquist_validation: true` so the Validation Architecture section is required; if it were `false`, the section would be omitted | Validation Architecture section | If config flag is mis-read, section presence/absence is wrong. Verified by direct Read of `.planning/config.json` |
| A7 | The Phase 25 substrate test suite under `src/rituals/__tests__/` won't trigger the env-level vitest-4 fork-IPC hang (HuggingFace EACCES) because no Phase 25 module imports `@huggingface/transformers` directly or transitively | §11 | If wrong, `bash scripts/test.sh src/rituals/` hangs and Phase 25 can't validate. LOW risk — `src/rituals/` is greenfield with explicit imports only from `db`, `config`, `utils/logger`, `proactive/state`, none of which pull `@huggingface/transformers`. Mitigation: confirmed in Wave 0 by running the suite in isolation |

**This list is intentionally short** — the bulk of Phase 25 research is grounded in verified code reads, established codebase patterns (M007 D-28, M008 dayBoundaryUtc, TECH-DEBT-19-01 fix), or locked CONTEXT.md decisions. The 7 assumptions above are MEDIUM-or-lower risk and have explicit mitigation paths.

---

## Open Questions

1. **Does Plan 25-01 need to seed `rituals` table rows for the 3 M009 rituals (daily voice note, daily wellbeing, weekly review)?**
   - What we know: ROADMAP.md success criterion 3 says `runRitualSweep()` returns `[]` against a clean DB without throwing. "Clean DB" implies no seeded ritual rows.
   - What's unclear: Whether Phase 26/27/29 (which OWN those handlers) also OWN the seed migration that inserts the 3 rows, OR Phase 25 ships the seed inserts.
   - Recommendation: **Phase 26/27/29 own their respective ritual seed inserts.** Phase 25 ships table + cadence + scheduler infrastructure ONLY. This keeps Plan 25-01 focused on substrate per HARD CO-LOCATION #7.

2. **Should the per-tick max-1 cap be enforced via SQL `LIMIT 1` or via a `for` loop with `break`?**
   - What we know: Both produce the same observable behavior.
   - What's unclear: Performance and code-review preferences.
   - Recommendation: **`LIMIT 1` in the SQL query.** Cleaner; can't be accidentally broken by a future implementer adding logic between the fetch and the fire. Also matches the partial-index-friendly pattern (the index is `next_run_at WHERE enabled = true` — `ORDER BY next_run_at ASC LIMIT 1` is the index's natural query shape).

3. **What is the appropriate `ritualCount` daily ceiling per CONTEXT.md D-04 "Claude's discretion — channel cap value"?**
   - What we know: Existing accountability/reflective channels use a single send-per-day boolean (`hasSentTodayReflective` / `hasSentTodayAccountability`), NOT a numeric N/day ceiling.
   - What's unclear: Whether ritual channel needs a different model (e.g., 3/day to allow morning wellbeing + evening voice note + occasional weekly review on Sundays).
   - Recommendation: **Match existing pattern: boolean `hasSentTodayRitual` cap (1 ritual fire per channel per local day).** Wait — this CONFLICTS with the M009 spec which fires both wellbeing (09:00) AND voice note (21:00) on the same day. **Revised recommendation:** Either (a) NO daily channel cap — rely on per-tick max-1 cap + per-ritual cadence (each ritual already advances `next_run_at` by 24h after fire, so each ritual is naturally ≤1/day), OR (b) ceiling of 3/day to comfortably accommodate wellbeing + voice note + (rarely) Sunday weekly review on the same day. **Plan 25-03 should resolve this with a `discuss-phase` decision OR pick (a) if no ambiguity.**

---

## Environment Availability

> Phase 25 has minimal external dependencies — all stack already installed. Brief audit:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | All TypeScript code | ✓ (env) | 22 | — |
| PostgreSQL 16 + pgvector | Migration 0006, all DB writes | ✓ via Docker (`docker-compose.local.yml`) | pgvector/pgvector:pg16 | — |
| `node-cron@4.2.1` | RIT-11 cron registration, RIT-12 cron.validate | ✓ | 4.2.1 (exact) | — |
| `luxon@3.7.2` | RIT-08 cadence math | ✓ | 3.7.2 (exact) | — |
| `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10` | Schema + migration generation | ✓ | 0.45.2 / 0.31.10 | — |
| `zod@3.24.0` | RIT-07 RitualConfig schema | ✓ | 3.24.0 | — |
| Docker + Docker Compose | scripts/test.sh, scripts/regen-snapshots.sh | ✓ (env) | — | — |
| `vitest@4.1.x` | Test runner | ✓ | 4.1.x | — |
| `tsx@4.19.x` | Running scripts/manual-sweep.ts | ✓ | 4.19.x | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Sources

### Primary (HIGH confidence — direct file reads, package.json verified)

- `/home/claude/chris/.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` — D-01..D-08 locked decisions, locked plan structure (3 plans), specific implementation choices
- `/home/claude/chris/.planning/REQUIREMENTS.md` — RIT-01..12 verbatim
- `/home/claude/chris/.planning/STATE.md` — vitest-4 fork-IPC hang note, PROC-01/02 verdict, D041 primed-fixture convention
- `/home/claude/chris/.planning/ROADMAP.md` — Phase 25 success criteria 1-3, HARD CO-LOCATION #7
- `/home/claude/chris/.planning/research/SUMMARY.md` — milestone-level synthesis, top 5 pitfalls
- `/home/claude/chris/.planning/research/STACK.md` — zero-version-bump confirmation, anti-recommendations
- `/home/claude/chris/.planning/research/ARCHITECTURE.md` — module shape for `src/rituals/`, sweep insertion point
- `/home/claude/chris/.planning/research/PITFALLS.md` lines 1-90, 700-750 — Pitfalls 1, 2, 3, 27, 28 verbatim
- `/home/claude/chris/.planning/codebase/CONVENTIONS.md` — TS strict ESM, .js suffix, kebab-case, SCREAMING_SNAKE_CASE, Luxon §Timezone Handling
- `/home/claude/chris/.planning/codebase/TESTING.md` — vitest patterns, vi.setSystemTime D-02 rule, fixture-source-tag convention
- `/home/claude/chris/.planning/codebase/STACK.md` — installed deps + versions
- `/home/claude/chris/.planning/codebase/ARCHITECTURE.md` — "Idempotent cron jobs" subsection, `src/index.ts` cron peer pattern
- `/home/claude/chris/.planning/config.json` — `nyquist_validation: true` confirmed
- `/home/claude/chris/src/index.ts` — verified 137-line file, cron registration site at lines 73-96
- `/home/claude/chris/src/config.ts` — verified 50-line file, `proactiveSweepCron`/`episodicCron` env-var pattern at lines 39+48
- `/home/claude/chris/src/db/schema.ts` — verified 341-line file; `epistemicTagEnum` at lines 22-36; `episodicSummaries` table + indexes at lines 319-340; `proactive_state` KV at lines 206-210
- `/home/claude/chris/src/db/migrations/0002_decision_archive.sql` — verified DO block + IF NOT EXISTS pattern at lines 1-22
- `/home/claude/chris/src/db/migrations/0003_add_decision_epistemic_tag.sql` — verified `ALTER TYPE ... ADD VALUE IF NOT EXISTS` shape (1 line)
- `/home/claude/chris/src/db/migrations/0005_episodic_summaries.sql` — verified UNIQUE + CHECK + index shape (16 lines)
- `/home/claude/chris/src/db/migrations/meta/_journal.json` — verified 6-entry journal (0000-0005) for chain shape understanding
- `/home/claude/chris/src/episodic/sources.ts` lines 74-83 — verified `dayBoundaryUtc` Luxon idiom EXACT
- `/home/claude/chris/src/episodic/cron.ts` — verified `runConsolidateYesterday` cron-handler shape; double-catch belt-and-suspenders pattern
- `/home/claude/chris/src/episodic/consolidate.ts` lines 33-81 — verified v3/v4 dual-schema pattern (NOT applicable to Phase 25 — referenced for understanding)
- `/home/claude/chris/src/proactive/sweep.ts` lines 79-417 — verified full runSweep flow, insertion point at line 336/338
- `/home/claude/chris/src/proactive/state.ts` — verified `hasSentTodayReflective`/`setLastSentReflective` pattern at lines 102-148
- `/home/claude/chris/scripts/regen-snapshots.sh` — verified hardcoded MIGRATION_0..MIGRATION_4 constants at lines 52-56; full flow lines 247-345
- `/home/claude/chris/scripts/test.sh` — verified migration apply sequence at lines 8-13, 38-55
- `/home/claude/chris/scripts/backfill-episodic.ts` — verified script pattern (CLI args, exit codes, ESM guard) at lines 1-80, 233-273
- `/home/claude/chris/node_modules/node-cron/dist/esm/node-cron.d.ts` line 5 — verified `export declare function validate(expression: string): boolean;`
- `/home/claude/chris/node_modules/drizzle-orm/pg-core/indexes.d.ts` line 67 — verified `where(condition: SQL): this` on IndexBuilder
- `/home/claude/chris/package.json` — verified versions: `@anthropic-ai/sdk@^0.90.0`, `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10`, `grammy@^1.31.0`, `luxon@^3.7.2`, `node-cron@^4.2.1`, `zod@^3.24.0`

### Secondary (MEDIUM confidence — research synthesis grounded in primary)

- `.planning/research/FEATURES.md` (referenced via SUMMARY.md) — TS-9..TS-16 mapping
- `.planning/research/PITFALLS.md` lines 88-700 (other pitfalls referenced for context — Phase 25 doesn't address)

### Tertiary (LOW confidence — none flagged)

None — all Phase 25 substrate decisions are grounded in either CONTEXT.md (locked), existing code patterns (verified by file read), or established Pitfall mitigations.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against `package.json` + npm registry; zero new deps per STACK.md
- Architecture: HIGH — every insertion point + pattern verified by file read against existing source
- Pitfalls: HIGH — Phase 25's 4 pitfalls (1, 2, 3, 28) are anchored to either prior failures (TECH-DEBT-19-01) or canonical patterns (Luxon `dayBoundaryUtc`, M007 D-28 atomic UPDATE)
- SQL specifics: HIGH — exact CREATE TABLE statements grounded in 0002 + 0005 conventions; Drizzle 0.45 partial-index support verified at the type definition level
- Test infrastructure: HIGH — patterns mirror existing `src/episodic/__tests__/cron.test.ts` and `src/episodic/__tests__/consolidate.test.ts`; vi.setSystemTime usage compliant with D-02

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (30 days — substrate phase, low velocity of change in core dependencies)

---

## RESEARCH COMPLETE

Phase 25 substrate is fully scoped and grounded. All 12 focus areas answered with verified code references. Plan 25-01 (atomic substrate), Plan 25-02 (pure helpers), and Plan 25-03 (process boundaries) can be authored from this research without ambiguity. The single notable operational gotcha — `scripts/regen-snapshots.sh` is hardcoded for migrations 0001-0004 and MUST be extended to handle 0005 + 0006 in Plan 25-01 — is explicitly flagged in §2 with file/line evidence.

Planner can proceed.
