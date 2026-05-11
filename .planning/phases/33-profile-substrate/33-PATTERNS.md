# Phase 33: Profile Substrate - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 13 (new) + 4 (modified)
**Analogs found:** 17 / 17 (100% — all have direct in-repo precedents)

## Plan Hint Mapping

| Plan | Files |
|------|-------|
| **Plan 33-01** (HARD CO-LOC #M10-1 atomic migration) | `0012_operational_profiles.sql`, `schema.ts` (extension), `meta/0012_snapshot.json`, `meta/_journal.json` (append), `scripts/test.sh` (extension), `scripts/regen-snapshots.sh` (cleanup-flag bump) |
| **Plan 33-02** (Reader + schemas + confidence) | `src/memory/profiles.ts`, `src/memory/profiles/schemas.ts`, `src/memory/confidence.ts`, `src/memory/__tests__/profiles.test.ts`, `src/memory/__tests__/confidence.test.ts`, `src/memory/profiles/__tests__/schemas.test.ts` |

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/db/migrations/0012_operational_profiles.sql` | migration SQL | CRUD (DDL + seed INSERTs) | `src/db/migrations/0006_rituals_wellbeing.sql` (multi-table) + `src/db/migrations/0007_daily_voice_note_seed.sql` (seed INSERT pattern) | exact |
| `src/db/schema.ts` (additions) | drizzle schema TS | declarative table defs | `src/db/schema.ts:367-389` (rituals: jsonb default + UNIQUE) + `:399-417` (wellbeingSnapshots: check constraints) | exact |
| `src/db/migrations/meta/0012_snapshot.json` | drizzle meta artifact | generated build artifact | `src/db/migrations/meta/0011_snapshot.json` (regen via `scripts/regen-snapshots.sh`) | exact |
| `src/db/migrations/meta/_journal.json` (append) | drizzle meta artifact | append-only ledger | existing entries `:4-88`; new entry at `:89` | exact |
| `scripts/test.sh` (extension ~30 lines bash) | shell-script smoke gate | sequential SQL apply + assert | `scripts/test.sh:82-106` (Phase 25 0006 smoke gate) + `:144-153` (0008 single-line gate) | exact |
| `scripts/regen-snapshots.sh` (cleanup-flag bump 0012→0013) | shell-script meta cleanup | guarded `find -delete` | `scripts/regen-snapshots.sh:113-146` + `:386-389` (each prior phase bumped) | exact |
| `src/memory/profiles.ts` | reader (never-throw) | request-response (SELECT + parse) | `src/pensieve/retrieve.ts:50-114` (`searchPensieve` try/catch + warn) | exact |
| `src/memory/profiles/schemas.ts` | zod v3+v4 dual schemas | declarative validation | `src/rituals/weekly-review.ts:132-213` (WeeklyReviewSchema + V4 mirror + StageTwoJudge + DateGrounding triplet) | exact |
| `src/memory/confidence.ts` | pure-function helper | transform (math) | `src/rituals/types.ts:55-97` (pure schema + helper) — confidence is novel pure-function math, no exact precedent; closest peer is constant + pure function module | role-match |
| `src/memory/__tests__/confidence.test.ts` | unit test | pure-fn boundary table | `src/rituals/__tests__/types.test.ts:33-60` (pure-function describe/it/expect) | exact |
| `src/memory/__tests__/profiles.test.ts` | integration test | DB-backed read with mocks | `src/memory/__tests__/relational.test.ts:1-50` (vi.hoisted DB mock chain) + `src/pensieve/__tests__/retrieve.test.ts:1-67,522` (error-path testing for never-throw readers) | exact |
| `src/memory/profiles/__tests__/schemas.test.ts` | unit test | Zod parse/reject table | `src/rituals/__tests__/types.test.ts:33-60` (RitualConfigSchema parse + reject) | exact |

## Pattern Assignments

### `src/db/migrations/0012_operational_profiles.sql` (migration SQL)

**Primary analog:** `src/db/migrations/0006_rituals_wellbeing.sql` (multi-table + check constraints + UNIQUE)
**Secondary analog:** `src/db/migrations/0007_daily_voice_note_seed.sql` (idempotent seed INSERT + ON CONFLICT DO NOTHING)

**Header comment pattern** (`0006_rituals_wellbeing.sql:1-17`):
```sql
-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.
--
-- Phase 25 (M009 v2.4) — Ritual scheduling foundation. Hand-authored per
-- CONTEXT.md D-08 (drizzle-kit cannot auto-gen ALTER TYPE ... IF NOT EXISTS).
-- The drizzle-kit-generated meta/0006_snapshot.json + _journal.json entry
-- match this file's net schema effect; idempotency guards are SQL-only and
-- do not change the resulting DB shape (so the snapshot remains byte-stable).
```

**CREATE TABLE pattern with UNIQUE + jsonb default + check constraint** (`0006_rituals_wellbeing.sql:23-48`):
```sql
CREATE TABLE IF NOT EXISTS "rituals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "ritual_cadence" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rituals_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wellbeing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"energy" smallint NOT NULL,
	...
	CONSTRAINT "wellbeing_snapshots_energy_bounds" CHECK ("wellbeing_snapshots"."energy" BETWEEN 1 AND 5)
);
--> statement-breakpoint
```

**Seed INSERT idempotent pattern** (`0007_daily_voice_note_seed.sql:25-35`):
```sql
INSERT INTO "rituals" ("name", "type", "next_run_at", "enabled", "config")
VALUES (
  'daily_voice_note',
  'daily',
  ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris')
    + interval '1 day'
    + interval '21 hours') AT TIME ZONE 'Europe/Paris'),
  true,
  '{"fire_at":"21:00","prompt_bag":[],"skip_threshold":3,...,"schema_version":1}'::jsonb
)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
```

**Adaptations for Phase 33:**
- 5 tables: `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family`, `profile_history` (D-02)
- Every profile table has `name text NOT NULL UNIQUE DEFAULT 'primary'` sentinel (D-04) — note the `DEFAULT 'primary'` is novel vs `rituals.name` which has no default
- Every profile table adds non-retrofittable columns: `schema_version integer NOT NULL DEFAULT 1`, `substrate_hash text NOT NULL DEFAULT ''` (D-05, D-11)
- `confidence real NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1)` (D-06) — bounded-real CHECK pattern from `wellbeing_snapshots` mood/energy/anxiety
- jsonb columns: `DEFAULT '[]'::jsonb` for arrays, `DEFAULT '{}'::jsonb` for objects, NEVER NULL (D-07)
- `last_updated` + `created_at` both `timestamptz DEFAULT now()` (D-08)
- 4 seed INSERTs (one per profile dim) with `ON CONFLICT (name) DO NOTHING` — hardcoded literal values from `ground-truth.ts:24-63` (D-09, D-10)
- Seed `substrate_hash = ''` (empty string, NOT NULL) so first Phase 34 hash compare always evaluates "changed" (D-11)
- `profile_history` table: NO seed rows; shared discriminator schema `(id, profile_table_name text, profile_id uuid, snapshot jsonb, recorded_at timestamptz)` (D-17, D-18); NO FK on `profile_id` (polymorphic — see Anti-Pattern in RESEARCH.md)
- Header MUST note: "Seed-row values copied from ground-truth.ts:24-63 as of 2026-05-11. Future ground-truth edits do NOT propagate." (Pitfall 8)

---

### `src/db/schema.ts` (additions)

**Primary analog:** `src/db/schema.ts:367-389` (rituals) for jsonb-default + UNIQUE; `src/db/schema.ts:399-417` (wellbeingSnapshots) for `check()` constraint

**Imports already present at `:1-20`** (no new imports needed except types from `../memory/profiles/schemas.js`):
```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  jsonb,
  timestamp,
  real,
  bigint,
  integer,
  smallint,
  boolean,
  index,
  unique,
  check,
  date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

**pgTable pattern with jsonb default + UNIQUE + sql template** (`schema.ts:367-389`):
```typescript
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
  ],
);
```

**Bounded `check()` constraint pattern** (`schema.ts:399-417`):
```typescript
export const wellbeingSnapshots = pgTable(
  'wellbeing_snapshots',
  {
    ...
    energy: smallint('energy').notNull(),
    ...
  },
  (table) => [
    unique('wellbeing_snapshots_snapshot_date_unique').on(table.snapshotDate),
    check('wellbeing_snapshots_energy_bounds', sql`${table.energy} BETWEEN 1 AND 5`),
  ],
);
```

**Adaptations for Phase 33:**
- 4 profile tables + 1 history table (D-02)
- Use `jsonb('col').$type<T>()` for typed jsonb — NEW pattern in this codebase, but supported by drizzle-orm 0.45.2. Import the type from `'../memory/profiles/schemas.js'`:
  ```typescript
  currentLocation: jsonb('current_location').$type<JurisdictionalProfileData['currentLocation']>().notNull().default(sql`'{}'::jsonb`),
  ```
- `name: text('name').notNull().default('primary')` + `unique('profile_X_name_unique').on(table.name)` — the `.default('primary')` is NEW vs `rituals.name` (which has no default)
- `confidence: real('confidence').notNull().default(0)` + `check('profile_X_confidence_bounds', sql\`${table.confidence} >= 0 AND ${table.confidence} <= 1\`)`
- `schemaVersion: integer('schema_version').notNull().default(1)` + `substrateHash: text('substrate_hash').notNull().default('')`
- `lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow()` + `createdAt: timestamp('created_at', ...).notNull().defaultNow()`
- `profileHistory` table: NO `unique` (history is append-only), `snapshot: jsonb('snapshot').$type<ProfileSnapshot>().notNull()` (no default)
- Per Open Question 3 in RESEARCH.md: ship `index('profile_history_table_recorded_idx').on(table.profileTableName, table.recordedAt.desc())` now (marginal cost on zero rows; simplifies Phase 34)

---

### `src/db/migrations/meta/_journal.json` (append new entry)

**Analog:** `src/db/migrations/meta/_journal.json` (existing 12 entries at `:4-88`)

**Existing entry pattern** (`_journal.json:82-88`):
```json
    {
      "idx": 11,
      "version": "7",
      "when": 1778041174550,
      "tag": "0011_rename_daily_voice_note_to_journal",
      "breakpoints": true
    }
```

**Adaptations for Phase 33:**
- New entry: `idx: 12`, `version: "7"`, `tag: "0012_operational_profiles"`, `breakpoints: true`
- **CRITICAL: `when` MUST be > 1778041174550** (Pitfall 1 — `scripts/validate-journal-monotonic.ts` runs in `scripts/test.sh:46-49` BEFORE migrations apply and will fail-fast on stale `when`)
- Recommended value: `Date.now()` at edit time (~`17788xxxxxxxx` for May 2026)
- This file is NOT regenerated by `scripts/regen-snapshots.sh` — entry must be hand-appended

---

### `src/db/migrations/meta/0012_snapshot.json` (drizzle meta artifact)

**Analog:** `src/db/migrations/meta/0011_snapshot.json` (existing, `:1-30` excerpt above)

**Generated, not authored.** Produced by running `bash scripts/regen-snapshots.sh` after the `schema.ts` table additions are committed.

**Adaptations:**
- Do NOT hand-edit
- File appears after running `scripts/regen-snapshots.sh` which introspects the DB and writes meta snapshots
- HARD CO-LOC #M10-1: this file MUST ship in the same plan/commit as the `0012_operational_profiles.sql` + `schema.ts` edits + `_journal.json` append (D-03)

---

### `scripts/test.sh` (extension ~30 lines bash)

**Primary analog:** `scripts/test.sh:82-106` (Phase 25 migration 0006 substrate gate — multi-table smoke assertion)
**Secondary analog:** `scripts/test.sh:144-153` (Phase 27 single-row seed assertion)

**Migration-variable declaration pattern** (`test.sh:8-19`):
```bash
MIGRATION_SQL="src/db/migrations/0000_curved_colonel_america.sql"
ENUM_FIX_SQL="src/db/migrations/0001_add_photos_psychology_mode.sql"
MIGRATION_2_SQL="src/db/migrations/0002_decision_archive.sql"
...
MIGRATION_11_SQL="src/db/migrations/0011_rename_daily_voice_note_to_journal.sql"
```

**Apply-line pattern** (`test.sh:77-80`):
```bash
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_11_SQL"
```

**Multi-table substrate smoke gate** (`test.sh:88-106`):
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
grep -q "^6|1|3$" /tmp/m009_smoke.txt || { echo "❌ Migration 0006 substrate incomplete"; exit 1; }
echo "✓ Migration 0006 substrate verified (6 tables + 1 enum value + 3 indexes)"
```

**Adaptations for Phase 33:**
- Append `MIGRATION_12_SQL="src/db/migrations/0012_operational_profiles.sql"` to variable block at `:8-19`
- Append apply line after `:80` (the last existing `MIGRATION_11_SQL` apply)
- Add Phase 33 smoke-gate block after `:106` (mirror Phase 25's structure):
  - Assert `table_count = 5` for IN-list of all 5 profile_* table names (CRITICAL: include `profile_history` per Pitfall 7)
  - Assert `jur_seed = 1`, `cap_seed = 1`, `hea_seed = 1`, `fam_seed = 1` (each profile has exactly 1 row with `name = 'primary'`)
  - Assert `hist_seed = 0` (profile_history is write-only in Phase 33 — D-18)
  - Optionally assert `schema_version = 1` and `substrate_hash = ''` on each seed row
  - `grep -q "^5|1|1|1|1|0$"` pattern match (exact format from `:105`)
- Pre-`vitest` placement (per existing gate convention: failure exits BEFORE the test suite runs)

---

### `scripts/regen-snapshots.sh` (cleanup-flag bump 0012→0013)

**Analog:** `scripts/regen-snapshots.sh:113-146` (cleanup section) + `:367-389` (acceptance-gate apply chain)

**Cleanup-flag pattern** (`regen-snapshots.sh:113-146`):
```bash
# Phase 29 extends this discipline to 0009 — committed 0009_snapshot.json must
# be preserved; only the post-0009 acceptance-gate artifact (0010_snapshot.json
# named by drizzle's sequence-counter) is wiped when this run produced it.
REGEN_PRODUCED_ACCEPTANCE=0
cleanup() {
  ...
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0011_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0012_acceptance_check*.sql" -delete 2>/dev/null || true
  # Only delete the post-0011 snapshot if THIS run produced it — otherwise it
  # is a legitimate committed snapshot from a future plan and must be preserved.
  if [[ "${REGEN_PRODUCED_ACCEPTANCE}" -eq 1 ]]; then
    find "${META_DIR}" -name "0012_snapshot.json" -delete 2>/dev/null || true
  fi
}
```

**Acceptance-gate apply chain** (`regen-snapshots.sh:362-389`):
```bash
apply_sql "${MIGRATION_10}"
apply_sql "${MIGRATION_11}"
...
REGEN_PRODUCED_ACCEPTANCE=1
set +e
GEN_OUT=$(DATABASE_URL="${DB_URL}" npx drizzle-kit generate --name acceptance_check 2>&1)
...
if echo "${GEN_OUT}" | grep -q "No schema changes"; then
  ...
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0012_acceptance_check*.sql" -delete 2>/dev/null || true
  find "${META_DIR}" -name "0012_snapshot.json" -delete 2>/dev/null || true
```

**Adaptations for Phase 33:**
- Bump cleanup-trap target from `0012_snapshot.json` → `0013_snapshot.json` (line 145)
- Bump cleanup-trap acceptance-check artifact `0012_acceptance_check*.sql` → `0013_acceptance_check*.sql` (line 136)
- Add new line `find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0013_acceptance_check*.sql" -delete 2>/dev/null || true`
- Append acceptance-gate apply line `apply_sql "${MIGRATION_12}"` after the existing `apply_sql "${MIGRATION_11}"` at `:366`
- Bump post-gate cleanup at `:388-389` from `0012_*` → `0013_*` targets
- Add a comment block (mirror `:113-115`) documenting the Phase 33 bump
- **Pitfall 2:** missing this bump means a future regen run wipes the committed `0012_snapshot.json` — destructive failure mode

---

### `src/memory/profiles.ts` (reader, never-throw)

**Primary analog:** `src/pensieve/retrieve.ts:50-114` (searchPensieve — try/catch wrapping + logger.warn + empty-default return)

**Imports + types pattern** (`retrieve.ts:1-21`):
```typescript
import { cosineDistance, asc, isNull, eq, and, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEmbeddings, pensieveEntries, epistemicTagEnum, episodicSummaries } from '../db/schema.js';
import { embedText } from './embeddings.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
```

**Never-throw try/catch + warn-and-return-empty pattern** (`retrieve.ts:50-114`):
```typescript
export async function searchPensieve(
  query: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  const start = Date.now();
  try {
    const queryEmbedding = await embedText(query);
    if (!queryEmbedding) {
      logger.warn(
        { query: query.slice(0, 50) },
        'pensieve.retrieve.error',
      );
      return [];
    }

    const rows = await db
      .select({ entry: pensieveEntries, distance })
      .from(pensieveEmbeddings)
      .innerJoin(pensieveEntries, eq(pensieveEmbeddings.entryId, pensieveEntries.id))
      .where(isNull(pensieveEntries.deletedAt))
      .orderBy(asc(distance))
      .limit(limit * 3);
    ...
    return results;
  } catch (error) {
    logger.warn(
      {
        query: query.slice(0, 50),
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.retrieve.error',
    );
    return [];
  }
}
```

**Adaptations for Phase 33:**
- Function: `getOperationalProfiles(): Promise<OperationalProfiles>` returning `{ jurisdictional, capital, health, family }` typed object (D-12 contract — return shape, NOT a single null)
- Per-profile try/catch inside a helper `readOneProfile<T>(dimension, table)`; outer `Promise.all([...])` to parallelize 4 SELECTs (Pitfall 5: each try/catch wraps its own SELECT + parse; DB-level failure can still null all four naturally because each helper traps independently)
- Use `.safeParse()`, NOT `.parse()` (Pitfall 4 + Pitfall 6 — never-throw absolute)
- Schema dispatcher pattern: `const parser = PROFILE_SCHEMAS[dimension][row.schemaVersion]; if (!parser) { logger.warn(...); return null; }` (Pitfall 6: explicit undefined check before `.safeParse`)
- Log tags: `'chris.profile.read.error'` (DB-level), `'chris.profile.read.schema_mismatch'` (Zod-level) — match D-13 verbatim
- Drizzle query: `db.select().from(table).where(eq(table.name, 'primary')).limit(1)` — sentinel-row read

---

### `src/memory/profiles/schemas.ts` (zod v3+v4 dual)

**Primary analog:** `src/rituals/weekly-review.ts:132-213` (three v3+v4 dual schemas in one module: WeeklyReviewSchema, StageTwoJudgeSchema, DateGroundingSchema)
**Secondary analog:** `src/rituals/types.ts:55-85` (single-schema consolidation pattern + `.strict()` mode)

**v3+v4 dual schema pattern** (`weekly-review.ts:132-161`):
```typescript
import { z } from 'zod';
import * as zV4 from 'zod/v4';

export const WeeklyReviewSchema = z.object({
  observation: z.string().min(20).max(800),
  question: z
    .string()
    .min(5)
    .max(300)
    .refine(stage1Check, {
      message: 'Stage-1 violation: must contain exactly one ? AND ≤1 interrogative-leading-word per EN/FR/RU',
    }),
});

/** v4 SDK-boundary mirror. NO refine — re-validated via v3 in the retry loop. */
export const WeeklyReviewSchemaV4 = zV4.object({
  observation: zV4.string().min(20).max(800),
  question: zV4.string().min(5).max(300),
});

export type WeeklyReviewOutput = z.infer<typeof WeeklyReviewSchema>;
```

**Lock-step comment pattern** (`weekly-review.ts:144-156`):
```typescript
/**
 * v4 SDK-boundary mirror. NO refine — re-validated via v3 in the retry loop.
 *
 * Why both schemas:
 *   The SDK's `@anthropic-ai/sdk/helpers/zod::zodOutputFormat()` calls
 *   `z.toJSONSchema(schema, { reused: 'ref' })` from
 *   `zod/v4/core/to-json-schema`, which only operates on v4 schemas...
 *
 *   Both schemas MUST stay in lock-step. If a future commit tightens any
 *   field on the v3 schema, update this mirror in the same commit.
 */
```

**`.strict()` enforcement pattern** (`types.ts:55-85`):
```typescript
export const RitualConfigSchema = z
  .object({
    fire_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'fire_at must be HH:mm'),
    ...
    schema_version: z.literal(1),
  })
  .strict();
```

**Adaptations for Phase 33:**
- 4 v3 schemas: `JurisdictionalProfileSchemaV3`, `CapitalProfileSchemaV3`, `HealthProfileSchemaV3`, `FamilyProfileSchemaV3` (D-15)
- 4 v4 mirrors with same names suffixed `V4` (D-15)
- Per Open Question 1: exact field names locked from FEATURES.md §2.1-2.4; SQL columns snake_case + TypeScript types camelCase
- Per Open Question 2: `data_consistency: z.number().min(0).max(1)` lives at top level on each profile (not nested in jsonb) — seed rows set `0`, NOT `1.0`
- Export `type JurisdictionalProfileData = z.infer<typeof JurisdictionalProfileSchemaV3>` for each (consumed by `schema.ts` `.$type<T>()`)
- v4 mirrors OMIT `.refine()` and OMIT `.strict()` (M009 D-29-02 — SDK doesn't surface refine errors as actionable retry signals; strict-mode JSON Schema is not parsed by SDK)
- v4 schemas unused in Phase 33 itself; ship them ready for Phase 34 `zodOutputFormat()` consumption
- Lock-step comment block on every V4 schema (mirror `weekly-review.ts:144-156`)

---

### `src/memory/confidence.ts` (pure-function helper)

**Analog:** No direct precedent for confidence math. Closest peer pattern: pure-function modules in `src/rituals/types.ts:95-97` (`parseRitualConfig` — pure function wrapper with no DB/no LLM).

**Adaptations for Phase 33 (full spec from RESEARCH.md "Code Examples" §Pure-function helpers + STACK.md §5):**
- Module header comment block: explain why Phase 33 ships these (D-19: substrate not inference) + SATURATION tuning note (v2.5.1)
- Two `export const` constants: `MIN_ENTRIES_THRESHOLD = 10`, `SATURATION = 50`
- Two pure functions:
  - `computeProfileConfidence(entryCount: number, dataConsistency: number): number`:
    - `if (entryCount < MIN_ENTRIES_THRESHOLD) return 0;`
    - `volumeScore = Math.min(1.0, (entryCount - MIN_ENTRIES_THRESHOLD) / (SATURATION - MIN_ENTRIES_THRESHOLD))`
    - `return Math.round((0.3 + 0.7 * volumeScore * dataConsistency) * 100) / 100`
  - `isAboveThreshold(entryCount: number): boolean` → `return entryCount >= MIN_ENTRIES_THRESHOLD`
- Zero imports — pure TypeScript math
- JSDoc cites STACK.md §5 as the algorithm of record
- Consumed by Phase 34 generators (GEN-05); used in Phase 33 by no caller, only by tests

---

### `src/memory/__tests__/confidence.test.ts` (unit test)

**Analog:** `src/rituals/__tests__/types.test.ts:33-60` (pure-function describe/it/expect — no mocks)

**Test file header + imports pattern** (`types.test.ts:1-41`):
```typescript
/**
 * src/rituals/__tests__/types.test.ts — Phase 25 Plan 02 Task 1 (RIT-07)
 *
 * Unit tests for the `RitualConfigSchema` Zod schema...
 * Pure-function (no DB, no network), runs in microseconds.
 *
 * Run in isolation:
 *   npx vitest run src/rituals/__tests__/types.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  RitualConfigSchema,
  RITUAL_OUTCOME,
  parseRitualConfig,
  type RitualConfig,
} from '../types.js';
```

**Boundary-table test pattern** (`types.test.ts:54-60`):
```typescript
describe('RitualConfigSchema — happy path', () => {
  it('accepts a fully-populated valid config', () => {
    const parsed = RitualConfigSchema.parse(validConfig);
    expect(parsed).toEqual(validConfig);
  });
```

**Adaptations for Phase 33 (from RESEARCH.md Test Strategy):**
- 5 test cases minimum:
  - `computeProfileConfidence(0, 0)` → `0`
  - `computeProfileConfidence(9, 1.0)` → `0` (below threshold)
  - `computeProfileConfidence(10, 1.0)` → `~0.3` (just-at-threshold; volumeScore=0)
  - `computeProfileConfidence(50, 1.0)` → `~1.0` (saturation)
  - `computeProfileConfidence(50, 0.5)` → `~0.65`
  - `isAboveThreshold(9)` → `false`; `isAboveThreshold(10)` → `true`
- Pure unit tests — zero `vi.mock()`, zero DB
- File: `src/memory/__tests__/confidence.test.ts`

---

### `src/memory/__tests__/profiles.test.ts` (integration test)

**Primary analog:** `src/memory/__tests__/relational.test.ts:1-50` (vi.hoisted DB mock chain)
**Secondary analog:** `src/pensieve/__tests__/retrieve.test.ts:522` (`describe('episodic helpers — error paths')` — never-throw error-path testing)

**vi.hoisted mock pattern** (`relational.test.ts:1-50`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock refs ───────────────────────────────────────────────
const { mockSelect, mockFrom, mockWhere, mockLimit, mockLogWarn } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockLogWarn: vi.fn(),
}));

// Wire up chainable DB mock
mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });

vi.mock('../../db/connection.js', () => ({
  db: { select: mockSelect },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: mockLogWarn, debug: vi.fn(), error: vi.fn() },
}));
```

**Adaptations for Phase 33 (from RESEARCH.md PROF-04 + PROF-05 schema-mismatch test rows):**
- Test scenarios:
  - `getOperationalProfiles()` returns `{ jurisdictional: <row>, capital: <row>, health: <row>, family: <row> }` when all 4 profile tables have seeded rows (post-migration happy path against Docker Postgres OR mocked Drizzle returning seed-row shape)
  - `getOperationalProfiles()` returns `{ jurisdictional: null, capital: null, health: null, family: null }` when `mockLimit` resolves to `[]` (no rows)
  - `getOperationalProfiles()` returns per-profile null when `mockLimit` rejects (simulating Drizzle error) — assert `mockLogWarn` called with `'chris.profile.read.error'`
  - `schema_version: 999` mock row → `null` for that profile + `mockLogWarn` called with `'chris.profile.read.schema_mismatch'` (Pitfall 6)
  - Invalid jsonb shape (e.g., `currentLocation: { city: 123 }` — wrong type) → `null` for that profile + warn
  - DB-level partial failure (3 succeed, 1 throws) → 3 valid rows + 1 null (Pitfall 5 — per-helper try/catch)
- Mock `db.select` chain returning seeded fixtures; do NOT spin up Docker (this test is `__tests__/`, not `e2e`)

---

### `src/memory/profiles/__tests__/schemas.test.ts` (unit test)

**Analog:** `src/rituals/__tests__/types.test.ts:33-60` (RitualConfigSchema parse + reject boundary table)

**Adaptations for Phase 33:**
- 4 happy-path tests (one per profile schema — v3 parses a valid populated shape)
- 4 reject tests (one per profile — `safeParse` returns `.success === false` for invalid input):
  - Out-of-bounds `data_consistency` (e.g., `1.5`) → reject
  - Wrong jsonb field type (e.g., `currentLocation.city: number`) → reject
- 4 v4 mirror parse tests (verify v4 schema accepts same shape but with different module reference)
- Pure unit — no DB, no LLM, no mocks
- File: `src/memory/profiles/__tests__/schemas.test.ts`

---

## Shared Patterns

### HARD CO-LOC #M10-1 (atomic migration plan boundary)

**Source:** D-03 + STATE.md hard co-location constraints
**Apply to:** All files in Plan 33-01

The following 6 artifacts MUST ship in ONE plan/commit:
1. `src/db/migrations/0012_operational_profiles.sql` (hand-authored DDL + seed)
2. `src/db/schema.ts` (5 new pgTable defs)
3. `src/db/migrations/meta/0012_snapshot.json` (drizzle-kit regen)
4. `src/db/migrations/meta/_journal.json` (append entry idx=12)
5. `scripts/test.sh` (`MIGRATION_12_SQL` var + apply line + smoke gate)
6. `scripts/regen-snapshots.sh` (cleanup-flag bump 0012→0013)

Splitting any one of these reproduces TECH-DEBT-19-01 lineage breakage. The plan-checker MUST refuse a plan that omits any of the 6.

### Never-throw contract (D005)

**Source:** `.planning/PROJECT.md` Key Decision D005; D-12/D-13 in CONTEXT.md
**Apply to:** `src/memory/profiles.ts`

- All reader functions wrap their body in `try { ... } catch (error) { logger.warn(...); return <empty>; }`
- All Zod parsing uses `.safeParse()`, NEVER `.parse()` (Pitfall 4 + Pitfall 6)
- All schema dispatchers explicitly check `if (!parser) { logger.warn(...); return null; }` BEFORE calling `.safeParse` (Pitfall 6 — `PROFILE_SCHEMAS[999]` is undefined)
- Return shape on full DB failure: `{ jurisdictional: null, capital: null, health: null, family: null }` — NEVER a single `null` (D-12)

### Idempotent SQL (Pitfall 3)

**Source:** `0007_daily_voice_note_seed.sql:35`
**Apply to:** All seed INSERTs in `0012_operational_profiles.sql`

Every `INSERT INTO profile_<dim>` MUST end with `ON CONFLICT ("name") DO NOTHING`. Allows test reruns + manual psql pokes without `set -euo pipefail` aborting on duplicate key.

### Drizzle `.$type<T>()` jsonb typing (NEW in this codebase)

**Source:** STACK.md §2 + drizzle-orm 0.45.2 `node_modules/drizzle-orm/pg-core/columns/json.d.ts`
**Apply to:** `src/db/schema.ts` (all jsonb columns on the 4 profile tables + `profile_history.snapshot`)

```typescript
currentLocation: jsonb('current_location')
  .$type<JurisdictionalProfileData['currentLocation']>()
  .notNull()
  .default(sql`'{}'::jsonb`),
```

- COMPILE-TIME inference only; Drizzle does NOT validate jsonb shape at SELECT (Pitfall 4)
- MUST be backed by a Zod v3 `safeParse` at the reader boundary (`profiles.ts`)
- Import types from `'../memory/profiles/schemas.js'` (cross-module type-only import)

### Monotonic `_journal.json` `when` (Phase 32 #3 guardrail)

**Source:** `scripts/validate-journal-monotonic.ts` + `scripts/test.sh:46-49`
**Apply to:** `_journal.json` new entry

New entry's `when` MUST be `> 1778041174550` (the 0011 entry's `when`). Use `Date.now()` at edit time. Validator runs in CI BEFORE migrations apply; stale `when` fails fast.

### Snake_case SQL ↔ camelCase TypeScript (Open Question 1 lock)

**Source:** existing convention in `schema.ts` (e.g., `lastUpdated` ↔ `last_updated`)
**Apply to:** `schema.ts` profile-table definitions + `schemas.ts` Zod field names

- SQL columns: snake_case (`current_location`, `residency_statuses`, `schema_version`)
- TypeScript camelCase via Drizzle convention (`currentLocation`, `residencyStatuses`, `schemaVersion`)
- Drizzle `pgTable` definition: `currentLocation: jsonb('current_location')...` (camelCase property → snake_case column)
- Zod schema field names: camelCase to match the TypeScript surface

## No Analog Found

| File | Role | Data Flow | Reason | Source for Pattern |
|------|------|-----------|--------|--------------------|
| `src/memory/confidence.ts` | pure-function helper | math transform | No prior pure-function confidence module exists. Algorithm is novel to M010. | STACK.md §5 (confidence formula) + RESEARCH.md "Code Examples" §Pure-function helpers (full source) |
| `schema_version` + Zod dispatcher | runtime pattern | dispatch by integer key | No prior table in this codebase uses `schema_version` (M008 `episodic_summaries` is single-version). PITFALLS.md M010-11 documents the pattern as introduced by Phase 33. | RESEARCH.md "Architecture Patterns" §Pattern 3 (full spec) |

Both have fully-specified implementations in RESEARCH.md "Code Examples" — planner copies verbatim, not from a codebase analog.

## Metadata

**Analog search scope:**
- `src/db/migrations/` (12 prior migrations)
- `src/db/migrations/meta/` (12 prior snapshots + journal)
- `src/db/schema.ts` (15+ pgTable defs)
- `src/pensieve/retrieve.ts` (never-throw reader)
- `src/rituals/types.ts` (Zod schema consolidation)
- `src/rituals/weekly-review.ts` (v3+v4 dual schema triplet)
- `src/rituals/__tests__/types.test.ts` (pure-function test pattern)
- `src/memory/__tests__/relational.test.ts` (DB mock chain)
- `src/pensieve/__tests__/retrieve.test.ts` (never-throw error-path test)
- `scripts/test.sh` (migration apply + smoke gate)
- `scripts/regen-snapshots.sh` (meta cleanup discipline)
- `src/pensieve/ground-truth.ts` (seed values)

**Files scanned:** 13 source files via Read + grep
**Pattern extraction date:** 2026-05-11

## PATTERN MAPPING COMPLETE

**Phase:** 33 - profile-substrate
**Files classified:** 12 (8 new + 4 modified)
**Analogs found:** 12 / 12

### Coverage
- Files with exact analog: 10
- Files with role-match analog: 2 (confidence.ts + schema_version-dispatcher pattern)
- Files with no analog: 0 (the 2 role-match cases have full specs in RESEARCH.md)

### Key Patterns Identified
- HARD CO-LOC #M10-1: 6 artifacts ship atomically in Plan 33-01 (migration SQL + schema.ts + drizzle meta snapshot + journal entry + scripts/test.sh apply+gate + regen-snapshots cleanup-flag bump)
- Never-throw reader: `try/catch + logger.warn + return empty` wraps every Drizzle invocation; `.safeParse` (not `.parse`); explicit `if (!parser)` undefined check before dispatcher access (Pitfalls 4-6)
- Zod v3+v4 dual: every profile shape gets a v3 (read-boundary) + v4 (Phase 34 SDK-boundary, no `.refine()`, no `.strict()`); lock-step comment block mandatory (M009 D-29-02)
- Sentinel-row pattern: `name text NOT NULL UNIQUE DEFAULT 'primary'` enables future named snapshots without schema change (D-04 + M013/M014 forward-compat)
- Idempotent migration SQL: every `INSERT` ends `ON CONFLICT (name) DO NOTHING`; every `CREATE TABLE` uses `IF NOT EXISTS` (Pitfall 3 + 0006/0007 precedent)

### File Created
`/home/claude/chris/.planning/phases/33-profile-substrate/33-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns by file:line in PLAN.md files. Plan 33-01 (atomic migration) has 6 cross-referenced artifacts; Plan 33-02 (reader + schemas + confidence) has 6 files with explicit analog excerpts.
