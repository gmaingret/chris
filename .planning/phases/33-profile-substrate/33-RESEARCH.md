# Phase 33: Profile Substrate — Research

**Researched:** 2026-05-11
**Domain:** Drizzle schema + hand-authored migration SQL + drizzle-kit meta lineage + Postgres seed inserts + Zod v3/v4 dual schemas + pure-function confidence helpers + never-throw reader API
**Confidence:** HIGH — every recommendation is grounded in direct inspection of the 12 prior migrations, the locked decisions in `33-CONTEXT.md`, and the M010 research artifacts already validated during `/gsd-new-milestone`.

## Summary

Phase 33 is the persistence-and-read substrate for M010. It ships migration 0012 (5 tables), the `name='primary'` sentinel + `schema_version` + `substrate_hash` non-retrofittable columns, four ground-truth-seeded initial rows + four empty health/family rows + zero `profile_history` rows, the never-throw `getOperationalProfiles()` reader, the v3+v4 Zod dual schemas for all four profile shapes, and `src/memory/confidence.ts` pure-function helpers. Zero Sonnet calls. Zero user-visible features. Zero new dependencies.

The phase is unusual only in two ways. First: it has a HARD CO-LOCATION constraint (M10-1) that forces migration SQL + `src/db/schema.ts` table defs + `migrations/meta/0012_snapshot.json` regen + `_journal.json` entry + `scripts/test.sh` psql apply line + `scripts/regen-snapshots.sh` cleanup-flag bump into a single atomic plan. Second: the non-retrofittable column set is wider than usual — `schema_version`, `substrate_hash`, `name='primary'` sentinel — because each pitfall (M010-11, M010-09, M010-03 respectively) becomes deployment-window expensive if retrofitted.

**Primary recommendation:** Adopt the two-plan split locked in `33-CONTEXT.md` `<plan_hints>` — **Plan 33-01** is the atomic migration plan (PROF-01/02/03 + smoke gate); **Plan 33-02** is the pure-TypeScript reader/schemas/confidence module (PROF-04/05 + unit & integration tests). All of Phase 33's actual research questions have been pre-answered by `/gsd-discuss-phase --auto` in `33-CONTEXT.md`. The unknowns that remain are mechanical (exact `_journal.json` `when` timestamp; exact `0012_snapshot.json` regen flow; exact ground-truth-row INSERT SQL serialization) and are covered below.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migration shape**
- **D-01: Migration 0012 is hand-authored SQL.** Drizzle-kit generates DDL from `src/db/schema.ts`; the hand-authored migration appends the seed-row `INSERT` statements (drizzle-kit cannot model seed inserts). Same pattern as v2.4 migrations 0006-0011. Naming: `src/db/migrations/0012_operational_profiles.sql`.
- **D-02: Five tables in one migration.** `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family`, `profile_history` all ship in 0012. Single migration = single drizzle meta snapshot regeneration = single `scripts/test.sh` psql line update.
- **D-03: HARD CO-LOC #M10-1 atomic plan.** Migration SQL + `src/db/schema.ts` table definitions + drizzle meta snapshot regen + `scripts/test.sh` psql apply line + `scripts/regen-snapshots.sh` cleanup-flag update all ship in ONE plan.

**Profile table schema (each of the 4 profile tables)**
- **D-04: Sentinel-row pattern.** Every profile table has `name text NOT NULL UNIQUE DEFAULT 'primary'`. Single row per table by application convention; the `name` column is the `ON CONFLICT (name) DO UPDATE` target for Phase 34's weekly upsert. Allows future named snapshots (M013/M014 DIFF-3) without a schema change.
- **D-05: Non-retrofittable columns ship in 0012.** `schema_version int NOT NULL DEFAULT 1` and `substrate_hash text` MUST be in the initial migration. PROF-01 + PROF-03 both lock this.
- **D-06: Confidence type is `real` with CHECK constraint.** `confidence real NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1)`.
- **D-07: jsonb columns default to `'[]'` for arrays and `'{}'` for objects.** Never NULL.
- **D-08: `last_updated timestamptz` + `created_at timestamptz`** with `DEFAULT now()`.

**Seed-row strategy (PROF-03)**
- **D-09: Ground-truth seeding at migration time, NOT no-seed.** PROF-03 locks this; ARCHITECTURE Q7's "phantom row" concern is mitigated because the Phase 34 generator's threshold check looks at `entryCount` (Pensieve+episodic) not at row existence.
- **D-10: Ground-truth mapping** (locked by inspection of `src/pensieve/ground-truth.ts:24-63`):
  - `profile_jurisdictional` seeds: `current_location`, `residency_statuses` from `nationality` + `residency_panama` + `business_georgia`; `next_planned_move` from `next_move`; `planned_move_date` parsed from `next_move`; confidence ~0.3
  - `profile_capital` seeds: `fi_target`; legal entities (`business_us`, `business_georgia`) into "entities" field; confidence ~0.2
  - `profile_health` seeds: empty rows with confidence=0, fields = `'insufficient data'` markers
  - `profile_family` seeds: same as health — empty + confidence=0
- **D-11: Seed row uses `substrate_hash = ''`** (empty string, not NULL).

**Reader API (PROF-04)**
- **D-12: Never-throw contract.** `getOperationalProfiles()` returns `{ jurisdictional: T | null, capital: T | null, health: T | null, family: T | null }`. On DB error: per-profile null + `logger.warn`. Mirrors `src/pensieve/retrieve.ts`.
- **D-13: Schema parse failures return null per profile, not throw.** `schema_version != 1` or jsonb shape mismatch → `'chris.profile.read.schema_mismatch'` warn + null for that profile.
- **D-14: File location:** `src/memory/profiles.ts` (reader API + types) + `src/memory/profiles/schemas.ts` (the four Zod v3/v4 dual schemas). The `profiles/` subdirectory is reserved for Phase 34's per-dimension generators.

**Zod schemas (PROF-05)**
- **D-15: One schemas.ts file for all four profile shapes**, not per-profile sibling files. Mirrors `src/rituals/types.ts` consolidation pattern. Each profile gets a v3 schema (read boundary) and a v4 schema (Phase 34 SDK boundary via `zodOutputFormat`). M009 D-29-02 precedent.
- **D-16: schema_version semantics.** Bump only on BREAKING jsonb shape changes. Additive fields keep version=1. Reader tolerates `schema_version > 1` by returning null + warn.

**profile_history table (PROF-02)**
- **D-17: Shared history table with `profile_table_name` discriminator.** ONE `profile_history` table for all four profile dimensions: `id uuid pk` + `profile_table_name text NOT NULL` + `profile_id uuid NOT NULL` + `snapshot jsonb NOT NULL` + `recorded_at timestamptz DEFAULT now()`. INTERNAL idempotency primitive, distinct from the user-facing DIFF-3 deferred to M013/M014.
- **D-18: profile_history is write-only in Phase 33.** No reader API. Phase 34 writes a snapshot row before each upsert. Phase 33 just creates the table.

**Confidence helper module**
- **D-19: `src/memory/confidence.ts` is a Phase 33 deliverable.** Pure-function helpers (`MIN_ENTRIES_THRESHOLD = 10`, `SATURATION = 50`, `computeProfileConfidence(entryCount, dataConsistency)`, `isAboveThreshold(entryCount)`).

### Claude's Discretion

- **Exact jsonb field names within each profile** — planner should lock the exact JSON shape per profile based on FEATURES.md §2.1-2.4 canonical-fields tables. Tradeoff: matching FEATURES.md exactly vs simplifying to what ground-truth.ts can seed today.
- **Profile-history snapshot serialization** — whether `snapshot jsonb` stores the entire profile row (including `id`/`name`/`schema_version`) or just user-facing fields. **Recommend: full row including metadata**, so the snapshot is replayable as exact prior state.

### Deferred Ideas (OUT OF SCOPE)

None surfaced in this discussion. All scope-creep candidates were already filtered by the FEATURES research during `/gsd-new-milestone`. The 7 DIFF items and 7 ANTI items were locked there; this phase stays within PROF-01..05.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROF-01 | Migration 0012 creates four profile tables — each with `id` uuid pk, `last_updated` timestamptz, `confidence` 0.0–1.0, `schema_version` int NOT NULL DEFAULT 1, `substrate_hash` text, plus profile-specific jsonb columns | §"Standard Stack" + §"Architecture Patterns" §1 Migration shape + §3 Schema columns; precedent migration 0006 |
| PROF-02 | Migration 0012 also creates `profile_history` table (id, profile_table_name, profile_id, snapshot jsonb, recorded_at) | §"Architecture Patterns" §3 — single shared table with `profile_table_name` discriminator |
| PROF-03 | Initial profile rows seeded from `src/pensieve/ground-truth.ts` at migration time | §"Architecture Patterns" §4 Seed-row strategy + §"Code Examples" — verbatim INSERTs with hardcoded values |
| PROF-04 | `src/memory/profiles.ts` exports `getOperationalProfiles()` returning typed `{ jurisdictional, capital, health, family }`; never-throw contract | §"Architecture Patterns" §5 + §"Code Examples" §"Never-Throw Reader" — mirrors `src/pensieve/retrieve.ts` pattern |
| PROF-05 | Zod v3 + v4 dual schemas for all four profile shapes in `src/memory/profiles/schemas.ts` | §"Architecture Patterns" §6 + §"Code Examples" §"Dual v3/v4 Schemas" — mirrors `src/rituals/weekly-review.ts` precedent |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Profile table DDL | Database (PostgreSQL 16) | — | Append-only data layer; pgvector irrelevant for profile tables |
| Profile row UPSERT (Phase 34 only) | Database | App (Drizzle) | Drizzle `onConflictDoUpdate` is the canonical pattern; SQL constraint enforces uniqueness on `(name)` |
| Initial row seeding | Database (migration SQL) | — | Migration time is the only authoritative seed moment; runtime seeds risk race-with-cron |
| Ground-truth → profile mapping | Build-time (migration author) | — | Values are compile-time-resolved at migration-write time, hardcoded into SQL literals, NOT read from `ground-truth.ts` at runtime |
| Schema versioning | Database column + App registry | — | `schema_version int` is data; the parser registry (`PROFILE_SCHEMAS[1] = SchemaV1`) is code |
| Reader API never-throw contract | App (Node.js + Drizzle) | — | Pure runtime concern; DB sees only the SELECT |
| Zod v3 validation (read boundary) | App | — | Defends against future-schema drift on JSONB rows |
| Zod v4 schemas (deferred to Phase 34 use) | App | — | Phase 33 ships the v4 shapes ready for `zodOutputFormat()` consumption next phase |
| Pure-function confidence helpers | App (pure TS) | — | No DB, no LLM, no async — single-source-of-truth math |

## Standard Stack

### Core (already installed — zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | ^0.45.2 [VERIFIED: package.json:19] | Table definitions in `src/db/schema.ts`; `jsonb().$type<T>()` typed columns | Already used for all 11 prior migrations; `.$type<T>()` is supported in 0.45.2 but unused so far — Phase 33 introduces it |
| `drizzle-kit` | ^0.31.10 [VERIFIED: package.json] | Meta snapshot generation via `scripts/regen-snapshots.sh` | Existing acceptance-gate flow; HARD CO-LOC #M10-1 forces same-plan regen |
| `zod` | ^3.24.0 [VERIFIED: package.json:32] | v3 schemas at read boundary in `src/memory/profiles/schemas.ts` | M006+ established; `.refine()` available for cross-field invariants |
| `zod/v4` (sub-path) | bundled with zod ^3.24.0 [VERIFIED: 3 files import it — `src/rituals/adjustment-dialogue.ts:28`, `src/rituals/weekly-review.ts:36`, `src/episodic/consolidate.ts:33`] | v4 schemas for Phase 34's `zodOutputFormat()` consumption — Phase 33 ships them but does not call SDK | Required by `@anthropic-ai/sdk` — M009 D-29-02 |
| `pino` (via `src/utils/logger.ts`) | (project-internal) | `logger.warn` for never-throw read failures | Existing project pattern |

### Supporting (verified present, used by Phase 33)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.1.2 [VERIFIED: package.json:46] | Unit tests for `confidence.ts` + integration tests for `profiles.ts` against Docker Postgres | All tests; existing `scripts/test.sh` orchestrator |
| `@vitest/coverage-v8` | ^4.1.2 [VERIFIED: package.json:42] | Coverage on `confidence.ts` pure functions | Standard project pattern |
| Postgres 16 `gen_random_uuid()` | built-in | UUID pk default in profile tables | All 11 prior migrations use this |
| Postgres 16 `now()` | built-in | `last_updated` + `created_at` defaults | Migration 0006 precedent |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `jsonb().$type<T>()` in `schema.ts` | Untyped `jsonb()` with cast at read site | `.$type<T>()` gives compile-time inference at Drizzle query results; no runtime difference. **Use `.$type<T>()`** — STACK.md confirmed support in 0.45.2 [VERIFIED: node_modules/drizzle-orm/pg-core/columns/json.d.ts]. |
| Per-profile sibling schema files (`schemas/jurisdictional.ts`, etc.) | One consolidated `schemas.ts` | Consolidation matches `src/rituals/types.ts`; planner already locked D-15 |
| Four separate `profile_history_*` tables | Single shared `profile_history` with `profile_table_name` discriminator | Single table = single index = simpler migration (D-17 locked) |
| `numeric(3,2)` for confidence | `real CHECK (>= 0 AND <= 1)` | `numeric` requires explicit precision/scale + Drizzle parsing edge cases; `real` matches Zod `z.number()` natively (D-06 locked) |
| `NULL` jsonb defaults | `'[]'::jsonb` / `'{}'::jsonb` defaults | Non-null defaults simplify Zod parse + remove "impossible state" (D-07 locked) |

**No installation step required.** All dependencies are present at the correct versions. Phase 33 introduces zero `npm install` calls.

**Version verification (executed 2026-05-11):**
- `drizzle-orm` ^0.45.2 — present in `package.json:19` [VERIFIED]
- `zod` ^3.24.0 with `zod/v4` sub-path — verified in 3 source files [VERIFIED]
- `vitest` ^4.1.2 [VERIFIED]

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 33: Substrate Layer (no LLM, no user-visible surface)              │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  Migration 0012 (hand-authored SQL)                                    │ │
│  │   ├─ 5 × CREATE TABLE … schema_version + substrate_hash + name UNIQUE │ │
│  │   ├─ 4 × INSERT INTO profile_<dim> ('primary', seeded jsonb, confidence) │
│  │   └─ 0 × INSERT INTO profile_history (write-only in Phase 34)         │ │
│  │      (idempotent via ON CONFLICT (name) DO NOTHING)                    │ │
│  └──────────────┬───────────────────────────────────────────────────────┘ │
│                 │ applied at startup by Drizzle migrator                  │
│                 │ AND by `scripts/test.sh` psql apply chain               │
│                 ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  Postgres (5 new tables, FK-free in Phase 33)                      │     │
│  │   profile_jurisdictional ◀┐                                        │     │
│  │   profile_capital        ◀┼─ schema_version=1, substrate_hash='', │     │
│  │   profile_health         ◀┤   name='primary' (single row each)    │     │
│  │   profile_family         ◀┘                                        │     │
│  │   profile_history (empty in Phase 33)                              │     │
│  └────────┬────────────────────────────────────────────────────────┘     │
│           │ SELECT (read-only in Phase 33)                                 │
│           ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  src/memory/profiles.ts — getOperationalProfiles()                │     │
│  │   ├─ SELECT each profile table WHERE name='primary'              │     │
│  │   ├─ Zod v3 parse each row → schema_version dispatch              │     │
│  │   ├─ schema_version != 1  → null + 'chris.profile.read.schema_mismatch' │
│  │   ├─ DB error             → null per profile + logger.warn      │     │
│  │   └─ Return { jurisdictional, capital, health, family }           │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  src/memory/profiles/schemas.ts (v3 + v4 dual, all 4 dims)        │     │
│  │   JurisdictionalProfileSchemaV3 + ...V4 (zod/v4 mirror)           │     │
│  │   CapitalProfileSchemaV3 + ...V4                                  │     │
│  │   HealthProfileSchemaV3 + ...V4                                   │     │
│  │   FamilyProfileSchemaV3 + ...V4                                   │     │
│  │   (v4 schemas unused in Phase 33; Phase 34 wires zodOutputFormat) │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  src/memory/confidence.ts (pure functions, zero deps)             │     │
│  │   MIN_ENTRIES_THRESHOLD = 10                                      │     │
│  │   SATURATION = 50                                                 │     │
│  │   computeProfileConfidence(entryCount, dataConsistency)           │     │
│  │   isAboveThreshold(entryCount)                                    │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│  Phase 34 enters here ──────────► (not built in Phase 33)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 33 additions)

```
src/
├── db/
│   ├── schema.ts                              # ADD: 5 pgTable definitions with .$type<T>()
│   └── migrations/
│       ├── 0012_operational_profiles.sql      # NEW: hand-authored DDL + seed INSERTs
│       └── meta/
│           ├── _journal.json                  # APPEND: 12th entry, monotonic `when`
│           └── 0012_snapshot.json             # NEW: regenerated by scripts/regen-snapshots.sh
├── memory/
│   ├── profiles.ts                            # NEW: getOperationalProfiles() never-throw reader
│   ├── profiles/
│   │   ├── schemas.ts                         # NEW: v3+v4 dual schemas for all 4 dims
│   │   └── __tests__/                          # NEW: schemas.test.ts (Zod parse/reject)
│   ├── confidence.ts                          # NEW: pure-function helpers
│   ├── __tests__/
│   │   ├── confidence.test.ts                  # NEW: unit tests
│   │   └── profiles.test.ts                    # NEW: integration tests against Docker Postgres
│   └── (existing) conversation.ts, relational.ts, context-builder.ts
└── (no other dirs touched in Phase 33)

scripts/
├── test.sh                                    # EDIT: add MIGRATION_12_SQL + psql apply line + smoke gate
└── regen-snapshots.sh                         # EDIT: bump REGEN_PRODUCED_ACCEPTANCE cleanup flag 0012→0013
```

### Pattern 1: Hand-authored migration SQL with idempotency guards

**What:** Migration 0012 is hand-written `.sql` with `CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT (name) DO NOTHING`. drizzle-kit generates the meta snapshot from `schema.ts`, NOT the raw SQL.

**When to use:** Any migration that needs seed-row INSERTs or non-trivial DDL drizzle-kit cannot model (e.g., `DO $$ BEGIN ... EXCEPTION` blocks for enums). All 7 of migrations 0005–0011 used this pattern.

**Example:** See §"Code Examples" below for the full Migration 0012 template.

**Source:** `src/db/migrations/0006_rituals_wellbeing.sql` [VERIFIED via Read] — the closest structural precedent: multi-table CREATE + UNIQUE constraints + jsonb columns + idempotent via `IF NOT EXISTS`.

### Pattern 2: Sentinel-row UPSERT pattern

**What:** Single-row-per-table convention enforced by `name text NOT NULL UNIQUE DEFAULT 'primary'`. Future-proof for M013/M014 named snapshots (e.g., `name = '2026-Q3-baseline'`) without schema change.

**When to use:** Singleton tables that may someday hold named historical snapshots. Phase 34 generators upsert via `ON CONFLICT (name) DO UPDATE`.

**Source:** D-04 locked decision. Distinct from `src/proactive/state.ts` which uses a `key text` PK (key-value pattern) — the profile sentinel pattern uses `id uuid pk` + `name unique` because future named snapshots will have distinct UUIDs.

### Pattern 3: `schema_version` + Zod dispatcher

**What:** Every JSONB-bearing row carries `schema_version int NOT NULL DEFAULT 1`. The reader maintains a registry `PROFILE_SCHEMAS: Record<number, ZodSchema>`. Unknown versions return null (never throw) so a future M011 schema change doesn't crash existing readers.

**When to use:** Any table with evolving JSONB shape that may outlive its schema generation (operational profiles will).

**Source:** PITFALLS.md §M010-11 [VERIFIED via Read]. The pattern is novel for this codebase — M008 episodic_summaries does NOT use schema_version (single-version table). Phase 33 introduces this pattern for the first time.

### Pattern 4: `substrate_hash` column for write-side idempotency

**What:** `substrate_hash text` column shipped in Phase 33 migration; written by Phase 34 generator before upsert. Phase 33 seeds it as `''` (empty string) — guarantees first-fire writes always replace seeded data.

**When to use:** Cron-driven write paths where double-fire is possible. Mitigates M010-09 (M009 `lt→lte` class of bug).

**Source:** D-11 locked decision + PITFALLS.md §M010-09. Phase 33 only ships the column; semantic enforcement is Phase 34.

### Pattern 5: Never-throw reader with per-profile null

**What:** `getOperationalProfiles()` returns `{ jurisdictional: T | null, capital: T | null, health: T | null, family: T | null }`. On DB error: warn-and-return-all-null. On per-profile schema mismatch: warn-and-return-null-for-that-profile.

**When to use:** Read paths that participate in fire-and-forget / never-throw contracts (D005). Profile injection in Phase 35 mode handlers expects per-profile null, not a thrown error.

**Source:** `src/pensieve/retrieve.ts:50-114` [VERIFIED via Read] — `searchPensieve` and `getTemporalPensieve` both demonstrate the wrapping `try { ... } catch (error) { logger.warn(...); return EMPTY; }` pattern.

### Pattern 6: Zod v3 + v4 dual schemas

**What:** Each of the 4 profile shapes has a v3 schema (project default, used at the read boundary) AND a v4 mirror (`import * as zV4 from 'zod/v4'`) ready for Phase 34 to pass to `anthropic.messages.parse({ output_config: { format: zodOutputFormat(v4Schema) } })`. v4 mirrors omit `.refine()`.

**When to use:** Anywhere the Anthropic SDK consumes a schema. The SDK demands v4 at runtime; project code prefers v3 for refinements.

**Source:** `src/rituals/weekly-review.ts:36` [VERIFIED via grep] + `src/episodic/consolidate.ts:33` [VERIFIED] + `src/rituals/adjustment-dialogue.ts:28` [VERIFIED] — three established precedents. M009 D-29-02 locks this as mandatory at SDK boundaries.

### Anti-Patterns to Avoid

- **Reading `ground-truth.ts` from migration SQL.** Migration 0012 hardcodes literal values from `ground-truth.ts:24-63` at *migration-write time*. The migration MUST NOT `IMPORT` or attempt to read the TypeScript file — SQL has no module system. If `ground-truth.ts` changes later, that's a manual re-author of a new migration, not a re-read.
- **Using drizzle-kit `generate` for the migration SQL.** drizzle-kit cannot model seed-row INSERTs. Hand-author the SQL; let drizzle-kit produce only the `meta/0012_snapshot.json` from `schema.ts`. Same split used in migrations 0006–0011.
- **Adding FK constraints to `profile_history.profile_id`.** The shared `profile_history` table has a discriminator column (`profile_table_name`) and a `profile_id` referencing one of FOUR different tables. A single FK is impossible (Postgres doesn't support polymorphic FK). Leave `profile_id` unconstrained at the SQL level; enforce app-level via Phase 34's `assembleProfilePrompt` invariants.
- **Throwing from `getOperationalProfiles()` on any failure path.** D-12 contract is absolute. Even unexpected exception (e.g., Drizzle parse error on `confidence` column) → catch + warn + per-profile null.
- **Returning a single null when all four are null.** The return shape is `{ jurisdictional: null, capital: null, health: null, family: null }` even when all four fail — NOT `null`. Phase 35 mode handlers check per-profile, not whole-result.
- **Eagerly throwing on Zod parse failure inside the dispatcher.** `PROFILE_SCHEMAS[schema_version]?.safeParse()` (not `.parse()`) is the contract: `.success === false` → warn + null, never throw.
- **Adding indexes to profile tables in Phase 33.** Each profile table holds exactly 1 row (sentinel pattern). An index on `name UNIQUE` is created by the constraint itself; no additional indexes needed. `profile_history` may need a (profile_table_name, recorded_at DESC) index in Phase 34 when reads begin — but Phase 33 ships zero rows in `profile_history`, so the index is deferred to its first use.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONB column TypeScript types | A custom `JsonbValue<T>` wrapper | `jsonb('col').$type<T>()` from drizzle-orm | Built-in 0.45.2 feature; gives compile-time inference free [VERIFIED: STACK.md §2 + node_modules/drizzle-orm/pg-core/columns/json.d.ts] |
| Zod v3 → v4 conversion | An adapter function | Two separate schemas + `import * as zV4 from 'zod/v4'` | 3 codebase precedents [VERIFIED via grep]; M009 D-29-02 lock |
| Migration meta snapshot | Hand-edit `0012_snapshot.json` | `bash scripts/regen-snapshots.sh` | Drizzle-kit produces byte-stable JSON; hand-edits drift from `schema.ts` and break `drizzle-kit generate` acceptance gate [VERIFIED: regen-snapshots.sh] |
| Migration ordering validation | Custom check in test setup | `npx tsx scripts/validate-journal-monotonic.ts` (already in `scripts/test.sh`) | Phase 32 #3 guardrail; catches stale `when` typos in `_journal.json` [VERIFIED: scripts/test.sh:46] |
| Idempotent migration on cold start | Wrap every CREATE in pre-existence check manually | `CREATE TABLE IF NOT EXISTS` + `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object` | Postgres-native; precedent migration 0006 [VERIFIED via Read] |
| Per-profile-row never-throw wrapper | Custom result-type plumbing | Inline `try/catch { logger.warn; return null }` mirroring `src/pensieve/retrieve.ts` | Project precedent; D005 fire-and-forget contract |
| Pure-function confidence math | A "confidence library" or Bayesian framework | `src/memory/confidence.ts` (15 lines of TS) | Single-user heuristic; M010 spec is the algorithm of record [CITED: STACK.md §5] |
| Initial-row seed orchestration | A separate seed script (`scripts/seed-profiles.ts`) | Inline `INSERT` statements in migration 0012 | Migration time is the only authoritative seed moment; precedent migrations 0007/0008/0009 all do this [VERIFIED via ls] |
| Schema-version dispatcher | A custom version-routing helper | `Record<number, ZodSchema>` literal in `profiles.ts` | One-line registry pattern; PITFALLS.md §M010-11 example |
| Telegram bot integration testing | Custom mocking | Phase 33 has zero bot surface — Phase 35 owns this | Out of scope |

**Key insight:** Every component in Phase 33 has a named M008/M009 precedent. Phase 33 introduces ONE new code pattern (`jsonb().$type<T>()`) and ONE new architectural pattern (`schema_version` + Zod dispatcher). Everything else is mechanical replication of existing patterns at a new file/table name.

## Runtime State Inventory

**Trigger:** Phase 33 is a *greenfield substrate* phase (new tables, new files, no renames). Per Step 2.5 trigger condition (rename / refactor / migration string-replacement), this section is technically not required. However, the phase ships a **schema migration** which has its own runtime-state surface area worth surfacing for the planner:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Production Postgres at 192.168.1.50** — has no `profile_*` tables (migration 0012 is new). | None — fresh CREATE; migration is forward-only. |
| Stored data | **Test Docker Postgres (port 5433)** — recreated on every `scripts/test.sh` run via `docker compose down --timeout 5 && up -d` in cleanup trap. | None — fresh DB each test run. |
| Stored data | **Regen Docker Postgres (port 5434, project chris-regen)** — used by `scripts/regen-snapshots.sh`; recreated each invocation. | None. |
| Live service config | None applicable to Phase 33. (No external service registration.) | None — verified by inspecting `.planning/STATE.md` and external service list. |
| OS-registered state | **Production server cron** — Phase 33 does NOT register a cron (Phase 34 does). Migration auto-applies on container restart via Drizzle migrator. | None — production deploy in Phase 33 is just "container restart picks up new migration." |
| Secrets/env vars | None new. `proactiveTimezone` env var is reused by Phase 34. Phase 33 reads no new env vars. | None. |
| Build artifacts | **`migrations/meta/0012_snapshot.json`** is generated and committed; tied to `schema.ts` state. If `schema.ts` evolves without regen, drizzle-kit generate's acceptance gate fails. | Plan-checker must verify `scripts/regen-snapshots.sh` was run before commit. |
| Build artifacts | **`migrations/meta/_journal.json`** new entry — monotonic-`when` validator catches stale timestamps. | Migration author must use `Date.now()` (or a value greater than `1778041174550`, the migration 0011 `when`) for the new entry. |

**Specific risk for Plan 33-01:** the regen-snapshots cleanup-flag bump (`REGEN_PRODUCED_ACCEPTANCE` cleanup in `scripts/regen-snapshots.sh`) must move from "post-0011 = 0012" to "post-0012 = 0013" — otherwise a re-run of the regen script after Phase 33 lands will DELETE the committed `0012_snapshot.json`. This is the same class of bug that Phase 25 documented in the script header comments.

## Common Pitfalls

### Pitfall 1: Stale `_journal.json` `when` value
**What goes wrong:** Hand-authored migrations sometimes use a copy-pasted `when` timestamp from a prior entry. Result: monotonic ordering breaks, drizzle migrator applies migrations out of order.
**Why it happens:** Each entry's `when` is a UNIX ms epoch. The 0011 entry has `when: 1778041174550`. A planner who mechanically copies the structure may also copy the timestamp.
**How to avoid:** Migration 0012 `when` MUST be `> 1778041174550`. The simplest correct value is `Date.now()` at journal-edit time (will be ~`1778800000000` in May 2026). Phase 32 #3 guardrail catches this — `scripts/validate-journal-monotonic.ts` runs BEFORE migrations apply in `scripts/test.sh` [VERIFIED: scripts/test.sh:46-49].
**Warning signs:** `scripts/test.sh` fails at "Verifying migrations journal monotonicity" step.
**Source:** [VERIFIED: scripts/validate-journal-monotonic.ts + scripts/test.sh inline comment]

### Pitfall 2: Forgetting `scripts/regen-snapshots.sh` cleanup-flag bump
**What goes wrong:** The cleanup trap in `regen-snapshots.sh` deletes a "post-acceptance-gate generated snapshot" identified by hardcoded filename. After Phase 33 lands, the script's hardcoded `0012_snapshot.json` cleanup target must shift to `0013_snapshot.json` — otherwise a future regen run wipes the committed Phase 33 snapshot.
**Why it happens:** The script is byte-stable across N migrations because each N+1 bumps the cleanup target. Phase 25 / 26 / 27 / 28 / 29 / 31 each bumped this. Missing the bump in Phase 33 produces a destructive regen on the next run.
**How to avoid:** Read `scripts/regen-snapshots.sh` lines 113-137 [VERIFIED]; locate the `0012_snapshot.json` cleanup reference and bump to `0013_snapshot.json`. Acceptance-gate apply chain (line ~330) must also append `apply_sql "${MIGRATION_12}"` — the same pattern as the existing 0..11 chain.
**Warning signs:** Re-running `bash scripts/regen-snapshots.sh` after Phase 33 ships produces a `0012_snapshot.json` diff in `git status` (script regenerated and deleted in the cleanup trap).
**Source:** [VERIFIED: scripts/regen-snapshots.sh:113-137 + acceptance gate at line ~330]

### Pitfall 3: Migration SQL `INSERT` collisions on test rerun
**What goes wrong:** `scripts/test.sh` applies migrations sequentially with `psql -v ON_ERROR_STOP=1`. If migration 0012's seed `INSERT` is not `ON CONFLICT (name) DO NOTHING`, a partial-prior-apply state (e.g., test re-run after manual psql poke) raises "duplicate key" and the entire test suite aborts.
**Why it happens:** Migrations 0007 / 0008 / 0009 already established this pattern explicitly. New migrations sometimes forget it.
**How to avoid:** Every `INSERT INTO profile_<dim>` MUST end with `ON CONFLICT (name) DO NOTHING`. Reference: migration 0007 daily_voice_note_seed [VERIFIED via ls].
**Warning signs:** `scripts/test.sh` aborts at the migration 0012 apply step on a re-run.
**Source:** [VERIFIED: PITFALLS.md §M010-09 + migration 0006 precedent]

### Pitfall 4: Drizzle `jsonb().$type<T>()` runtime mismatch with Zod schema
**What goes wrong:** `.$type<T>()` is a compile-time annotation only — Drizzle does NOT validate the JSONB shape at SELECT time. A row written with shape A but read with `.$type<B>()` succeeds at the Drizzle layer and crashes at the consumer.
**Why it happens:** The TS type system is gulled by `.$type<T>()`. Phase 33's contract requires that EVERY profile row goes through a Zod v3 `safeParse()` between the Drizzle SELECT and the consumer return — Zod is the runtime contract.
**How to avoid:** Never trust `.$type<T>()` for runtime. `getOperationalProfiles()` MUST call `PROFILE_SCHEMAS[row.schema_version]?.safeParse(row)` on every read. Drizzle is for compile-time inference; Zod is for runtime enforcement.
**Warning signs:** Tests pass with `pnpm typecheck` but the integration test `profiles.test.ts` fails on a deliberately-mutated jsonb shape.
**Source:** [CITED: STACK.md §2 + PITFALLS.md §M010-11]

### Pitfall 5: Reader API throws on a Drizzle-level failure (not Zod)
**What goes wrong:** The reader catches Zod parse errors but lets Drizzle errors (e.g., connection drop, query timeout) bubble up.
**Why it happens:** The `try/catch` is placed around the `safeParse` only, not around the entire `db.select()` invocation.
**How to avoid:** The try/catch boundary in `getOperationalProfiles()` MUST wrap the entire function body, AND each profile's `safeParse` separately, so per-profile mismatch only nulls one profile while a DB-level failure nulls all four. Mirror the structure of `src/pensieve/retrieve.ts:retrieveContext` [VERIFIED via Read].
**Warning signs:** Integration test where the DB connection is killed mid-call: reader throws instead of returning all-null.
**Source:** [VERIFIED: src/pensieve/retrieve.ts pattern + D-12 locked decision]

### Pitfall 6: `schema_version != 1` rows hit a default branch instead of returning null
**What goes wrong:** `PROFILE_SCHEMAS[row.schema_version]` is `undefined` for `version: 999`. If the code does `PROFILE_SCHEMAS[row.schema_version].safeParse(row)`, this throws `TypeError: cannot read 'safeParse' of undefined` — defeats the never-throw contract.
**Why it happens:** Object-index access in TS without an explicit undefined check.
**How to avoid:** Use `const parser = PROFILE_SCHEMAS[row.schema_version]; if (!parser) { logger.warn(...); return null; }` — same pattern Phase 36 unit test will assert.
**Warning signs:** Test "schema_version=999 returns null without throwing" (PROF-05 success criterion) fails.
**Source:** [VERIFIED: D-13 + PITFALLS.md §M010-11]

### Pitfall 7: Forgetting one of the 5 tables in the smoke-gate assertion
**What goes wrong:** `scripts/test.sh` smoke gate counts created tables. If the assertion uses `WHERE table_name IN ('profile_jurisdictional', 'profile_capital', 'profile_health', 'profile_family')` it MISSES `profile_history`. A migration that creates only 4 tables (missing history) passes the gate.
**Why it happens:** Easy to overlook the discriminator table. PROF-02 is a separate requirement from PROF-01.
**How to avoid:** Smoke gate SQL must assert `COUNT(*) = 5` for the IN-list with all 5 table names. Mirror the migration 0006 smoke gate that asserts "6 tables + 1 enum value + 3 indexes" [VERIFIED: scripts/test.sh line ~103].
**Source:** [VERIFIED: scripts/test.sh existing smoke-gate pattern + PROF-02 requirement]

### Pitfall 8: Seeded ground-truth values diverge from `src/pensieve/ground-truth.ts`
**What goes wrong:** Migration SQL hardcodes `'Saint Petersburg, Russia (until 2026-04-28)'`. Someone updates `ground-truth.ts` later but forgets the migration. Day-1 seed and ground-truth runtime block now disagree.
**Why it happens:** The values are duplicated by design (SQL has no module system; migrations are write-once). Future ground-truth edits don't automatically propagate.
**How to avoid:** Add a comment header to migration 0012 documenting "values copied from ground-truth.ts:24-63 as of 2026-05-11. Future ground-truth edits do NOT automatically propagate to seeded profile rows — that's the Phase 34 generator's job." This makes the dual-source-of-truth explicit and surfaces the maintenance contract.
**Warning signs:** `buildKnownFactsBlock` injection (personality.ts:153) shows fact "X" but `/profile` (Phase 35) shows fact "Y" — user reports discrepancy.
**Source:** [VERIFIED: src/chris/personality.ts:43-60 buildKnownFactsBlock + ground-truth.ts:24-63]

## Code Examples

### Migration 0012 Template (hand-authored SQL)

```sql
-- Phase 33 (M010 v2.5) — Operational Profiles substrate.
-- HARD CO-LOCATION #M10-1: this migration SQL + src/db/schema.ts table defs +
-- migrations/meta/0012_snapshot.json + scripts/test.sh psql apply line +
-- scripts/regen-snapshots.sh cleanup-flag bump all ship in ONE plan.
--
-- Non-retrofittable columns (PITFALLS M010-09/10/11):
--   - schema_version int NOT NULL DEFAULT 1  (M010-11 — Zod evolution)
--   - substrate_hash text NOT NULL DEFAULT ''  (M010-09 — Phase 34 idempotency)
--   - name text NOT NULL UNIQUE DEFAULT 'primary'  (M010-03 — Phase 34 upsert target)
--
-- Seed-row values copied from src/pensieve/ground-truth.ts:24-63 as of 2026-05-11.
-- Future ground-truth edits do NOT propagate to these rows — Phase 34 cron does.

CREATE TABLE IF NOT EXISTS "profile_jurisdictional" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE DEFAULT 'primary',
    "schema_version" integer NOT NULL DEFAULT 1,
    "substrate_hash" text NOT NULL DEFAULT '',
    "confidence" real NOT NULL DEFAULT 0,
    "current_location" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "residency_statuses" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "next_planned_move" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "profile_jurisdictional_confidence_bounds" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);
--> statement-breakpoint
-- (Repeat for profile_capital, profile_health, profile_family with their
--  dimension-specific jsonb columns — exact shapes locked by the planner
--  against FEATURES.md §2.1-2.4 canonical-fields tables)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "profile_table_name" text NOT NULL,
    "profile_id" uuid NOT NULL,
    "snapshot" jsonb NOT NULL,
    "recorded_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Seed-row INSERTs — idempotent via ON CONFLICT (name) DO NOTHING.
-- profile_jurisdictional: confidence ~0.3 (4 of ~7 typical fields seeded from ground-truth)
INSERT INTO "profile_jurisdictional"
    ("name", "schema_version", "substrate_hash", "confidence",
     "current_location", "residency_statuses", "next_planned_move")
VALUES
    ('primary', 1, '', 0.3,
     '{"city": "Saint Petersburg", "country": "Russia", "until": "2026-04-28"}'::jsonb,
     '[{"type": "nationality", "value": "French"},
        {"type": "permanent_residency", "value": "Panama"},
        {"type": "business_residency", "value": "Georgian Individual Entrepreneur"}]'::jsonb,
     '{"destination": "Batumi, Georgia", "from_date": "2026-04-28"}'::jsonb)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint

-- profile_capital: confidence ~0.2 (1 explicit financial fact: fi_target)
INSERT INTO "profile_capital" (...) VALUES (..., 0.2, ...) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint

-- profile_health + profile_family: confidence = 0, "insufficient data" markers
INSERT INTO "profile_health"
    ("name", "schema_version", "substrate_hash", "confidence", "open_hypotheses", ...)
VALUES
    ('primary', 1, '', 0, '[]'::jsonb, ...)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint

INSERT INTO "profile_family" (...) VALUES (..., 0, ...) ON CONFLICT (name) DO NOTHING;
```

**Source:** Synthesized from `src/db/migrations/0006_rituals_wellbeing.sql` (structural template) + `src/db/migrations/0007_daily_voice_note_seed.sql` (seed-row INSERT pattern) + `src/pensieve/ground-truth.ts:24-63` (seed values) [all VERIFIED via Read].

### `src/db/schema.ts` additions (Drizzle table defs)

```typescript
// At top of src/db/schema.ts (existing imports already cover these)
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
  ProfileSnapshot,
} from '../memory/profiles/schemas.js';

export const profileJurisdictional = pgTable(
  'profile_jurisdictional',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    currentLocation: jsonb('current_location').$type<JurisdictionalProfileData['currentLocation']>().notNull().default(sql`'{}'::jsonb`),
    residencyStatuses: jsonb('residency_statuses').$type<JurisdictionalProfileData['residencyStatuses']>().notNull().default(sql`'[]'::jsonb`),
    nextPlannedMove: jsonb('next_planned_move').$type<JurisdictionalProfileData['nextPlannedMove']>().notNull().default(sql`'{}'::jsonb`),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_jurisdictional_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  ],
);
// Repeat for profileCapital, profileHealth, profileFamily.

export const profileHistory = pgTable('profile_history', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
  profileTableName: text('profile_table_name').notNull(),
  profileId: uuid('profile_id').notNull(),
  snapshot: jsonb('snapshot').$type<ProfileSnapshot>().notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Source:** Synthesized from existing `src/db/schema.ts` patterns (jsonb defaults at line 376 `config: jsonb('config').notNull().default(sql\`'{}'::jsonb\`)` [VERIFIED]) + STACK.md §2 (the `.$type<T>()` pattern that's new to this codebase).

### v3 + v4 dual schemas (`src/memory/profiles/schemas.ts`)

```typescript
import { z } from 'zod';
import * as zV4 from 'zod/v4';

// ── v3 schemas (used at the read boundary in getOperationalProfiles) ─────────

export const JurisdictionalProfileSchemaV3 = z.object({
  currentLocation: z.object({
    city: z.string().nullable(),
    country: z.string().nullable(),
    until: z.string().nullable(),
  }).strict(),
  residencyStatuses: z.array(z.object({
    type: z.string(),
    value: z.string(),
    since: z.string().optional(),
  }).strict()).max(10),
  nextPlannedMove: z.object({
    destination: z.string().nullable(),
    from_date: z.string().nullable(),
  }).strict(),
  data_consistency: z.number().min(0).max(1),  // populated by Phase 34; Phase 33 seed rows write 0
}).strict();
export type JurisdictionalProfileData = z.infer<typeof JurisdictionalProfileSchemaV3>;

// Same shape repeated for CapitalProfileSchemaV3, HealthProfileSchemaV3, FamilyProfileSchemaV3.

// ── v4 mirrors (used by Phase 34 zodOutputFormat; Phase 33 ships them unused) ─

export const JurisdictionalProfileSchemaV4 = zV4.object({
  currentLocation: zV4.object({
    city: zV4.string().nullable(),
    country: zV4.string().nullable(),
    until: zV4.string().nullable(),
  }),
  residencyStatuses: zV4.array(zV4.object({
    type: zV4.string(),
    value: zV4.string(),
    since: zV4.string().optional(),
  })).max(10),
  nextPlannedMove: zV4.object({
    destination: zV4.string().nullable(),
    from_date: zV4.string().nullable(),
  }),
  data_consistency: zV4.number().min(0).max(1),
});
// v4 mirrors omit .strict() per M009 D-29-02 (the SDK does not parse strict-mode JSON Schema)
```

**Source:** Pattern matches `src/rituals/types.ts` v3 schema [VERIFIED via Read] + `src/rituals/weekly-review.ts:36` v4 import [VERIFIED via grep]. Exact field names per Claude's-discretion item locked against FEATURES.md §2.1-2.4 [CITED].

### Never-throw reader (`src/memory/profiles.ts`)

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  profileJurisdictional,
  profileCapital,
  profileHealth,
  profileFamily,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  JurisdictionalProfileSchemaV3,
  CapitalProfileSchemaV3,
  HealthProfileSchemaV3,
  FamilyProfileSchemaV3,
  type JurisdictionalProfileData,
  type CapitalProfileData,
  type HealthProfileData,
  type FamilyProfileData,
} from './profiles/schemas.js';

export interface ProfileRow<T> {
  data: T;
  confidence: number;
  lastUpdated: Date;
  schemaVersion: number;
}

export interface OperationalProfiles {
  jurisdictional: ProfileRow<JurisdictionalProfileData> | null;
  capital: ProfileRow<CapitalProfileData> | null;
  health: ProfileRow<HealthProfileData> | null;
  family: ProfileRow<FamilyProfileData> | null;
}

const PROFILE_SCHEMAS = {
  jurisdictional: { 1: JurisdictionalProfileSchemaV3 },
  capital: { 1: CapitalProfileSchemaV3 },
  health: { 1: HealthProfileSchemaV3 },
  family: { 1: FamilyProfileSchemaV3 },
} as const;

async function readOneProfile<T>(
  dimension: 'jurisdictional' | 'capital' | 'health' | 'family',
  table: typeof profileJurisdictional | typeof profileCapital | typeof profileHealth | typeof profileFamily,
): Promise<ProfileRow<T> | null> {
  try {
    const rows = await db.select().from(table).where(eq(table.name, 'primary')).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    const parser = PROFILE_SCHEMAS[dimension][row.schemaVersion as 1];
    if (!parser) {
      logger.warn(
        { dimension, schemaVersion: row.schemaVersion },
        'chris.profile.read.schema_mismatch',
      );
      return null;
    }
    const parsed = parser.safeParse(row);  // .safeParse, never .parse — never throw
    if (!parsed.success) {
      logger.warn(
        { dimension, error: parsed.error.message },
        'chris.profile.read.schema_mismatch',
      );
      return null;
    }
    return {
      data: parsed.data as T,
      confidence: row.confidence,
      lastUpdated: row.lastUpdated,
      schemaVersion: row.schemaVersion,
    };
  } catch (error) {
    logger.warn(
      { dimension, error: error instanceof Error ? error.message : String(error) },
      'chris.profile.read.error',
    );
    return null;
  }
}

export async function getOperationalProfiles(): Promise<OperationalProfiles> {
  const [jurisdictional, capital, health, family] = await Promise.all([
    readOneProfile('jurisdictional', profileJurisdictional),
    readOneProfile('capital', profileCapital),
    readOneProfile('health', profileHealth),
    readOneProfile('family', profileFamily),
  ]);
  return { jurisdictional, capital, health, family } as OperationalProfiles;
}
```

**Source:** Synthesized from `src/pensieve/retrieve.ts:50-114` (the never-throw wrapping pattern [VERIFIED]) + D-12 / D-13 (locked never-throw contract) + ARCHITECTURE.md Q4 (reader API shape locked) [CITED].

### Pure-function confidence helpers (`src/memory/confidence.ts`)

```typescript
/**
 * Phase 33 (M010 v2.5) — Confidence math substrate.
 *
 * Pure functions, zero deps. Consumed by Phase 34 generators (GEN-05). Shipped
 * in Phase 33 (D-19) because confidence math is substrate, not inference; and
 * because the reader's null-handling may reference the threshold (D-12/D-13).
 *
 * SATURATION = 50 is a first-estimate; tune in v2.5.1 after 4–8 weeks of real
 * M010 cron operation. Tuning is one-line edit + downstream tests; no caller
 * change.
 */

export const MIN_ENTRIES_THRESHOLD = 10;
export const SATURATION = 50;

/**
 * Compute the storable confidence value for a profile based on the count of
 * relevant Pensieve+episodic entries and Sonnet's self-reported data
 * consistency (0.0–1.0) for the substrate.
 *
 * Algorithm (verbatim from STACK.md §5):
 *   if entryCount < 10                → 0.0
 *   else volumeScore = min(1.0, (entryCount - 10) / (SATURATION - 10))
 *        return round((0.3 + 0.7 * volumeScore * dataConsistency) * 100) / 100
 */
export function computeProfileConfidence(
  entryCount: number,
  dataConsistency: number,
): number {
  if (entryCount < MIN_ENTRIES_THRESHOLD) return 0;
  const volumeScore = Math.min(1.0, (entryCount - MIN_ENTRIES_THRESHOLD) / (SATURATION - MIN_ENTRIES_THRESHOLD));
  return Math.round((0.3 + 0.7 * volumeScore * dataConsistency) * 100) / 100;
}

export function isAboveThreshold(entryCount: number): boolean {
  return entryCount >= MIN_ENTRIES_THRESHOLD;
}
```

**Source:** Verbatim from STACK.md §5 [CITED] + D-19 (locked Phase 33 ownership).

### `scripts/test.sh` additions (smoke-gate template)

```bash
# After applying $MIGRATION_12_SQL:

# Phase 33 (M010 v2.5) — operational profiles substrate smoke gate.
# HARD CO-LOCATION #M10-1: this gate ships in the SAME plan as the migration
# SQL + drizzle meta snapshot + schema.ts table defs. Failure exits BEFORE
# vitest (mirrors Phase 25 0006 substrate gate at line ~103).
echo "🔍 Verifying migration 0012 substrate..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_name IN ('profile_jurisdictional', 'profile_capital',
                          'profile_health', 'profile_family',
                          'profile_history')) AS table_count,
      (SELECT COUNT(*) FROM profile_jurisdictional WHERE name = 'primary') AS jur_seed,
      (SELECT COUNT(*) FROM profile_capital WHERE name = 'primary') AS cap_seed,
      (SELECT COUNT(*) FROM profile_health WHERE name = 'primary') AS hea_seed,
      (SELECT COUNT(*) FROM profile_family WHERE name = 'primary') AS fam_seed,
      (SELECT COUNT(*) FROM profile_history) AS hist_seed;
  " | tee /tmp/m010_smoke.txt
grep -q "^5|1|1|1|1|0$" /tmp/m010_smoke.txt || { echo "❌ Migration 0012 substrate incomplete"; exit 1; }
echo "✓ Migration 0012 substrate verified (5 tables + 4 seed rows + empty profile_history)"
```

**Source:** Mirrors `scripts/test.sh` migration 0006 smoke gate at line ~99-106 [VERIFIED via Read].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Untyped `jsonb()` columns | `jsonb('col').$type<T>()` | drizzle-orm 0.45.2 (already installed) | Compile-time inference at SELECT sites; no runtime cost; first Phase 33 use in this codebase |
| Manual `parse()` + try/catch at each schema boundary | `safeParse()` always | Phase 33 introduces — never-throw discipline requires it | One-line consumer code instead of try/catch nesting |
| Single-version JSONB tables (M008 `episodic_summaries`) | `schema_version int` + Zod dispatcher | Phase 33 introduces for the first time | Future M011 schema changes degrade gracefully to null + warn instead of crashing reader |
| Per-cron-handler skip-tracking via `rituals.skip_count` | Cron-context background pipeline (Phase 34) does NOT register as a ritual | Phase 34 (out of scope here) | Phase 33 schema correctly omits any ritual-related columns from profile tables |

**Deprecated/outdated for Phase 33:** None — Phase 33 introduces patterns, doesn't deprecate any.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `_journal.json` entry's exact `when` value should be `Date.now()` at edit time | Pitfall 1 | LOW — monotonic validator catches any non-monotonic value [VERIFIED guard exists]. Any value > 1778041174550 works. |
| A2 | drizzle-kit at 0.31.10 produces `0012_snapshot.json` byte-stable to the same algorithm as 0011 | Standard Stack | LOW — same major.minor version as last 6 migrations; no breaking changes between 0006 and 0011. |
| A3 | Postgres `real` type round-trips through Drizzle as JS `number` without precision loss for values 0.0–1.0 with 2 decimal places | D-06 locked decision | LOW — `real` is IEEE 754 float; 2-decimal precision is well within 23-bit mantissa. |
| A4 | The exact jsonb field names per profile dimension can be locked by the planner from FEATURES.md §2.1-2.4 without further consultation | Claude's Discretion item #1 | MEDIUM — FEATURES.md uses informal field names; planner must pick a canonical TypeScript camelCase + corresponding snake_case SQL form. Recommended: planner produces an explicit field-naming table in PLAN.md 33-01 task 2 (schema.ts edit) as the locked contract for Phase 34. |
| A5 | `profile_history.snapshot` JSONB should store the full row including metadata | Claude's Discretion item #2 — recommended | LOW — recommended by `33-CONTEXT.md`; storing the full row enables "replayable prior state" for any future audit. If planner picks user-facing-only, both work but full-row is strictly safer. |

**A4 is the only assumption with meaningful planning risk.** The planner should resolve A4 explicitly during Plan 33-01 task design — Phase 34 generators will lock against whatever shape Phase 33 commits. A subsequent shape change is a `schema_version` bump (not a free edit).

## Open Questions

1. **Exact jsonb field shape per profile dimension (Claude's Discretion item #1).**
   - What we know: FEATURES.md §2.1-2.4 gives canonical *informal* field lists; ground-truth.ts gives the day-1 seedable subset.
   - What's unclear: Snake_case vs camelCase at the SQL layer; which fields are required vs optional in v1; whether `data_consistency` lives in each profile's jsonb columns or as a top-level column.
   - Recommendation: Plan 33-01 task that edits `schema.ts` MUST produce an explicit field-naming table in its body. Lock against FEATURES.md per profile. Recommended convention: SQL columns are snake_case for portability (matches existing `last_updated`, `substrate_hash`); TypeScript types use camelCase (Drizzle's default inference). `data_consistency` as a top-level `real` column on each profile table (not nested in jsonb) — same shape as `confidence`, simpler for Phase 34 substrate-hash computation.

2. **Where does `data_consistency` live in Phase 33's seed rows?**
   - What we know: Phase 34 generators write `data_consistency` as the Sonnet self-reported consistency. Phase 33 seeds are pre-Sonnet.
   - What's unclear: Should seeded rows have `data_consistency = 0` (no Sonnet ever ran) or `data_consistency = 1.0` (the manually-curated ground-truth is by definition consistent)?
   - Recommendation: `data_consistency = 0` for all four seed rows. The computed confidence = `0.3 + 0.7 * volumeScore * 0 = 0.3` matches the locked D-10 confidence-0.3 jurisdictional baseline naturally. Plan 33-01 task author should set this explicitly; do NOT default to 1.0.

3. **Should `profile_history` get an index in Phase 33?**
   - What we know: `profile_history` is write-only in Phase 33 (zero rows). Phase 34 writes ~4 rows/week → ~208 rows/year. Phase 33 has no read path against the table.
   - What's unclear: Whether to ship `INDEX (profile_table_name, recorded_at DESC)` now or in Phase 34 when reads start.
   - Recommendation: Ship the index in Phase 33 migration 0012. Marginal cost (zero rows at land-time) and HARD CO-LOC discipline encourages "everything 0012 needs ever ships in 0012." Phase 34 plan is then simpler.

4. **`scripts/test.sh` apply-line ordering relative to the journal-monotonic validator.**
   - What we know: validate-journal-monotonic.ts runs BEFORE migrations apply (scripts/test.sh:46-49). It will read the new `_journal.json` entry and validate its `when`.
   - What's unclear: Whether the validator passes if `_journal.json` is edited but `0012_snapshot.json` doesn't exist yet (e.g., partial commit).
   - Recommendation: Plan-checker hook on Plan 33-01 verify block must require both files present + monotonic before allowing the plan to merge. Read `scripts/validate-journal-monotonic.ts` source [VERIFIED present] to confirm the precise failure mode it reports.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (compose) | `scripts/test.sh` postgres + `scripts/regen-snapshots.sh` | Assumed ✓ on operator machine | (project standard) | None — required for migration testing |
| Postgres 16 (via docker-compose.local.yml) | Migration 0012 apply + smoke gate | ✓ existing | 16 | None |
| `pgvector` extension | Existing v1.0 schema; profile tables don't use it but it's loaded by `scripts/test.sh` line ~55 | ✓ | (project standard) | None |
| `npx tsx` | `scripts/validate-journal-monotonic.ts` invocation | ✓ via tsx in dev deps | (existing) | None |
| `npx drizzle-kit` (introspect + generate) | `scripts/regen-snapshots.sh` | ✓ via drizzle-kit ^0.31.10 [VERIFIED] | 0.31.10 | None |
| `psql` (inside docker container) | `scripts/test.sh` migration apply chain | ✓ via postgres docker image | 16 | None |
| Node 22 / `node` CLI | `scripts/regen-snapshots.sh` JSON patching (`node -e`) | ✓ project requirement | 22 | None |

**Missing dependencies with no fallback:** None — Phase 33 ships entirely with project-standard tooling.

**Missing dependencies with fallback:** None.

**Live production server:** Phase 33 deploys by container restart; production Postgres at 192.168.1.50 will run migration 0012 via the Drizzle migrator on first startup post-merge. The smoke-gate assertions are operator-facing (visible in `docker compose logs chris`) but do NOT block startup. This is consistent with v2.4 deploys.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` ^4.1.2 [VERIFIED: package.json:46] |
| Config file | `vitest.config.ts` (existing — no Phase 33 changes) |
| Quick run command | `npx vitest run src/memory/confidence.test.ts` (unit; subseconds) |
| Full suite command | `bash scripts/test.sh` (Docker Postgres + all migrations + all vitest) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROF-01 | Migration 0012 applies cleanly + creates 5 tables with required columns | integration (SQL smoke gate) | `bash scripts/test.sh` (smoke gate inside) | ❌ Wave 0 — `scripts/test.sh` line ~88 needs `MIGRATION_12_SQL` + apply line + new gate |
| PROF-01 | `schema_version int NOT NULL DEFAULT 1` + `substrate_hash text` + `name='primary' UNIQUE DEFAULT` present on all 4 profile tables | integration (`information_schema.columns` assertion in smoke gate) | `bash scripts/test.sh` | ❌ Wave 0 — extend smoke-gate SQL |
| PROF-02 | `profile_history` table exists with discriminator columns | integration (smoke gate IN-list includes `profile_history`) | `bash scripts/test.sh` | ❌ Wave 0 — same gate as PROF-01 |
| PROF-03 | Initial profile rows seeded (4 rows, name='primary', correct confidence values) | integration (`SELECT name, confidence FROM profile_<dim>` assertion in smoke gate) | `bash scripts/test.sh` | ❌ Wave 0 — smoke-gate assertion |
| PROF-04 | `getOperationalProfiles()` returns all-null when DB has no rows | integration (truncate-and-call test against Docker Postgres) | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ Wave 0 — new file `src/memory/__tests__/profiles.test.ts` |
| PROF-04 | `getOperationalProfiles()` returns null per profile on DB error (does not throw) | integration (simulate `db.execute` throw via mock; assert returned shape) | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ Wave 0 — same file |
| PROF-05 | v3 schemas parse valid shapes | unit | `npx vitest run src/memory/profiles/__tests__/schemas.test.ts` | ❌ Wave 0 — new file |
| PROF-05 | v3 schemas reject invalid shapes (wrong confidence, missing fields) | unit | `npx vitest run src/memory/profiles/__tests__/schemas.test.ts` | ❌ Wave 0 — same file |
| PROF-05 | `schema_version: 999` returns null without throwing | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ Wave 0 — `profiles.test.ts` |
| (substrate) | `computeProfileConfidence(0, 0)` → 0; `(10, 1.0)` → 0.3; `(50, 1.0)` → 1.0; `(9)` below threshold | unit | `npx vitest run src/memory/__tests__/confidence.test.ts` | ❌ Wave 0 — new file |
| (substrate) | `isAboveThreshold(9)` → false; `(10)` → true | unit | `npx vitest run src/memory/__tests__/confidence.test.ts` | ❌ Wave 0 — same file |

### Sampling Rate

- **Per task commit:** `npx vitest run <relevant-test-file>` (subseconds for unit tests; ~15s for `profiles.test.ts` with Docker Postgres warm)
- **Per wave merge:** `bash scripts/test.sh` (full suite including migration apply chain + smoke gates)
- **Phase gate:** Full suite green AND `bash scripts/regen-snapshots.sh` passes (acceptance gate prints "No schema changes")

### Wave 0 Gaps

- [ ] `src/memory/__tests__/confidence.test.ts` — covers PROF-05 substrate (`computeProfileConfidence`, `isAboveThreshold`) — new file
- [ ] `src/memory/__tests__/profiles.test.ts` — integration test against Docker Postgres covering PROF-04 + PROF-05 schema-mismatch — new file
- [ ] `src/memory/profiles/__tests__/schemas.test.ts` — covers PROF-05 v3 schema valid/invalid parse — new file
- [ ] `scripts/test.sh` smoke gate for migration 0012 — extend existing pattern (~30 lines of new bash inside the existing file)
- [ ] Existing test infrastructure already exists (vitest ^4.1.2 + Docker postgres on 5433 via `docker-compose.local.yml` + `scripts/test.sh` orchestrator). No framework install needed.

## Project Constraints (from CLAUDE.md)

`CLAUDE.md` is `PLAN.md` via the `.planning/PROJECT.md` symlink (PLAN.md doc, lines 1-483 [VERIFIED via Read]). Extracted directives for Phase 33:

| Directive | Source | Phase 33 Compliance |
|-----------|--------|---------------------|
| Append-only Pensieve (D004) | PLAN.md Key Decisions | Phase 33 adds NEW tables; doesn't modify pensieve_entries. ✓ |
| Fire-and-forget side effects (D005) | PLAN.md | Phase 33 reader honors never-throw (D-12/D-13). ✓ |
| Single authorized Telegram user (D009) | PLAN.md | Phase 33 has no Telegram surface. ✓ |
| Never fabricate | PLAN.md Constraints | Phase 33 has no Sonnet calls. ✓ |
| Never block | PLAN.md Constraints | Phase 33's `getOperationalProfiles()` is a DB read (~ms) + Zod parse (~µs). ✓ |
| Production discipline: build + test locally first, push to Proxmox only with explicit confirmation | PLAN.md Constraints | Phase 33 deploys via container restart (Drizzle migrator auto-applies migration 0012 on startup). Operator must explicitly confirm prod push. |
| Structured fact injection (D031) | PLAN.md | Phase 33's reader returns STRUCTURED data (`OperationalProfiles` interface), never narrative text. ✓ Enforces D031 at the type level. |
| Pensieve authoritative (D035) | PLAN.md | Phase 33 does NOT import or reference `episodic_summaries` in any profile file. Existing `boundary-audit.test.ts` will continue to pass. ✓ |
| Test data via primed-fixture pipeline (D041) | PLAN.md | Phase 33 does not test M010 cron behavior (that's Phase 34/36). Phase 33's integration tests use empty Docker Postgres + seeded migration data. ✓ |
| No skipped tests (D018) | PLAN.md | All Phase 33 tests run in `scripts/test.sh`. No `describe.skip` or `it.skip` should appear. |
| HARD CO-LOC #M10-1 | STATE.md + ROADMAP.md | One atomic plan covers migration SQL + drizzle meta + scripts/test.sh psql line + schema.ts. ✓ Plan 33-01 enforces. |
| Never-Retrofit Checklist | STATE.md | All 7 items must land in Plan 33-01: profile_history table; schema_version; substrate_hash; name UNIQUE; confidence CHECK; scripts/test.sh psql line; drizzle meta snapshot. ✓ |
| Use GSD v1 | PLAN.md | Phase 33 uses standard GSD v1 plan + execute + verify flow. ✓ |
| One phase per session | PLAN.md "Claude Code Execution Guidelines" | Phase 33 → Plan 33-01 → Plan 33-02 in separate sessions. ✓ |
| Define "done" before you start | PLAN.md | ROADMAP.md Phase 33 Success Criteria gives 5 testable conditions. ✓ Each Plan maps explicitly. |
| Phase scoping constraints (do not build features from later phases) | PLAN.md | Phase 33 explicitly excludes generators, Sonnet calls, mode-handler injection, /profile command. ✓ |

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `.planning/phases/33-profile-substrate/33-CONTEXT.md` — 19 locked decisions D-01 through D-19 [VERIFIED via Read]
- `.planning/phases/33-profile-substrate/33-DISCUSSION-LOG.md` — auto-mode audit trail [VERIFIED via Read]
- `.planning/STATE.md` — hard co-location constraints + Never-Retrofit Checklist [VERIFIED via Read]
- `.planning/ROADMAP.md` — Phase 33 Success Criteria 1-5 [VERIFIED via Read]
- `.planning/REQUIREMENTS.md` — PROF-01..05 [VERIFIED via Read]
- `.planning/PROJECT.md` (= PLAN.md) — Key Decisions D004/D005/D009/D029/D031/D035/D041 [VERIFIED via Read]
- `.planning/research/STACK.md` §1-5 — no-new-deps confirmation, `.$type<T>()` pattern, v3/v4 dual schemas, confidence formula [VERIFIED via Read]
- `.planning/research/SUMMARY.md` — pitfall-to-phase ownership map, Never-Retrofit Checklist [VERIFIED via Read]
- `.planning/research/ARCHITECTURE.md` Q4, Q7 — reader API shape, migration sequence [VERIFIED via Read]
- `.planning/research/PITFALLS.md` M010-01/03/09/11 — schema-phase mitigations [VERIFIED via Read]
- `.planning/research/FEATURES.md` §2.1-2.4 — canonical fields per profile dimension [VERIFIED via Read]
- `src/db/migrations/0006_rituals_wellbeing.sql` — closest structural precedent for migration 0012 [VERIFIED via Read]
- `src/db/migrations/meta/_journal.json` — current 12-entry journal; new entry needs `when > 1778041174550` [VERIFIED via Read]
- `src/pensieve/ground-truth.ts:24-63` — seed-value source [VERIFIED via Read]
- `src/pensieve/retrieve.ts:50-114` — never-throw reader pattern exemplar [VERIFIED via Read]
- `src/rituals/types.ts:55-97` — v3 schema consolidation pattern [VERIFIED via Read]
- `src/rituals/weekly-review.ts:36` + `src/episodic/consolidate.ts:33` + `src/rituals/adjustment-dialogue.ts:28` — `zod/v4` sub-path import pattern [VERIFIED via grep]
- `src/db/schema.ts:1-60 + line 376` — existing pgTable + jsonb default patterns [VERIFIED via Read]
- `src/chris/personality.ts:43-60 + 153` — `buildKnownFactsBlock` GROUND_TRUTH usage; the seed-row mapping must not double-up here [VERIFIED via grep+Read]
- `scripts/test.sh:46-200` — journal validator + migration apply chain + multiple smoke-gate precedents [VERIFIED via Read]
- `scripts/regen-snapshots.sh:113-137 + acceptance gate ~330` — cleanup-flag bump discipline [VERIFIED via Read]
- `scripts/validate-journal-monotonic.ts` — monotonic-`when` guardrail (exists) [VERIFIED via ls]
- `src/chris/__tests__/boundary-audit.test.ts` — D035 enforcement; Phase 33 must not import episodic_summaries from any profile file [VERIFIED via Read]
- `package.json:13-46` — vitest ^4.1.2, drizzle-orm ^0.45.2, zod ^3.24.0, drizzle-kit ^0.31.10, @anthropic-ai/sdk ^0.90.0 [VERIFIED via Read]

### Secondary (MEDIUM confidence — production retrospectives + locked-elsewhere decisions)

- v2.4 M009 RETROSPECTIVE (referenced by SUMMARY.md) — first-fire celebration blindness, DB-backed language detection
- M009 Phase 25-01 atomic-migration plan precedent (referenced by `33-CONTEXT.md` canonical_refs) — Plan 33-01 mirrors

### Tertiary (LOW confidence — none in Phase 33)

None. Phase 33's research surface area is entirely covered by HIGH-confidence sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, all installed versions verified, three established `zod/v4` precedents
- Architecture: HIGH — every component has a named M008/M009 precedent; `.$type<T>()` and `schema_version` dispatcher are the only two new patterns and both are inexpensive 1-file additions
- Pitfalls: HIGH — all 8 Phase-33-relevant pitfalls have concrete sources (existing scripts, prior migrations) + concrete mitigations
- Open Questions: MEDIUM — OQ-1 (jsonb field naming) is the only one with planning-time risk; others are mechanical

**Research date:** 2026-05-11
**Valid until:** 2026-05-25 (14 days — Phase 33 stack is stable; no fast-moving deps)
