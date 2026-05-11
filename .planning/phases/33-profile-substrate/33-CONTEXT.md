# Phase 33: Profile Substrate - Context

**Gathered:** 2026-05-11 (via `/gsd-discuss-phase --auto`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 33 ships the **persistence + read substrate** for M010 operational profiles. After this phase:

- Migration 0012 has applied to a fresh Docker Postgres: five new tables exist (`profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family`, `profile_history`)
- Each profile table has a single sentinel row (`name = 'primary'`) inserted at migration time, seeded from `src/pensieve/ground-truth.ts` where ground-truth facts exist
- `src/memory/profiles.ts` exports `getOperationalProfiles()` that returns the four profile rows as typed structured data (never throws)
- Zod v3 + v4 dual schemas exist for all four profile shapes in `src/memory/profiles/schemas.ts`
- `src/memory/confidence.ts` exists with `MIN_ENTRIES_THRESHOLD = 10` and the pure-function confidence helpers (used by Phase 34 generators)

**Explicitly NOT in this phase:** Sonnet calls, generators, weekly cron, mode-handler injection, `/profile` command, synthetic-fixture tests. Those are Phases 34-36.

**Inter-phase coupling:** Zero downstream dependency. Phase 35 mode handlers can begin wiring against `getOperationalProfiles()` as soon as Phase 33 ships, even before Phase 34's generators exist (rows return seeded ground-truth data with low confidence; mode handlers gracefully omit injection when confidence=0).

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M010 research pass (STACK + FEATURES + ARCHITECTURE + PITFALLS, synthesized in SUMMARY.md). The `--auto` flag locked each at the recommended option. The planner should treat them as the contract surface and validate via the success criteria in ROADMAP.md Phase 33 entry.

### Migration shape

- **D-01: Migration 0012 is hand-authored SQL.** Drizzle-kit generates DDL from `src/db/schema.ts`; the hand-authored migration appends the seed-row `INSERT` statements (drizzle-kit cannot model seed inserts). Same pattern as v2.4 migrations 0006-0011. Naming: `src/db/migrations/0012_operational_profiles.sql`.
- **D-02: Five tables in one migration.** `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family`, `profile_history` all ship in 0012. Single migration = single drizzle meta snapshot regeneration = single `scripts/test.sh` psql line update. Splitting into multiple migrations adds lineage complexity for no semantic benefit (PITFALL precedent: HARD CO-LOC #M10-1 from PITFALLS M010-11).
- **D-03: HARD CO-LOC #M10-1 atomic plan.** Migration SQL + `src/db/schema.ts` table definitions + drizzle meta snapshot regen + `scripts/test.sh` psql apply line + `scripts/regen-snapshots.sh` cleanup-flag update all ship in ONE plan. Splitting any of these reproduces the TECH-DEBT-19-01 lineage break.

### Profile table schema (each of the 4 profile tables)

- **D-04: Sentinel-row pattern.** Every profile table has `name text NOT NULL UNIQUE DEFAULT 'primary'`. Single row per table by application convention; the `name` column is the `ON CONFLICT (name) DO UPDATE` target for Phase 34's weekly upsert. Per ARCHITECTURE Q7. This allows future named snapshots (M013/M014 differentiator DIFF-3) without a schema change.
- **D-05: Non-retrofittable columns ship in 0012.** `schema_version int NOT NULL DEFAULT 1` and `substrate_hash text` MUST be in the initial migration. Retrofitting either later requires backfill + deployment-window coordination per PITFALL M010-11. PROF-01 + PROF-03 both lock this.
- **D-06: Confidence type is `real` with CHECK constraint.** `confidence real NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1)`. Postgres `real` matches Zod `z.number()` semantics; `numeric` would require explicit precision/scale and parsing edge cases.
- **D-07: jsonb columns default to `'[]'` for arrays and `'{}'` for objects.** Never NULL — simplifies the Zod parse + makes "no data" semantically distinguishable from "field never written" (impossible state).
- **D-08: `last_updated timestamptz` + `created_at timestamptz`** with `DEFAULT now()`. `last_updated` is bumped on every upsert by the generator; `created_at` is set once at migration seed time.

### Seed-row strategy (PROF-03)

- **D-09: Ground-truth seeding at migration time, NOT no-seed.** The PROF-03 requirement locks this; ARCHITECTURE Q7 raised a "phantom row" concern, but the concern is mitigated because the Phase 34 generator's threshold check looks at `entryCount` (Pensieve+episodic) not at row existence. Day-1 UX: Greg sees a partial profile (~0.2-0.3 confidence) from known facts instead of "insufficient data" everywhere.
- **D-10: Ground-truth mapping (locked by inspection of `src/pensieve/ground-truth.ts:24-63`).**
  - `profile_jurisdictional` seeds: `current_location` from ground-truth `current_location`; `residency_statuses` from `nationality` (French) + `residency_panama` + `business_georgia` (Georgian Individual Entrepreneur implies tax residency); `next_planned_move` from `next_move`; `planned_move_date` parsed from `next_move` ("from 2026-04-28"); confidence ~0.3 (4 of ~7 typical fields populated)
  - `profile_capital` seeds: `fi_target` from `fi_target` ($1,500,000); legal entities (`business_us`, `business_georgia`) into the structured "entities" field; confidence ~0.2 (1 explicit financial fact)
  - `profile_health` seeds: empty rows with confidence=0, fields = `'insufficient data'` markers (no ground-truth health facts)
  - `profile_family` seeds: same as health — empty + confidence=0 (no ground-truth family facts)
- **D-11: Seed row uses `substrate_hash = ''` (empty string, not NULL).** The first Phase 34 cron fire computes a new substrate hash; comparison to `''` always evaluates as "changed" → triggers the first generation. This guarantees the cron always replaces the seed row with an inferred profile on first fire (assuming threshold met).

### Reader API (PROF-04)

- **D-12: Never-throw contract.** `getOperationalProfiles()` returns `{ jurisdictional: T | null, capital: T | null, health: T | null, family: T | null }`. On DB error: per-profile null + `logger.warn` with the error message. Mirrors `src/pensieve/retrieve.ts` pattern. Consumer-side null handling: mode handlers omit the injection block; `/profile` shows "insufficient data".
- **D-13: Schema parse failures return null per profile, not throw.** If a profile row has `schema_version != 1` or jsonb shape doesn't match the v3 Zod schema, the reader logs a `'chris.profile.read.schema_mismatch'` warn and returns null for that profile. Defends against future schema migrations that haven't propagated to all rows yet (PITFALL M010-11).
- **D-14: File location:** `src/memory/profiles.ts` (the reader API + types) + `src/memory/profiles/schemas.ts` (the four Zod v3/v4 dual schemas). The `profiles/` subdirectory is reserved for Phase 34's per-dimension generators.

### Zod schemas (PROF-05)

- **D-15: One schemas.ts file for all four profile shapes, not per-profile sibling files.** Mirrors `src/rituals/types.ts` consolidation pattern. Each profile gets a v3 schema (validates at read boundary) and a v4 schema (consumed by `zodOutputFormat` at the Sonnet boundary in Phase 34). The v3/v4 dual is required by the SDK per M009 precedent (D-29-02 in v2.4 RETROSPECTIVE).
- **D-16: schema_version semantics.** Bump only on BREAKING jsonb shape changes (renamed field, removed field, changed type). Additive fields keep version=1. Reader tolerates `schema_version > 1` by returning null + warn until the consumer migration completes.

### profile_history table (PROF-02)

- **D-17: Shared history table with `profile_table_name` discriminator.** ONE `profile_history` table for all four profile dimensions: `id uuid pk` + `profile_table_name text NOT NULL` (one of: `jurisdictional`/`capital`/`health`/`family`) + `profile_id uuid NOT NULL` + `snapshot jsonb NOT NULL` + `recorded_at timestamptz DEFAULT now()`. Single table = single index = simpler migration. This is the INTERNAL idempotency primitive (write-before-upsert pre-image), distinct from the user-facing DIFF-3 deferred to M013/M014.
- **D-18: profile_history is write-only in Phase 33.** No reader API for it. Phase 34's generator writes a snapshot row before each upsert. Phase 33 just creates the table + ships it in migration 0012.

### Confidence helper module (PROF substrate dependency)

- **D-19: `src/memory/confidence.ts` is a Phase 33 deliverable, not Phase 34.** Even though GEN-05 references it in Phase 34, the pure-function helpers (`MIN_ENTRIES_THRESHOLD = 10`, `SATURATION = 50`, `computeProfileConfidence(entryCount, dataConsistency)`, `isAboveThreshold(entryCount)`) ship in Phase 33 because: (a) they're substrate, not inference; (b) the reader's null-handling in D-12/D-13 may reference the threshold; (c) unit-testable in Phase 33 without any Phase 34 dependencies. Cross-phase REQ: GEN-05 partially satisfied by Phase 33 substrate; Phase 34 consumes it.

### Claude's Discretion

- **Exact jsonb field names within each profile.** The M010 spec lists fields informally (e.g., jurisdictional: "current location, residency statuses, tax structures, next planned move, planned move date"). The planner should lock the exact JSON shape per profile based on FEATURES.md §2.1-2.4 canonical-fields tables. Tradeoff: matching the FEATURES.md shapes exactly vs simplifying to what ground-truth.ts can seed today.
- **Profile-history snapshot serialization.** Whether `snapshot jsonb` stores the entire profile row (including `id`/`name`/`schema_version`) or just the user-facing fields. Recommend: full row including metadata, so the snapshot is replayable as an exact prior state.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### M010 Research (locked decisions)
- `.planning/research/SUMMARY.md` — consolidated M010 research summary; phase-ownership map for all 11 pitfalls; locked architecture decisions
- `.planning/research/STACK.md` — zero new dependencies; `.$type<T>()` Drizzle pattern; v3+v4 Zod dual schemas; `src/memory/confidence.ts` extraction
- `.planning/research/FEATURES.md` — §2.1-2.4 canonical fields per profile dimension (used to derive jsonb column shapes); §3.2 confidence calibration model
- `.planning/research/ARCHITECTURE.md` — Q1 cron-vs-ritual, Q2 generator structure (Phase 34), Q4 reader API shape, Q7 migration design (Phase 33-relevant)
- `.planning/research/PITFALLS.md` — M010-11 schema_version cannot be retrofitted, M010-10 substrate_hash second-fire blindness, M010-06 shared-prompt drift (Phase 34), M010-07 formatter regression (Phase 35)

### Project specs
- `M010_Operational_Profiles.md` (project root) — original milestone spec (legacy "John" → "Greg" naming applies to all code/requirements)
- `.planning/PROJECT.md` — Key Decisions D004 (append-only Pensieve), D005 (never-throw fire-and-forget), D029 (M009 ships before profiles), D034 (episodic_summaries 8-cols locked), D041 (primed-fixture pipeline supersedes calendar wait)
- `.planning/REQUIREMENTS.md` — PROF-01..05 are this phase's contract

### Codebase substrate (existing patterns to mirror)
- `src/db/schema.ts` — existing 11-migration schema; profile tables added here with `.$type<T>()` jsonb columns
- `src/db/migrations/0006_rituals_wellbeing.sql` — most-similar migration precedent (multi-table + jsonb + sentinel-row pattern via UNIQUE constraint)
- `src/db/migrations/meta/_journal.json` — append new entry for 0012 (HARD CO-LOC: Phase 32 #3 monotonic-`when` CI guardrail validates the timestamp)
- `src/pensieve/ground-truth.ts` — 13 entries; D-10 mapping table above shows which seed which profile
- `src/pensieve/retrieve.ts` — exemplar of the never-throw + log-warn pattern that PROF-04 follows
- `src/rituals/types.ts` — exemplar of v3/v4 dual Zod schema consolidation pattern that PROF-05 mirrors
- `src/chris/personality.ts:43-60` — `buildKnownFactsBlock()` shows the existing GROUND_TRUTH usage pattern; the seed-row mapping in D-10 should produce profile data that doesn't double-up with the Known Facts block
- `scripts/test.sh:65-80` — sequential `psql ... < $MIGRATION_N_SQL` block; Migration 0012 line appended here
- `scripts/regen-snapshots.sh` — drizzle meta regen script; existing acceptance-gate cleanup flag (`REGEN_PRODUCED_ACCEPTANCE`) bumped from `0011*.json` to `0012*.json`
- `scripts/validate-journal-monotonic.ts` (Phase 32 #3) — runs in `scripts/test.sh` BEFORE migrations apply; will catch any stale `when` value in the new 0012 journal entry

### M009 reference patterns (similar shape phases)
- `.planning/milestones/v2.4-phases/25-ritual-scheduling-foundation-process-gate/25-01-PLAN.md` — most-similar plan precedent (migration + drizzle meta + scripts/test.sh psql line ATOMIC); Phase 33 plan 1 should mirror this structure
- `.planning/milestones/v2.4-phases/29-weekly-review/29-01-SUMMARY.md` — most-similar substrate-before-inference phase (Phase 29 pure-function substrate before Phase 29-02 LLM wiring); validates the Phase 33→34 split shape

</canonical_refs>

<deferred>
## Deferred Ideas (out of M010 scope)

None surfaced in this discussion. All scope-creep candidates were already filtered by the FEATURES research (DIFF-1..7 → v2.5.1/M013; ANTI-1..7 → permanently excluded).

</deferred>

<code_context>
## Codebase Context (from scout pass)

### Reusable assets
- **Migration substrate**: 11 migrations in `src/db/migrations/0000..0011` + drizzle meta snapshots + journal monotonic-`when` guardrail (Phase 32 #3). Migration 0012 follows the same shape; new file `0012_operational_profiles.sql` + `meta/0012_snapshot.json` + `_journal.json` entry.
- **Schema add-table pattern**: `src/db/schema.ts:rituals` (M009) and `src/db/schema.ts:wellbeingSnapshots` are the closest matches — both have jsonb fields, sentinel-like name columns, and DEFAULT constraints.
- **`.$type<T>()` jsonb typing**: drizzle-orm 0.45.2 supports compile-time inference for jsonb columns. STACK research confirms versions current; no upgrade needed.
- **Never-throw reader pattern**: `src/pensieve/retrieve.ts:retrieveContext` shows the per-source null + log-warn pattern PROF-04 mirrors.
- **v3/v4 dual Zod**: `src/rituals/types.ts` shows `RitualConfigSchema` (v3) consumed at parse boundary + `RitualConfigSchemaV4` mirror consumed at SDK boundary. Profile schemas follow the same pattern.
- **Ground-truth source**: `src/pensieve/ground-truth.ts:24-63` is the seed data source. The migration's seed-row INSERTs hardcode the values (compile-time-resolved at migration-write time, not at runtime).
- **Confidence module location**: `src/memory/` is the right directory for `confidence.ts` (sibling to `conversation.ts`, `context-builder.ts`, `relational.ts`).

### Integration points
- **Migration 0012 → scripts/test.sh** — append psql line at the end of the existing chain (line ~80 currently for migration 0011).
- **`_journal.json` → scripts/validate-journal-monotonic.ts** — Phase 32 #3 guardrail catches stale `when` values; new entry must have `when >= entries[11].when`.
- **`schema.ts` → drizzle meta** — `scripts/regen-snapshots.sh` regenerates `meta/0012_snapshot.json` after schema changes. Acceptance-gate cleanup flag bumped one slot (per M009 D-26-01-C precedent).
- **`src/memory/profiles.ts` → Phase 35 mode handlers** — REFLECT/COACH/PSYCHOLOGY will import `getOperationalProfiles` in Phase 35. The stub returning seed data is sufficient for Phase 35 wiring before Phase 34 generators exist.

### Patterns to follow
- **Conventional commits + atomic migration plan**: `feat(33-01): migration 0012 substrate + schema + drizzle meta + psql line` (mirrors `feat(25-01)`).
- **HARD CO-LOC enforcement**: the plan-checker (gsd-plan-checker) MUST refuse a plan that splits the migration SQL from the drizzle meta from the scripts/test.sh psql line.
- **Idempotent SQL**: All `INSERT` statements use `ON CONFLICT (name) DO NOTHING` so re-running the migration against an already-seeded DB is a no-op (M009 0007-0009 precedent).
- **Plan-checker hooks**: `bash scripts/test.sh src/db/__tests__/migration-0012.test.ts` is the acceptance gate (mirrors M009's per-migration test).

</code_context>

<test_strategy>
## Test Strategy

Three layers ship in Phase 33 (no Sonnet calls, no LLM tests — those are Phase 34/36):

1. **Migration smoke gate** in `scripts/test.sh` (after `psql ... < 0012`): assert via SQL that all 5 tables exist, all 4 profile tables have exactly 1 row with `name = 'primary'`, jurisdictional + capital seed values match `src/pensieve/ground-truth.ts`. Mirrors the M009 "✓ Migration 0006 substrate verified" gate.
2. **Unit tests** for `src/memory/confidence.ts`: `computeProfileConfidence(0, 0)` → 0; `computeProfileConfidence(10, 1.0)` → ~0.2; `computeProfileConfidence(50, 1.0)` → ~1.0; `isAboveThreshold(9)` → false; `isAboveThreshold(10)` → true.
3. **Integration tests** for `src/memory/profiles.ts` against real Docker Postgres: `getOperationalProfiles()` returns all 4 seeded rows when DB is fresh (post-migration); returns per-profile null on DB error (`db.execute` throws — caught by never-throw contract); `parseProfile` rejects invalid jsonb shapes via Zod and returns null with warn log.

The Phase 34 substrate-hash idempotency + Phase 36 synthetic-fixture tests are NOT in Phase 33 scope — they require generators that don't exist yet.

</test_strategy>

<plan_hints>
## Plan Structure Hint

Recommended plan split for Phase 33 (~2 plans, matches ROADMAP estimate):

- **Plan 33-01: Migration 0012 substrate (HARD CO-LOC #M10-1 ATOMIC)** — Migration SQL + schema.ts table definitions + drizzle meta snapshot + scripts/test.sh psql line + scripts/regen-snapshots.sh cleanup-flag bump + migration smoke gate. Satisfies PROF-01, PROF-02, PROF-03. ~6 tasks. The Phase 25-01 atomic-migration plan is the precedent.
- **Plan 33-02: Reader API + Zod schemas + confidence module** — `src/memory/profiles.ts` (getOperationalProfiles never-throw), `src/memory/profiles/schemas.ts` (v3+v4 dual for all 4 profile shapes), `src/memory/confidence.ts` (pure functions + constants), unit tests + integration tests. Satisfies PROF-04, PROF-05, GEN-05 (substrate portion). ~5 tasks.

Total: 11 tasks across 2 plans. Manageable single-session per plan.

</plan_hints>
