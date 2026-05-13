# Phase 37: Psychological Substrate - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 8 NEW + 5 MODIFIED = 13 total
**Analogs found:** 13 / 13 (100% — direct M010 / Phase 33 precedents verified)

## Plan Hint Mapping (recommended split — mirrors Phase 33 / M010)

| Plan | Files | Rationale |
|------|-------|-----------|
| **Plan 37-01** (HARD CO-LOC #M11-1: persistence atomic) | `0013_psychological_profiles.sql`, `src/db/schema.ts` (3 new pgTable exports + type imports), `meta/0013_snapshot.json`, `meta/_journal.json` (append), `scripts/test.sh` (append psql line + smoke gate), `scripts/regen-snapshots.sh` (0012→0013 bump), `src/memory/profiles/psychological-schemas.ts` (Zod types needed by `schema.ts`'s `.$type<T>()` imports) | All 7 artifacts MUST ship in one atomic plan per CONTEXT.md D-03. Splitting reproduces M010 PITFALL M010-11 lineage break. Zod types live here because `schema.ts:21-27` already imports M010 profile types from `schemas.ts` — the same coupling forces `psychological-schemas.ts` into Plan 37-01. |
| **Plan 37-02** (Substrate loader + confidence helpers + reader API) | `src/memory/profiles/psychological-shared.ts`, `src/memory/confidence.ts` (extend), `src/memory/profiles.ts` (extend with `PsychologicalProfileType` + `PSYCHOLOGICAL_PROFILE_SCHEMAS` + `getPsychologicalProfiles`), unit tests for shared + schemas | Substrate-not-inference per CONTEXT.md D-29. Tests run without DB for schemas; with Docker DB for shared. |
| **Plan 37-03** (Boundary audit test) | `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | Standalone vitest unit test; runs <1s; no DB. Could fold into Plan 37-02 but Phase 33's M008 precedent shipped boundary-audit as its own thin task. Planner's discretion. |

## File Classification

| File | Status | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `src/db/migrations/0013_psychological_profiles.sql` | NEW | migration SQL | CRUD (DDL + seed INSERT) | `src/db/migrations/0012_operational_profiles.sql` (entire file) | exact |
| `src/db/schema.ts` | MOD (3 new exports + type imports) | drizzle schema TS | declarative table defs | `src/db/schema.ts:536-636` (4 M010 profile tables) | exact |
| `src/db/migrations/meta/0013_snapshot.json` | NEW (generated) | drizzle build artifact | drizzle-kit output | `src/db/migrations/meta/0012_snapshot.json` (regen via `regen-snapshots.sh`) | exact |
| `src/db/migrations/meta/_journal.json` | MOD (append idx 13 entry) | append-only ledger | sequential entries | `_journal.json:89-95` (idx 12 entry) | exact |
| `src/memory/profiles/psychological-schemas.ts` | NEW | Zod v3+v4 dual schemas | declarative validation | `src/memory/profiles/schemas.ts` (entire 241-line file) | exact |
| `src/memory/profiles/psychological-shared.ts` | NEW | substrate loader | Drizzle SELECT → discriminated union | `src/memory/profiles/shared.ts:206-254` (`loadProfileSubstrate`) | role-match (substantial divergences — see below) |
| `src/memory/profiles.ts` | MOD (append `PsychologicalProfileType`, `PSYCHOLOGICAL_PROFILE_SCHEMAS`, `PsychologicalProfiles`, `getPsychologicalProfiles`) | reader (never-throw) | request-response (SELECT + Zod) | `src/memory/profiles.ts:59`, `:83-87`, `:100-152`, `:191-199` | exact |
| `src/memory/confidence.ts` | MOD (append 3 exports) | pure-function helpers | transform (math + boolean) | `src/memory/confidence.ts:27,31,63-65` | exact |
| `src/memory/profiles/__tests__/psychological-shared.test.ts` | NEW | integration test (real DB) | DB-backed loader test | `src/memory/profiles/__tests__/shared.test.ts:1-120` | exact |
| `src/memory/profiles/__tests__/psychological-schemas.test.ts` | NEW | unit test (no DB) | Zod parse/reject table | `src/memory/profiles/__tests__/schemas.test.ts:1-60` | exact |
| `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | NEW | boundary audit test | regex sweep over file contents | `src/chris/__tests__/boundary-audit.test.ts` (entire 127-line file) | exact |
| `scripts/test.sh` | MOD (append `MIGRATION_13_SQL=`, psql line, smoke gate) | shell-script smoke gate | sequential SQL apply + assert | `scripts/test.sh:20,82-83` (12 var/apply lines) + `:218-262` (0012 smoke gate) | exact |
| `scripts/regen-snapshots.sh` | MOD (bump `MIGRATION_12`→`MIGRATION_13`, `0013`→`0014` cleanup sentinels) | shell-script meta cleanup | guarded `find -delete` | `regen-snapshots.sh:67,118-122,140-153,375-399` | exact |

---

## Pattern Assignments

### `src/db/migrations/0013_psychological_profiles.sql` (migration SQL)

**Primary analog:** `src/db/migrations/0012_operational_profiles.sql` (lines 1-204; the entire file is the template).

**Header comment pattern** (`0012_operational_profiles.sql:1-23`):
```sql
-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.
--
-- Phase 33 (M010 v2.5) — Operational profile substrate.
-- HARD CO-LOCATION #M10-1: this SQL + src/db/schema.ts table defs +
-- migrations/meta/0012_snapshot.json + _journal.json entry +
-- scripts/test.sh psql apply line + scripts/regen-snapshots.sh
-- cleanup-flag bump ALL ship in Plan 33-01 atomically.
--
-- Non-retrofittable columns (PITFALLS M010-09/10/11 — cannot be added later):
--   - schema_version int NOT NULL DEFAULT 1   (M010-11 — Zod evolution)
--   - substrate_hash text NOT NULL DEFAULT '' (M010-09 — Phase 34 idempotency seed)
--   - name text NOT NULL UNIQUE DEFAULT 'primary' (M010-03 — Phase 34 upsert target)
```

**CREATE TABLE pattern** (`0012_operational_profiles.sql:25-45`, the `profile_jurisdictional` block):
```sql
CREATE TABLE IF NOT EXISTS "profile_jurisdictional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"data_consistency" real DEFAULT 0 NOT NULL,
	"current_country" jsonb DEFAULT 'null'::jsonb NOT NULL,
	...
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_jurisdictional_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_jurisdictional_confidence_bounds" CHECK ("profile_jurisdictional"."confidence" >= 0 AND "profile_jurisdictional"."confidence" <= 1),
	CONSTRAINT "profile_jurisdictional_data_consistency_bounds" CHECK ("profile_jurisdictional"."data_consistency" >= 0 AND "profile_jurisdictional"."data_consistency" <= 1)
);
--> statement-breakpoint
```

**Seed INSERT pattern** (`0012_operational_profiles.sql:174-186`, the `profile_health` zero-confidence cold-start):
```sql
INSERT INTO "profile_health"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "open_hypotheses", "pending_tests", "active_treatments", "recent_resolved",
     "case_file_narrative", "wellbeing_trend")
VALUES
    ('primary', 1, '', 0, 0,
     '[]'::jsonb,
     '[]'::jsonb,
     '[]'::jsonb,
     '[]'::jsonb,
     '"insufficient data"'::jsonb,
     '{}'::jsonb)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
```

**Divergences for psychological version (per CONTEXT.md D-06..D-14 + RESEARCH.md Example 1):**

1. **Three tables, not five:** `profile_hexaco` (6 dim columns), `profile_schwartz` (10 value columns), `profile_attachment` (3 dim columns). NO `profile_history` (already exists from 0012, reused unchanged per D-04).
2. **Drop `data_consistency` column:** Not in M011 schema. M011 stores `overall_confidence` instead of `confidence`. The CHECK becomes `profile_X_overall_confidence_bounds`.
3. **Rename `confidence` → `overall_confidence`** (CONTEXT.md D-06).
4. **Add `word_count integer NOT NULL DEFAULT 0` and `word_count_at_last_run integer NOT NULL DEFAULT 0`** on all three tables (CONTEXT.md D-06).
5. **`last_updated` is nullable (no DEFAULT):** `"last_updated" timestamp with time zone,` — null = "never run" (CONTEXT.md D-06, RESEARCH.md Example 1 line 550). This is the explicit divergence from M010 where `last_updated` had `DEFAULT now() NOT NULL`.
6. **`profile_attachment` extra columns:** `"relational_word_count" integer DEFAULT 0 NOT NULL` + `"activated" boolean DEFAULT false NOT NULL` (CONTEXT.md D-07).
7. **Dim jsonb columns all default to `'null'::jsonb`, NOT `'[]'::jsonb` or `'{}'::jsonb`** (CONTEXT.md D-08). M010 had mixed defaults based on column shape; M011 universally uses `'null'::jsonb` to encode "never inferred" cold state.
8. **Dim jsonb columns are NOT NULL** (column-level NOT NULL with `'null'::jsonb` SQL default = JSON null literal, not SQL NULL — same as M010 pattern). RESEARCH.md line 584 notes this is the standard.
9. **Seed INSERTs all use zero-confidence cold-start values:** `('primary', 1, '', 0, 0, 0)` for hexaco/schwartz; `('primary', 1, '', 0, 0, 0, 0, false)` for attachment (CONTEXT.md D-12, D-14). The dim columns are omitted from the INSERT — they default to `'null'::jsonb` per the CREATE TABLE default.
10. **Header comment must cite Phase 37 + HARD CO-LOC #M11-1** (not Phase 33 #M10-1).
11. **No values from `ground-truth.ts`** — psychological profiles are inferred-only; the `ground-truth.ts` documentation note from 0012:20-23 is omitted.

---

### `src/db/schema.ts` (3 new pgTable exports + type import additions)

**Primary analog:** `src/db/schema.ts:536-636` (the 4 M010 profile tables; `profileJurisdictional` at line 536 is the closest single-table template).

**Insertion point (verified):** AFTER `profileFamily` (ends at line 636), BEFORE `profileHistory` (starts at line 646). Three new exports `profileHexaco`, `profileSchwartz`, `profileAttachment` go in this gap.

**Type-import addition pattern** (`schema.ts:21-27`):
```typescript
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
  ProfileSnapshot,
} from '../memory/profiles/schemas.js';
```

**Append to this import block** (Plan 37-01 atomic):
```typescript
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../memory/profiles/psychological-schemas.js';
```

**`pgTable` definition pattern** (`schema.ts:536-560`, the verbatim `profileJurisdictional` template):
```typescript
export const profileJurisdictional = pgTable(
  'profile_jurisdictional',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    dataConsistency: real('data_consistency').notNull().default(0),
    currentCountry: jsonb('current_country').$type<JurisdictionalProfileData['current_country']>().notNull().default(sql`'null'::jsonb`),
    // ... 7 more jsonb columns
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_jurisdictional_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('profile_jurisdictional_data_consistency_bounds', sql`${table.dataConsistency} >= 0 AND ${table.dataConsistency} <= 1`),
  ],
);
```

**Divergences for the three psychological pgTables (per CONTEXT.md D-06..D-08 + RESEARCH.md Example 2):**

1. **Drop `dataConsistency` field + its check constraint.** Replaced with nothing — M011 does not store data_consistency at the column level.
2. **Rename `confidence` → `overallConfidence`** ; check constraint becomes `profile_X_overall_confidence_bounds`.
3. **Add `wordCount: integer('word_count').notNull().default(0)`** and `wordCountAtLastRun: integer('word_count_at_last_run').notNull().default(0)`.
4. **`lastUpdated` is nullable:** `lastUpdated: timestamp('last_updated', { withTimezone: true })` — drop `.notNull().defaultNow()` (RESEARCH.md line 610).
5. **Dim jsonb columns drop `.notNull()`:** Per RESEARCH.md Example 2 line 604-609, the dim columns use `jsonb('honesty_humility').$type<HexacoProfileData['honesty_humility']>().default(sql`'null'::jsonb`)` — **no `.notNull()` chained**. CONTEXT.md D-08 says jsonb columns "default to NULL" — interpret per the Pitfall 4 note in RESEARCH.md: `$type<T>` where the Zod schema is `.nullable()`. **Confirm with Phase 37 author**: M010 pattern uses `.notNull()` even with `'null'::jsonb` default; RESEARCH.md Example 2 omits `.notNull()`. The planner must pick one; the SQL migration MUST match. Recommend matching the M010 convention (`.notNull()` + `'null'::jsonb` default — JSON null literal, not SQL NULL) for consistency.
6. **`profile_attachment` extra columns:**
   ```typescript
   relationalWordCount: integer('relational_word_count').notNull().default(0),
   activated: boolean('activated').notNull().default(false),
   ```
   Will require `boolean` to be added to the destructured import block at `schema.ts:1-18` — verify it is already there (it is, at line 13).
7. **HEXACO dim names** (6): `honestyHumility`, `emotionality`, `extraversion`, `agreeableness`, `conscientiousness`, `openness` (RESEARCH.md Example 2).
8. **Schwartz value names** (10): `selfDirection`, `stimulation`, `hedonism`, `achievement`, `power`, `security`, `conformity`, `tradition`, `benevolence`, `universalism` (RESEARCH.md Example 3 line 678-688 maps the Zod field names; the Drizzle camelCase variant follows).
9. **Attachment dim names** (3): `anxious`, `avoidant`, `secure` (RESEARCH.md Example 3 line 693-696).

---

### `src/db/migrations/meta/0013_snapshot.json` (drizzle build artifact)

**Primary analog:** `src/db/migrations/meta/0012_snapshot.json`.

**Generation method:** Run `bash scripts/regen-snapshots.sh` (or equivalent `pnpm db:generate`). drizzle-kit emits the file from `schema.ts` after the new pgTable exports land. **Do NOT hand-author.**

**Pattern to verify post-regen:** Snapshot must contain `profile_hexaco`, `profile_schwartz`, `profile_attachment` table entries with matching column sets to `schema.ts`. The `0013_snapshot.json` MUST chain from `0012_snapshot.json` via `prevId`.

**Workflow:** Plan 37-01 task ordering: (1) Edit `schema.ts` with new pgTables, (2) hand-author `0013_psychological_profiles.sql`, (3) run `scripts/regen-snapshots.sh` which auto-emits `0013_snapshot.json` and (after the flag bump) the post-0013 acceptance artifact gets cleaned.

---

### `src/db/migrations/meta/_journal.json` (append entry)

**Primary analog:** `_journal.json:89-95` (idx 12 entry):
```json
{
  "idx": 12,
  "version": "7",
  "when": 1778482284254,
  "tag": "0012_operational_profiles",
  "breakpoints": true
}
```

**New entry to append at end of `entries` array** (close `]` and `}` after):
```json
{
  "idx": 13,
  "version": "7",
  "when": <CURRENT_TIMESTAMP_MS — MUST be > 1778482284254>,
  "tag": "0013_psychological_profiles",
  "breakpoints": true
}
```

**Divergences:** `idx` increments to 13, `tag` becomes `0013_psychological_profiles`, `when` MUST be strictly greater than `0012`'s `1778482284254` (Phase 32 #3 monotonic-`when` CI guardrail at `scripts/validate-journal-monotonic.ts` enforces this BEFORE migrations apply in `scripts/test.sh:50`). Use `Date.now()` at time of authoring, or any value > the prior entry.

**Format note:** This file is also auto-emitted by drizzle-kit / `regen-snapshots.sh` — the planner typically does not hand-append. But validation of the resulting append is required.

---

### `src/memory/profiles/psychological-schemas.ts` (NEW — Zod v3+v4 dual schemas)

**Primary analog:** `src/memory/profiles/schemas.ts` (entire 241-line file). The shape, header comment block, and v3/v4 pairing discipline transfer verbatim.

**Header pattern** (`schemas.ts:1-19`):
```typescript
/**
 * src/memory/profiles/schemas.ts — Phase 33 Plan 33-01 Task 1 + Plan 33-02 Task 1
 *                                  (PROF-05 substrate)
 *
 * Zod v3 + v4 dual schemas for the 4 M010 operational profile dimensions.
 * Field names locked against FEATURES.md §2.1-2.4 per Open Question 1 in
 * 33-RESEARCH.md.
 *
 * Schema discipline:
 *   - v3 schemas use .strict() — rejects unknown jsonb keys at read boundary
 *     (defends against future profile-shape drift in stored rows)
 *   - v4 mirrors OMIT .strict() per M009 D-29-02 (SDK doesn't parse
 *     strict-mode JSON Schema; v3 re-validates in the retry loop)
 *   - Both schemas MUST stay in lock-step (M009 D-29-02 discipline)
 *   - data_consistency lives at the top level (matches the SQL column;
 *     simpler for Phase 34 substrate-hash computation)
 */
import { z } from 'zod';
import * as zV4 from 'zod/v4';
```

**v3+v4 dual schema pattern per profile** (`schemas.ts:23-68`, the `JurisdictionalProfileSchemaV3` + V4 pair):
```typescript
export const JurisdictionalProfileSchemaV3 = z
  .object({
    current_country: z.string().nullable(),
    physical_location: z.string().nullable(),
    residency_status: z.array(z.object({
      type: z.string(),
      value: z.string(),
      since: z.string().optional(),
    }).strict()).max(20),
    // ... more fields
    data_consistency: z.number().min(0).max(1),
  })
  .strict();
export type JurisdictionalProfileData = z.infer<typeof JurisdictionalProfileSchemaV3>;

export const JurisdictionalProfileSchemaV4 = zV4.object({
  current_country: zV4.string().nullable(),
  // ... same fields, no .strict()
});
```

**Divergences for psychological version (per CONTEXT.md D-25..D-28 + RESEARCH.md Example 3):**

1. **No `data_consistency` field** in any psychological schema — M011 stores per-dim `confidence` only; `overall_confidence` lives at the row metadata level, not in the jsonb.
2. **Shared per-dim factory `hexacoSchwartzDimensionSchemaV3`** (CONTEXT.md D-27, RESEARCH.md Example 3 line 635-639):
   ```typescript
   const hexacoSchwartzDimensionSchemaV3 = z.object({
     score: z.number().min(1).max(5),
     confidence: z.number().min(0).max(1),
     last_updated: z.string().datetime(),
   }).strict().nullable();
   ```
3. **Nominal-separate `attachmentDimensionSchemaV3`** (identical shape but separately named; CONTEXT.md D-27, RESEARCH.md Example 3 line 648-652).
4. **`HexacoProfileSchemaV3`** — 6 dim fields: `honesty_humility`, `emotionality`, `extraversion`, `agreeableness`, `conscientiousness`, `openness`. Each uses `hexacoSchwartzDimensionSchemaV3` (which is `.nullable()` at the factory level).
5. **`SchwartzProfileSchemaV3`** — 10 value fields: `self_direction`, `stimulation`, `hedonism`, `achievement`, `power`, `security`, `conformity`, `tradition`, `benevolence`, `universalism` (RESEARCH.md Example 3 line 678-688).
6. **`AttachmentProfileSchemaV3`** — 3 dim fields: `anxious`, `avoidant`, `secure`. NOTE: `relational_word_count` and `activated` are row-level metadata columns (stripped by `stripPsychologicalMetadataColumns`), NOT in the Zod schema (CONTEXT.md D-26, RESEARCH.md Example 3 line 697-698).
7. **Each schema uses `.strict()` at the top level** (rejects unknown jsonb keys; mirrors `schemas.ts:45` discipline).
8. **v4 mirror** — same shape, no `.strict()`, uses `zV4.object(...)` per `schemas.ts:48-68` pattern.
9. **Export both `*Data` TypeScript types and v3+v4 schemas** — `schema.ts`'s `.$type<HexacoProfileData[...]>()` chain depends on the `HexacoProfileData` type being exportable from this file.
10. **`last_updated: zV4.string()` (no `.datetime()`)** in v4 per RESEARCH.md Example 3 line 644 ("v4 .datetime() availability check needed"). Planner verifies; v3 keeps `.datetime()`.

---

### `src/memory/profiles/psychological-shared.ts` (NEW — substrate loader)

**Primary analog:** `src/memory/profiles/shared.ts:206-254` (the `loadProfileSubstrate(now)` function). The discriminated-union return shape is novel but takes its inspiration from M009 ritual return-shapes.

**Header + imports pattern** (`shared.ts:1-74`):
```typescript
/**
 * src/memory/profiles/shared.ts — Phase 34 Plan 02 (M010)
 *
 * Shared substrate loader + SHA-256 substrate-hash + generic generator helper
 * ...
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  decisions,
  profileHistory,
} from '../../db/schema.js';
import { getEpisodicSummariesRange } from '../../pensieve/retrieve.js';
```

**Substrate loader function body pattern** (`shared.ts:206-254`):
```typescript
export async function loadProfileSubstrate(now: Date = new Date()): Promise<ProfileSubstrate> {
  const windowStart = new Date(now.getTime() - SUBSTRATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [pensieveRows, episodicRows, decisionRows] = await Promise.all([
    db
      .select()
      .from(pensieveEntries)
      .where(
        and(
          isNull(pensieveEntries.deletedAt),
          inArray(
            pensieveEntries.epistemicTag,
            [...PROFILE_SUBSTRATE_TAGS] as unknown as ...,
          ),
          gte(pensieveEntries.createdAt, windowStart),
          lte(pensieveEntries.createdAt, now),
        ),
      )
      .orderBy(asc(pensieveEntries.createdAt)),
    getEpisodicSummariesRange(windowStart, now),
    // ... decisions select
  ]);

  return {
    pensieveEntries: pensieveRows,
    episodicSummaries: episodicRows,
    decisions: decisionRows,
    entryCount: pensieveRows.length,
  };
}
```

**Luxon calendar-month pattern** (mirror from `src/rituals/cadence.ts:72` + `weekly-review-sources.ts:112`):
```typescript
import { DateTime } from 'luxon';
const nowParis = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
const monthStart = nowParis.startOf('month').minus({ months: 1 });
const monthEnd = monthStart.endOf('month');
```

**Divergences for psychological version (per CONTEXT.md D-15..D-20 + RESEARCH.md Example 4):**

1. **Discriminated union return** (CONTEXT.md D-16):
   ```typescript
   type PsychologicalProfileType = 'hexaco' | 'schwartz' | 'attachment';

   type PsychologicalSubstrate<T> =
     | { belowThreshold: true; wordCount: number; neededWords: number }
     | {
         belowThreshold: false;
         corpus: (typeof pensieveEntries.$inferSelect)[];
         episodicSummaries: (typeof episodicSummaries.$inferSelect)[];
         wordCount: number;
         prevHistorySnapshot: T | null;
       };
   ```
   M010 used a single shape `ProfileSubstrate`. M011 splits into below-threshold vs above-threshold so downstream callers MUST handle below-threshold explicitly (TS narrowing after `if (substrate.belowThreshold)`).
2. **`profileType` first parameter** (CONTEXT.md D-15):
   ```typescript
   export async function loadPsychologicalSubstrate<T = unknown>(
     profileType: PsychologicalProfileType,
     now: Date = new Date(),
   ): Promise<PsychologicalSubstrate<T>>;
   ```
3. **Calendar-month boundary, NOT 60-day rolling** (CONTEXT.md D-17, RESEARCH.md Example 4 line 751-755). Replace M010's `SUBSTRATE_WINDOW_DAYS = 60` arithmetic with Luxon `startOf('month').minus({months:1})` + `.endOf('month')`.
4. **Source filter `source='telegram'`** added to the `pensieveEntries` query — NOT present in M010 (M010 was source-agnostic) (CONTEXT.md D-17, RESEARCH.md Example 4 line 763):
   ```typescript
   eq(pensieveEntries.source, 'telegram'),
   ```
5. **Epistemic-tag exclusion `!= 'RITUAL_RESPONSE'`** instead of M010's `inArray(..., PROFILE_SUBSTRATE_TAGS)` whitelist (CONTEXT.md D-17, RESEARCH.md Example 4 line 764-767):
   ```typescript
   or(
     isNull(pensieveEntries.epistemicTag),
     ne(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'),
   ),
   ```
   Imports: add `ne, or, desc` to the `drizzle-orm` import.
6. **Inline word counting** (CONTEXT.md D-18, RESEARCH.md Example 4 line 742-744) — private helper:
   ```typescript
   function countWords(text: string): number {
     return text.trim().split(/\s+/).filter((s) => s.length > 0).length;
   }
   ```
   Do NOT export per CONTEXT.md `<specifics>` ("`countWords` helper is private").
7. **5,000-word floor gate fires BEFORE Sonnet call** (CONTEXT.md D-19, RESEARCH.md Example 4 line 780-786):
   ```typescript
   if (wordCount < MIN_SPEECH_WORDS) {
     return { belowThreshold: true, wordCount, neededWords: MIN_SPEECH_WORDS - wordCount };
   }
   ```
   Import `MIN_SPEECH_WORDS` from `../confidence.js`. Use `<` (strict less-than) — exact count `5000` is "at threshold" → above, per CONTEXT.md `<specifics>` ("threshold semantics `>=`" lesson from M009 lt→lte).
8. **`prevHistorySnapshot` lookup** (CONTEXT.md D-16, RESEARCH.md Example 4 line 789-797):
   ```typescript
   const PROFILE_TYPE_TO_TABLE_NAME: Record<PsychologicalProfileType, string> = {
     hexaco: 'profile_hexaco',
     schwartz: 'profile_schwartz',
     attachment: 'profile_attachment',
   } as const;

   const prevSnapshotRow = await db
     .select()
     .from(profileHistory)
     .where(eq(profileHistory.profileTableName, PROFILE_TYPE_TO_TABLE_NAME[profileType]))
     .orderBy(desc(profileHistory.recordedAt))
     .limit(1);
   ```
   Uses existing `profile_history_table_recorded_idx` (Drizzle index at `schema.ts:656`).
9. **NO decisions table query** — M011 substrate is corpus-based (Pensieve only) + episodic context. M010 includes resolved-decisions; M011 does not. Drop from `Promise.all`.
10. **NO substrate-hash computation in this file** — Phase 37 is substrate-only; hash compute moves to Phase 38's generators (CONTEXT.md `<domain>` "Explicitly NOT in this phase"). Do NOT replicate `computeSubstrateHash` from M010 `shared.ts:298-311`.
11. **NO `runProfileGenerator`** — that's Phase 38 (CONTEXT.md `<domain>`).
12. **Episodic summaries do NOT count toward wordCount** (CONTEXT.md D-17). They are loaded only when above threshold (RESEARCH.md Example 4 line 789-791 inside `Promise.all`).

---

### `src/memory/profiles.ts` (MOD — append psychological reader)

**Primary analog:** `src/memory/profiles.ts` itself (4 referenced patterns at lines 59, 70-74, 83-87, 100-152, 191-199).

**Insertion strategy:** ALL new exports go AFTER `getOperationalProfiles()` (line 199) so the operational reader and its types stay first. Per CONTEXT.md D-21: "Does NOT extend the operational reader's return type (8+ existing call sites)."

**Append to existing imports** (`profiles.ts:18-36`):
```typescript
import {
  profileJurisdictional,
  profileCapital,
  profileHealth,
  profileFamily,
  // ADD:
  profileHexaco,
  profileSchwartz,
  profileAttachment,
} from '../db/schema.js';
```

```typescript
// ADD new import block:
import {
  HexacoProfileSchemaV3,
  SchwartzProfileSchemaV3,
  AttachmentProfileSchemaV3,
  type HexacoProfileData,
  type SchwartzProfileData,
  type AttachmentProfileData,
} from './profiles/psychological-schemas.js';
import type { PsychologicalProfileType } from './profiles/psychological-shared.js';
```

**`Dimension` type pattern** (`profiles.ts:59`):
```typescript
export type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';
```

**Schema-version dispatcher pattern** (`profiles.ts:83-87`):
```typescript
const PROFILE_SCHEMAS: Record<Dimension, Record<number, z.ZodTypeAny>> = {
  jurisdictional: { 1: JurisdictionalProfileSchemaV3 },
  capital: { 1: CapitalProfileSchemaV3 },
  health: { 1: HealthProfileSchemaV3 },
  family: { 1: FamilyProfileSchemaV3 },
};
```

**`readOneProfile` 3-layer parse defense pattern** (`profiles.ts:100-152`):
```typescript
async function readOneProfile<T>(
  dimension: Dimension,
  table: any,
): Promise<ProfileRow<T> | null> {
  try {
    const rows = await db.select().from(table).where(eq(table.name, 'primary')).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0]!;

    // Layer 1: schema_version match
    const parser = PROFILE_SCHEMAS[dimension][row.schemaVersion as number];
    if (!parser) {
      logger.warn(
        { dimension, schemaVersion: row.schemaVersion },
        'chris.profile.read.schema_mismatch',
      );
      return null;
    }

    // Layer 2: safeParse
    const dataToValidate = stripMetadataColumns(row);
    const parsed = parser.safeParse(dataToValidate);
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
    // Layer 3: unknown throw
    logger.warn(
      { dimension, error: error instanceof Error ? error.message : String(error) },
      'chris.profile.read.error',
    );
    return null;
  }
}
```

**`getOperationalProfiles` parallel reader pattern** (`profiles.ts:191-199`):
```typescript
export async function getOperationalProfiles(): Promise<OperationalProfiles> {
  const [jurisdictional, capital, health, family] = await Promise.all([
    readOneProfile<JurisdictionalProfileData>('jurisdictional', profileJurisdictional),
    readOneProfile<CapitalProfileData>('capital', profileCapital),
    readOneProfile<HealthProfileData>('health', profileHealth),
    readOneProfile<FamilyProfileData>('family', profileFamily),
  ]);
  return { jurisdictional, capital, health, family };
}
```

**Divergences for psychological version (per CONTEXT.md D-21..D-24 + RESEARCH.md Example 5):**

1. **`PsychologicalProfileType` imported, not redefined.** It lives in `psychological-shared.ts` (CONTEXT.md D-16 + D-15). Re-export from `profiles.ts` so Phase 39 consumers have a stable import path:
   ```typescript
   export type { PsychologicalProfileType } from './profiles/psychological-shared.js';
   ```
2. **`PsychologicalProfiles` interface** mirrors `OperationalProfiles` shape but with the 3 psych keys (RESEARCH.md Example 5 line 840-844).
3. **`PSYCHOLOGICAL_PROFILE_SCHEMAS` dispatcher** mirrors `PROFILE_SCHEMAS` exactly with 3 entries (CONTEXT.md D-24, RESEARCH.md Example 5 line 834-838).
4. **`readOnePsychologicalProfile<T>(profileType, table)`** mirrors `readOneProfile` shape with these differences (RESEARCH.md Example 5 line 846-892):
   - Parameter `dimension: Dimension` → `profileType: PsychologicalProfileType`.
   - Log event names change: `'chris.profile.read.schema_mismatch'` → `'chris.psychological.profile.read.schema_mismatch'`; `'chris.profile.read.error'` → `'chris.psychological.profile.read.unknown_error'` (CONTEXT.md D-22, D-23 — distinct namespaces).
   - **Split layer 2 into two events**: `chris.psychological.profile.read.parse_failed` for safeParse failure (distinct from layer-1 schema_mismatch) per CONTEXT.md D-23.
   - **`row.confidence` → `row.overallConfidence`** (M011 column rename).
   - **`lastUpdated: row.lastUpdated ?? new Date(0)`** — null = "never run" coalesces to epoch for the `ProfileRow<T>.lastUpdated: Date` contract (RESEARCH.md Example 5 line 881). M010's column is NOT NULL so this coalescence is novel to M011.
5. **`stripPsychologicalMetadataColumns`** is a new helper (RESEARCH.md Example 5 line 894-913) — strips: `id, name, schemaVersion, substrateHash, overallConfidence, wordCount, wordCountAtLastRun, lastUpdated, createdAt, relationalWordCount, activated`. The last two (attachment-only) are harmlessly absent on hexaco/schwartz rows.
6. **`getPsychologicalProfiles()`** exact mirror of `getOperationalProfiles` with 3 keys (RESEARCH.md Example 5 line 915-922).
7. **DO NOT modify `getOperationalProfiles` or `formatProfilesForPrompt`** (`profiles.ts:230-391`) — Phase 39 will add a separate `formatPsychologicalProfilesForPrompt` (not in Phase 37 scope per CONTEXT.md `<domain>`).
8. **`ProfileRow<T>` interface is reused unchanged** (`profiles.ts:41-46`) — M011 fits the existing shape (data, confidence, lastUpdated, schemaVersion).

---

### `src/memory/confidence.ts` (MOD — append 3 exports)

**Primary analog:** `src/memory/confidence.ts:27,31,63-65` (existing M010 threshold constants + `isAboveThreshold`).

**Existing constants + helper** (`confidence.ts:27,31,63-65`):
```typescript
export const MIN_ENTRIES_THRESHOLD = 10;
export const SATURATION = 50;

export function isAboveThreshold(entryCount: number): boolean {
  return entryCount >= MIN_ENTRIES_THRESHOLD;
}
```

**Append at end of file** (per CONTEXT.md D-29 + `<code_context>` "Integration Points"):
```typescript
/** PSCH-08 floor — psychological profile substrate requires this many words of
 *  first-party telegram speech in the previous calendar month before a generator
 *  is allowed to fire. Locked in 37-CONTEXT.md D-29. */
export const MIN_SPEECH_WORDS = 5000;

/** D028 attachment activation threshold — `profile_attachment` flips
 *  `activated = true` when relational_word_count >= this over a 60-day window.
 *  Population sweep is post-M011 (deferred per CONTEXT.md). */
export const RELATIONAL_WORD_COUNT_THRESHOLD = 2000;

/** Word-count parallel to `isAboveThreshold` for psychological substrates.
 *  M009 lt→lte lesson applies: use `>=` so wordCount === MIN_SPEECH_WORDS is
 *  "at threshold" → above. */
export function isAboveWordThreshold(wordCount: number): boolean {
  return wordCount >= MIN_SPEECH_WORDS;
}
```

**Divergences (vs M010 helpers):**
1. **Unit is words, not entry-count.** Two independent threshold systems — they do NOT compose (CONTEXT.md D-29).
2. **No `wordSaturation` constant.** Defer to Phase 38 (CONTEXT.md D-30).
3. **Existing helpers untouched** — `MIN_ENTRIES_THRESHOLD`, `SATURATION`, `computeProfileConfidence`, `isAboveThreshold` are not modified (CONTEXT.md D-29 last paragraph).
4. **`>=` semantics** — verbatim mirror of `confidence.ts:64` discipline. Do NOT use `<` and invert (the inversion is the source of the M009 `lt→lte` regression).

---

### `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (NEW — boundary audit)

**Primary analog:** `src/chris/__tests__/boundary-audit.test.ts` (entire 127-line file). The shape is verbatim-mirrorable with token swaps.

**Imports + project root resolution pattern** (`boundary-audit.test.ts:1-45`):
```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Walk up from src/chris/__tests__/ to project root.
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

async function readSource(relPath: string): Promise<string> {
  return readFile(resolve(PROJECT_ROOT, relPath), 'utf8');
}
```

**Per-line regex scan helper** (`boundary-audit.test.ts:48-63`):
```typescript
function findEpisodicReferences(
  contents: string,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const matched = /\bepisodic_summaries\b|\bepisodicSummaries\b/.test(line);
    if (matched) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}
```

**Describe/it/expect pattern** (`boundary-audit.test.ts:69-93`):
```typescript
describe('RETR-05: Known Facts boundary (summary text never enters Known Facts block)', () => {
  it('src/chris/personality.ts has zero references to episodic_summaries', async () => {
    const src = await readSource('src/chris/personality.ts');
    const hits = findEpisodicReferences(src);
    expect(
      hits,
      `RETR-05 violation: src/chris/personality.ts references episodic_summaries at:\n` +
        formatHits(hits) +
        '\n\nThe Known Facts block (buildKnownFactsBlock) must ONLY pull from ' +
        'GROUND_TRUTH. Summary text is interpretation, not fact. See D031.',
    ).toEqual([]);
  });
  // ... more its
});
```

**Divergences for psych version (per CONTEXT.md D-31..D-34 + RESEARCH.md Example 6):**

1. **Path-depth change for project root.** The test file lives at `src/memory/profiles/__tests__/`, four levels deep. Replace `resolve(__dirname, '..', '..', '..')` with `resolve(__dirname, '..', '..', '..', '..')` (RESEARCH.md Example 6 line 939).
2. **Two regex patterns, not one** (CONTEXT.md D-32, RESEARCH.md Example 6 line 960-981):
   ```typescript
   const OPERATIONAL_VOCAB = /\b(jurisdictional|capital|health|family)\b/;
   const PSYCHOLOGICAL_VOCAB = /\b(hexaco|schwartz|attachment)\b/;
   ```
3. **Two file lists** (CONTEXT.md D-32, RESEARCH.md Example 6 line 961-981):
   - `PSYCHOLOGICAL_FILES`: `['src/memory/profiles/psychological-schemas.ts', 'src/memory/profiles/psychological-shared.ts']`
   - `OPERATIONAL_FILES`: `['src/memory/profile-prompt.ts', 'src/memory/profile-updater.ts', 'src/memory/profiles/shared.ts', 'src/memory/profiles/schemas.ts', 'src/memory/profiles/jurisdictional.ts', 'src/memory/profiles/capital.ts', 'src/memory/profiles/health.ts', 'src/memory/profiles/family.ts']`
4. **Self-allowlist via explicit absence:** The test file `psych-boundary-audit.test.ts` is intentionally NOT in `PSYCHOLOGICAL_FILES` (CONTEXT.md D-34). Same M008 pattern at `boundary-audit.test.ts` — the file simply doesn't appear in its own hardcoded input-file array. NO glob filter needed.
5. **`src/memory/profiles.ts` is OMITTED from both directions** (RESEARCH.md Example 6 line 978-980). It contains both operational and psychological reader exports by design (CONTEXT.md D-21).
6. **Two `describe` blocks**, one per direction (RESEARCH.md Example 6 line 983-1013).
7. **Loop-based `it` generation** (RESEARCH.md Example 6 line 984-995):
   ```typescript
   for (const file of PSYCHOLOGICAL_FILES) {
     it(`${file} has zero operational-vocabulary references`, async () => {
       const src = await readSource(file);
       const hits = findHits(src, OPERATIONAL_VOCAB);
       expect(hits, ...).toEqual([]);
     });
   }
   ```
8. **Failure messages cite D047** (CONTEXT.md D-31, D-32): `'D047 violation: ${file} references ...'`.
9. **`findHits(contents, pattern)`** is generic (takes a regex parameter) instead of M008's hardcoded-pattern `findEpisodicReferences` (RESEARCH.md Example 6 line 945-953).

---

### `src/memory/profiles/__tests__/psychological-shared.test.ts` (NEW — integration test)

**Primary analog:** `src/memory/profiles/__tests__/shared.test.ts` (entire 575-line file; the first 120 lines cover the fixture setup + pure-function tests pattern).

**Header + Docker harness reference** (`shared.test.ts:1-23`):
```typescript
/**
 * src/memory/profiles/__tests__/shared.test.ts — Phase 34 Plan 02 Task 5
 *
 * Real-DB integration tests for `loadProfileSubstrate` + pure-function tests
 * for `computeSubstrateHash`. Mirrors src/rituals/__tests__/weekly-review-sources.test.ts
 * (Docker postgres setup) per 34-PATTERNS.md ...
 *
 * Coverage:
 *   - Tag-filter correctness ...
 *   - 60-day rolling window ...
 *   - entryCount = pensieveEntries.length (D-20)
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/shared.test.ts
 */
```

**TRUNCATE-CASCADE cleanup pattern** (`shared.test.ts:42-51`):
```typescript
async function cleanupTables() {
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
  await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
}
```

**Pure-function describe block pattern** (`shared.test.ts:57-90`):
```typescript
describe('computeSubstrateHash — pure-function determinism (D-15, D-16)', () => {
  const emptySubstrate: ProfileSubstrate = { /* fixture */ };

  it('produces a 64-char hex string (SHA-256)', () => {
    const h = computeSubstrateHash(emptySubstrate, { substrate_hash: '', schema_version: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  // ... more its
});
```

**Divergences for psychological version:**

1. **No `computeSubstrateHash` tests** — that helper does not exist in Phase 37 (deferred to Phase 38 per CONTEXT.md `<domain>`).
2. **Three describe blocks for `loadPsychologicalSubstrate` discriminated-union branches:**
   - `'loadPsychologicalSubstrate — below-threshold branch (wordCount < 5000)'` — asserts return shape `{ belowThreshold: true, wordCount, neededWords }`.
   - `'loadPsychologicalSubstrate — above-threshold branch (wordCount >= 5000)'` — asserts return shape `{ belowThreshold: false, corpus, episodicSummaries, wordCount, prevHistorySnapshot }`.
   - `'loadPsychologicalSubstrate — source filter (telegram only, RITUAL_RESPONSE excluded)'` — inserts a `source='gmail'` row + a `RITUAL_RESPONSE` row, asserts they're excluded from corpus.
3. **Calendar-month fixture** — pin `now` to a known date (e.g., `new Date('2026-06-15T12:00:00Z')`) and insert fixture rows split across:
   - rows in the prior calendar month (Europe/Paris) — IN window
   - rows in the current month — OUT (after windowEnd)
   - rows in two months prior — OUT (before windowStart)
4. **Word-counting assertion** — fixture row with known content (e.g., `'word '.repeat(5000)` for at-threshold; `'word '.repeat(4999)` for below).
5. **prevHistorySnapshot fixture** — insert a `profile_history` row with `profile_table_name = 'profile_hexaco'` + a known `snapshot` jsonb, assert it's returned in `loadPsychologicalSubstrate('hexaco')` above-threshold branch.
6. **Cleanup must include `profile_history`** in the TRUNCATE list (M011 substrate loader reads it; M010 substrate loader did not).
7. **NO `decisions` table involvement** — M011 substrate doesn't query it (RESEARCH.md Example 4).

---

### `src/memory/profiles/__tests__/psychological-schemas.test.ts` (NEW — unit test)

**Primary analog:** `src/memory/profiles/__tests__/schemas.test.ts` (entire 60-line readable head shown above).

**Imports pattern** (`schemas.test.ts:1-20`):
```typescript
import { describe, it, expect } from 'vitest';
import {
  JurisdictionalProfileSchemaV3,
  CapitalProfileSchemaV3,
  // ... etc
  JurisdictionalProfileSchemaV4,
  // ... etc
} from '../schemas.js';
```

**Valid fixture pattern** (`schemas.test.ts:24-40`):
```typescript
const validJurisdictional = {
  current_country: 'Russia',
  physical_location: 'Saint Petersburg',
  // ... matches migration 0012 seed-row jsonb shape
  data_consistency: 0,
};
```

**Divergences for psych version:**

1. **Imports from `../psychological-schemas.js`** — 6 schemas (3 v3 + 3 v4) + 3 types (`HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData`).
2. **Valid fixtures must match cold-start seed-row shape** (all dims null at seed; nullable factory accepts `null`):
   ```typescript
   const validHexacoColdStart = {
     honesty_humility: null,
     emotionality: null,
     extraversion: null,
     agreeableness: null,
     conscientiousness: null,
     openness: null,
   };

   const validHexacoPopulated = {
     honesty_humility: { score: 3.5, confidence: 0.7, last_updated: '2026-06-01T00:00:00.000Z' },
     // ...
   };
   ```
3. **Per-dim shape boundary tests** — score must be in `[1.0, 5.0]`; confidence in `[0.0, 1.0]`; last_updated must be ISO 8601 datetime string.
4. **Reject tests**:
   - Score 0.5 (below min) → reject.
   - Score 5.5 (above max) → reject.
   - Unknown key in dim object → reject (`.strict()` at factory level).
   - Unknown top-level key → reject (`.strict()` at schema level).
5. **v3/v4 lockstep test** — same valid fixture parses successfully under both v3 and v4 schemas (mirrors `schemas.test.ts` v4 mirror sanity tests).
6. **NO DB calls** — runs in microseconds (same as M010 schemas.test.ts).

---

### `scripts/test.sh` (MOD — append psql line + smoke gate)

**Primary analog:** Lines 20, 82-83 (M010 variable + apply line), 218-262 (M010 smoke gate).

**Variable declaration pattern** (`test.sh:20`):
```bash
MIGRATION_12_SQL="src/db/migrations/0012_operational_profiles.sql"
```

**psql apply line pattern** (`test.sh:82-83`):
```bash
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_12_SQL"
```

**Smoke gate pattern (multi-assertion)** (`test.sh:218-248`):
```bash
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
      ...
  " | tee /tmp/m010_smoke.txt
grep -q "^5|1|1|1|1|0|0.3|0.2|0|0$" /tmp/m010_smoke.txt || { echo "❌ Migration 0012 substrate incomplete or seed values wrong"; cat /tmp/m010_smoke.txt; exit 1; }
echo "✓ Migration 0012 substrate verified (5 tables + 4 seed rows + 0 history rows + correct confidence values)"
```

**Column-count smoke assertion** (`test.sh:252-262` — Phase 33 extended Never-Retrofit guard):
```bash
echo "🔍 Verifying migration 0012 non-retrofittable columns..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
    SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = 'public'
     AND table_name IN ('profile_jurisdictional', 'profile_capital', 'profile_health', 'profile_family')
     AND column_name IN ('schema_version', 'substrate_hash', 'data_consistency', 'name', 'confidence');
  " | tee /tmp/m010_cols.txt
# 4 tables × 5 required columns = 20 rows
grep -q "^20$" /tmp/m010_cols.txt || ...
```

**Divergences for Phase 37 (per CONTEXT.md D-35 + `<code_context>` Integration Points):**

1. **Add variable line at `test.sh:20-21` boundary:**
   ```bash
   MIGRATION_13_SQL="src/db/migrations/0013_psychological_profiles.sql"
   ```
2. **Add psql apply line immediately AFTER the 0012 line at `test.sh:82-83`** (per CONTEXT.md D-35 "append immediately after"):
   ```bash
   docker compose -f "$COMPOSE_FILE" exec -T postgres \
     psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_13_SQL"
   ```
3. **Add smoke gate AFTER the 0012 smoke gate (after line 262):** 3 tables, 3 seed rows, all `overall_confidence = 0`, plus `word_count = 0`, plus `relational_word_count = 0` and `activated = false` on attachment:
   ```bash
   echo "🔍 Verifying migration 0013 substrate..."
   docker compose -f "$COMPOSE_FILE" exec -T postgres \
     psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
       SELECT
         (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name IN ('profile_hexaco', 'profile_schwartz', 'profile_attachment')) AS table_count,
         (SELECT COUNT(*) FROM profile_hexaco WHERE name = 'primary') AS hex_seed,
         (SELECT COUNT(*) FROM profile_schwartz WHERE name = 'primary') AS schw_seed,
         (SELECT COUNT(*) FROM profile_attachment WHERE name = 'primary') AS att_seed,
         (SELECT overall_confidence::text FROM profile_hexaco WHERE name = 'primary') AS hex_conf,
         (SELECT word_count::text FROM profile_hexaco WHERE name = 'primary') AS hex_wc,
         (SELECT relational_word_count::text FROM profile_attachment WHERE name = 'primary') AS att_rwc,
         (SELECT activated::text FROM profile_attachment WHERE name = 'primary') AS att_act;
     " | tee /tmp/m011_smoke.txt
   grep -q "^3|1|1|1|0|0|0|f$" /tmp/m011_smoke.txt || { echo "❌ Migration 0013 substrate incomplete or seed values wrong"; cat /tmp/m011_smoke.txt; exit 1; }
   echo "✓ Migration 0013 substrate verified (3 tables + 3 seed rows + cold-start values)"
   ```
4. **Column-count assertion extension** — extend the smoke gate to verify Never-Retrofit Checklist columns on all 3 psych tables. Recommend a separate query block (not folded into existing 0012 column-count gate to avoid mixing concerns):
   ```bash
   echo "🔍 Verifying migration 0013 non-retrofittable columns..."
   docker compose -f "$COMPOSE_FILE" exec -T postgres \
     psql -U chris -d chris -v ON_ERROR_STOP=1 -tAq -c "
       SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name IN ('profile_hexaco', 'profile_schwartz', 'profile_attachment')
        AND column_name IN ('schema_version', 'substrate_hash', 'name', 'overall_confidence',
                            'word_count', 'word_count_at_last_run');
     " | tee /tmp/m011_cols.txt
   # 3 tables × 6 columns = 18 rows
   grep -q "^18$" /tmp/m011_cols.txt || { echo "❌ Migration 0013 non-retrofittable columns incomplete"; cat /tmp/m011_cols.txt; exit 1; }
   echo "✓ Migration 0013 non-retrofittable columns verified (schema_version + substrate_hash + name + overall_confidence + word_count + word_count_at_last_run on all 3 profile tables)"
   ```
   Plus a separate query for attachment-specific columns:
   ```bash
   # profile_attachment requires 2 additional non-retrofittable columns (D-07)
   ATTACH_COLS=$(docker compose -f "$COMPOSE_FILE" exec -T postgres \
     psql -U chris -d chris -tAc \
     "SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profile_attachment'
      AND column_name IN ('relational_word_count', 'activated');")
   if [[ "${ATTACH_COLS// /}" != "2" ]]; then
     echo "❌ FAIL: profile_attachment missing relational_word_count + activated columns (got: '${ATTACH_COLS}')"; exit 1;
   fi
   echo "✓ profile_attachment D028 columns verified (relational_word_count + activated)"
   ```
5. **HARD CO-LOC #M11-1** — same gate-comment cite as 0012:
   ```bash
   # Phase 37 (M011 v2.6) — psychological profiles substrate smoke gate.
   # HARD CO-LOCATION #M11-1: this gate ships in the SAME plan as the migration
   # SQL + drizzle meta snapshot + schema.ts table defs (Plan 37-01).
   ```

---

### `scripts/regen-snapshots.sh` (MOD — bump 0012 → 0013 sentinels)

**Primary analog:** Multiple sites in the same file:
- `regen-snapshots.sh:67` — `MIGRATION_12=` variable.
- `regen-snapshots.sh:118-122` — phase-comment block.
- `regen-snapshots.sh:140-153` — cleanup `find -delete` calls.
- `regen-snapshots.sh:375` — `apply_sql "${MIGRATION_12}"` apply step.
- `regen-snapshots.sh:380-399` — post-apply acceptance flag + cleanup.

**Variable declaration pattern** (`regen-snapshots.sh:55-67`):
```bash
MIGRATION_0="${MIGRATIONS_DIR}/0000_curved_colonel_america.sql"
MIGRATION_1="${MIGRATIONS_DIR}/0001_add_photos_psychology_mode.sql"
# ...
MIGRATION_11="${MIGRATIONS_DIR}/0011_rename_daily_voice_note_to_journal.sql"
MIGRATION_12="${MIGRATIONS_DIR}/0012_operational_profiles.sql"
```

**Phase-comment-block pattern** (`regen-snapshots.sh:118-121`):
```bash
# Phase 33 extends this discipline to 0012 — committed 0012_snapshot.json must
# be preserved (it ships in Plan 33-01); only the post-0012 acceptance-gate
# artifact (0013_snapshot.json named by drizzle's sequence-counter) is wiped
# when this run produced it.
```

**Cleanup pattern** (`regen-snapshots.sh:140-153`):
```bash
find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0012_acceptance_check*.sql" -delete 2>/dev/null || true
find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0013_acceptance_check*.sql" -delete 2>/dev/null || true
# ...
if [[ "${REGEN_PRODUCED_ACCEPTANCE}" -eq 1 ]]; then
  find "${META_DIR}" -name "0013_snapshot.json" -delete 2>/dev/null || true
fi
```

**Apply pattern** (`regen-snapshots.sh:373-385`):
```bash
apply_sql "${MIGRATION_11}"
apply_sql "${MIGRATION_12}"

# Mark that THIS run is responsible for any post-0012 snapshot ...
# (The number after 0012 is 0013.)
REGEN_PRODUCED_ACCEPTANCE=1
```

**Divergences for Phase 37 (per CONTEXT.md D-36):**

1. **Add `MIGRATION_13` variable at `regen-snapshots.sh:67`:**
   ```bash
   MIGRATION_13="${MIGRATIONS_DIR}/0013_psychological_profiles.sql"
   ```
2. **Append a Phase 37 comment block after the Phase 33 block (~`:122`):**
   ```bash
   # Phase 37 extends this discipline to 0013 — committed 0013_snapshot.json must
   # be preserved (it ships in Plan 37-01); only the post-0013 acceptance-gate
   # artifact (0014_snapshot.json named by drizzle's sequence-counter) is wiped
   # when this run produced it.
   ```
3. **Append `0013_acceptance_check*.sql` line at the cleanup block** (RESEARCH.md "State of the Art" line 1029 notes `REGEN_PRODUCED_ACCEPTANCE` flag protects `0013_snapshot.json` as the "future-acceptance" artifact — this gets bumped to `0014_snapshot.json` because the real 0013 is now landing):
   ```bash
   find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0013_acceptance_check*.sql" -delete 2>/dev/null || true
   find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0014_acceptance_check*.sql" -delete 2>/dev/null || true
   ```
4. **Update the `REGEN_PRODUCED_ACCEPTANCE` `find -delete` to target `0014_snapshot.json` instead of `0013_snapshot.json`** at `:153`:
   ```bash
   if [[ "${REGEN_PRODUCED_ACCEPTANCE}" -eq 1 ]]; then
     find "${META_DIR}" -name "0014_snapshot.json" -delete 2>/dev/null || true
   fi
   ```
5. **Add `apply_sql "${MIGRATION_13}"` after the existing line 375:**
   ```bash
   apply_sql "${MIGRATION_12}"
   apply_sql "${MIGRATION_13}"
   ```
6. **Update the post-apply comment at `:380-384`** to reference the new sentinel:
   ```bash
   # Mark that THIS run is responsible for any post-0013 snapshot ...
   # (The number after 0013 is 0014.)
   REGEN_PRODUCED_ACCEPTANCE=1
   ```
7. **Update the success-path cleanup at `:397-399`** to use `0014`:
   ```bash
   if echo "${GEN_OUT}" | grep -q "No schema changes"; then
     # ...
     find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0014_acceptance_check*.sql" -delete 2>/dev/null || true
     find "${META_DIR}" -name "0014_snapshot.json" -delete 2>/dev/null || true
   ```
8. **Do NOT remove any existing 0012/0013 references** — the cleanup-flag pattern is incremental, not replacement. Stale-artifact safety belts from prior phases stay in place.

---

## Shared Patterns

### Never-Retrofit Checklist (D042)
**Source:** `0012_operational_profiles.sql:12-23` header comment + per-table column block + smoke-gate column-count assertion.
**Apply to:** All 3 new pgTable exports in `schema.ts`, the migration SQL DDL, and the `test.sh` column-count assertion.
**Verbatim columns required everywhere they appear (CONTEXT.md D-06):**
- `schema_version int NOT NULL DEFAULT 1`
- `substrate_hash text NOT NULL DEFAULT ''`
- `name text NOT NULL UNIQUE DEFAULT 'primary'`
- `overall_confidence real NOT NULL DEFAULT 0 CHECK ([0, 1])`
- `word_count integer NOT NULL DEFAULT 0`
- `word_count_at_last_run integer NOT NULL DEFAULT 0`
- `last_updated timestamptz` (nullable)
- `created_at timestamptz NOT NULL DEFAULT now()`
- (attachment-only) `relational_word_count int NOT NULL DEFAULT 0`
- (attachment-only) `activated boolean NOT NULL DEFAULT false`

### Sentinel-Row Pattern (`name = 'primary'`)
**Source:** `0012_operational_profiles.sql:132-149` (INSERT ... ON CONFLICT DO NOTHING).
**Apply to:** All 3 migration INSERT statements (one per profile table).
```sql
INSERT INTO "profile_hexaco" ("name", "schema_version", "substrate_hash", "overall_confidence", "word_count", "word_count_at_last_run")
VALUES ('primary', 1, '', 0, 0, 0)
ON CONFLICT ("name") DO NOTHING;
```

### Schema-Version Dispatcher
**Source:** `src/memory/profiles.ts:83-87` (`PROFILE_SCHEMAS`).
**Apply to:** `PSYCHOLOGICAL_PROFILE_SCHEMAS` in `profiles.ts`.
```typescript
const PSYCHOLOGICAL_PROFILE_SCHEMAS: Record<PsychologicalProfileType, Record<number, z.ZodTypeAny>> = {
  hexaco: { 1: HexacoProfileSchemaV3 },
  schwartz: { 1: SchwartzProfileSchemaV3 },
  attachment: { 1: AttachmentProfileSchemaV3 },
};
```

### 3-Layer Zod v3 Parse Defense + Never-Throw
**Source:** `src/memory/profiles.ts:100-152` (`readOneProfile` complete pattern).
**Apply to:** New `readOnePsychologicalProfile` helper in `profiles.ts` (RESEARCH.md Example 5).
**Three layers:**
1. `schema_version` not in dispatcher map → return `null` + `logger.warn('chris.psychological.profile.read.schema_mismatch')`.
2. `safeParse` failure → return `null` + `logger.warn('chris.psychological.profile.read.parse_failed')`.
3. Catch all DB/throw errors → return `null` + `logger.warn('chris.psychological.profile.read.unknown_error')`.

### Parallel Reader via `Promise.all`
**Source:** `src/memory/profiles.ts:191-199` (`getOperationalProfiles`).
**Apply to:** `getPsychologicalProfiles` in `profiles.ts`.
```typescript
const [hexaco, schwartz, attachment] = await Promise.all([
  readOnePsychologicalProfile<HexacoProfileData>('hexaco', profileHexaco),
  readOnePsychologicalProfile<SchwartzProfileData>('schwartz', profileSchwartz),
  readOnePsychologicalProfile<AttachmentProfileData>('attachment', profileAttachment),
]);
```

### Zod v3 + v4 Dual Schema Discipline
**Source:** `src/memory/profiles/schemas.ts:23-68` (`JurisdictionalProfileSchemaV3` + V4 lockstep pair).
**Apply to:** All 3 profile-type schemas (`Hexaco*`, `Schwartz*`, `Attachment*`) in `psychological-schemas.ts`.
**Rules:** v3 uses `.strict()`; v4 omits it (M009 D-29-02). Both lockstep on field set.

### Word-Boundary Regex Sweep with Self-Allowlist
**Source:** `src/chris/__tests__/boundary-audit.test.ts:48-67` (`findEpisodicReferences` + per-line scan).
**Apply to:** `psych-boundary-audit.test.ts` (`findHits` with regex parameter).
**Pattern:** Per-line `pattern.test(line)`; word boundaries `\b...\b`; one entry per offending line; failure message includes `file:line: text` for diagnostic.

### HARD CO-LOC Atomic Plan
**Source:** Phase 33 `33-PATTERNS.md` § "Plan Hint Mapping" + `0012_operational_profiles.sql:7-11` header.
**Apply to:** Plan 37-01 must ship ALL of: migration SQL + `schema.ts` 3 pgTable exports + `meta/0013_snapshot.json` + `_journal.json` append + `scripts/test.sh` apply line + smoke gate + `scripts/regen-snapshots.sh` cleanup-flag bump + `psychological-schemas.ts` (because `schema.ts` `.$type<T>()` imports from it). Splitting reproduces M010 PITFALL M010-11 lineage break.

### Drizzle `.$type<T>()` jsonb Inference
**Source:** `src/db/schema.ts:545-552` (jsonb columns with type-imported nullable union).
**Apply to:** All dim jsonb columns in 3 new pgTable exports.
```typescript
honestyHumility: jsonb('honesty_humility').$type<HexacoProfileData['honesty_humility']>().notNull().default(sql`'null'::jsonb`),
```
The `HexacoProfileData['honesty_humility']` type evaluates to `{ score, confidence, last_updated } | null` (because the Zod factory is `.nullable()`), so the column's TS type is naturally nullable without an explicit `| null` annotation. Mirrors `JurisdictionalProfileData['current_country']` at `schema.ts:545` resolving to `string | null`.

### Luxon DST-Safe Calendar Boundary
**Source:** `src/rituals/cadence.ts:72` + `src/rituals/weekly-review-sources.ts:112` (`DateTime.fromJSDate(now, { zone: 'Europe/Paris' })` pattern).
**Apply to:** Calendar-month boundary in `psychological-shared.ts`.
```typescript
import { DateTime } from 'luxon';
const nowParis = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
const monthStart = nowParis.startOf('month').minus({ months: 1 });
const monthEnd = monthStart.endOf('month');
```

### Inline Word Counting (No npm Dep)
**Source:** Locked in CONTEXT.md D-18; no prior codebase precedent for word counting.
**Apply to:** Private `countWords` helper in `psychological-shared.ts`.
```typescript
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((s) => s.length > 0).length;
}
```
**Constraint:** Do NOT export. Do NOT add `words-count` npm dep. Do NOT use `messages.countTokens` (Russian token inflation bias per CONTEXT.md PSCH-08).

---

## No Analog Found

(No files in this phase lack an analog.)

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| _(none)_ | | | All 13 files have direct M010 or M008 precedents per CONTEXT.md `<canonical_refs>` and RESEARCH.md "Key insight: Phase 37 is the most pattern-replicated phase in the milestone." (line 440) |

## Metadata

**Analog search scope:**
- `src/db/migrations/` (entire dir for migration SQL patterns)
- `src/db/migrations/meta/` (snapshot + journal format)
- `src/db/schema.ts` (pgTable exports + imports)
- `src/memory/profiles.ts` (reader patterns)
- `src/memory/profiles/` (shared.ts, schemas.ts, __tests__)
- `src/memory/confidence.ts` (pure-function helper module)
- `src/chris/__tests__/boundary-audit.test.ts` (M008 boundary audit)
- `src/rituals/cadence.ts`, `src/rituals/weekly-review-sources.ts` (Luxon patterns)
- `scripts/test.sh` (smoke-gate patterns)
- `scripts/regen-snapshots.sh` (cleanup-flag patterns)
- `.planning/milestones/v2.5-phases/33-profile-substrate/33-PATTERNS.md` (M010 PATTERNS predecessor)

**Files scanned:** 14
**Pattern extraction date:** 2026-05-13
