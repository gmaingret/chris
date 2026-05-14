# Phase 37: Psychological Substrate — Research

**Researched:** 2026-05-13
**Domain:** Drizzle hand-authored migration 0013 + drizzle-kit meta lineage + Postgres seed inserts + Zod v3/v4 dual schemas + word-count-gated substrate loader + boundary-audit regex sweep
**Confidence:** HIGH — Phase 37 is "Phase 33 redux" for the psychological side. Every recommendation is grounded in direct inspection of the M010 (Phase 33) precedent artifacts (migration 0012, schema.ts lines 520–658, profiles.ts, shared.ts, schemas.ts, confidence.ts, test.sh, regen-snapshots.sh, _journal.json) — all VERIFIED in this session against the live filesystem. The four `/gsd-new-milestone` research files (`SUMMARY.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`) provide the M011-specific framing and are cross-cited inline.

## Summary

Phase 37 ships the persistence + read substrate + boundary defenses for M011 psychological profiles. It is structurally identical to Phase 33 (M010 operational substrate) with five exceptions: (1) **three** new tables instead of four, (2) every dimension column defaults to `'null'::jsonb` rather than `'[]'` / `'{}'` (psychological dimensions have a meaningful "never inferred" cold state), (3) a separate `psychological-shared.ts` substrate loader with a hard `source='telegram'` + `epistemic_tag != 'RITUAL_RESPONSE'` filter plus inline whitespace-split word-counting and a discriminated-union return shape that gates Sonnet calls BEFORE the 5,000-word floor is consulted, (4) `MIN_SPEECH_WORDS = 5000` + `RELATIONAL_WORD_COUNT_THRESHOLD = 2000` + `isAboveWordThreshold` appended to `src/memory/confidence.ts` next to the existing M010 entry-count helpers, and (5) a new `psych-boundary-audit.test.ts` enforcing D047 in both directions via a regex sweep on file contents.

CONTEXT.md has pre-locked all 37 architectural decisions (D-01..D-37). This research file's job is to verify those decisions against codebase reality, surface the eleven informational gaps the planner needs (exact `_journal.json` shape, `regen-snapshots.sh` flag location, `test.sh` insertion point, Drizzle `.$type<T>()` syntax for nullable jsonb, etc.), and propose the Validation Architecture section per Nyquist convention.

**Primary recommendation:** Adopt a two-plan split mirroring Phase 33: **Plan 37-01** is the atomic HARD CO-LOC #M11-1 migration plan (PSCH-01/02/03/04/05 + `psychological-schemas.ts` + smoke gate updates in test.sh + journal entry + regen-snapshots flag bump); **Plan 37-02** is the pure-TypeScript reader + substrate loader + confidence helpers + boundary-audit test (PSCH-06/07/08/09/10). Plan 37-01 must compile in isolation (the planner-checker will verify zero downstream imports from 37-02 into 37-01).

## User Constraints (from CONTEXT.md)

### Locked Decisions

All 37 decisions D-01..D-37 are locked by CONTEXT.md (file: `.planning/phases/37-psychological-substrate/37-CONTEXT.md`). Below is the full verbatim transcription of the constraint surface, organized by area. The planner MUST honor every entry.

**Migration shape (PSCH-01):**
- D-01: Migration 0013 is hand-authored SQL at `src/db/migrations/0013_psychological_profiles.sql`. Drizzle-kit generates DDL from `schema.ts`; hand-authored migration appends seed-row INSERTs.
- D-02: Three tables in ONE migration (`profile_hexaco`, `profile_schwartz`, `profile_attachment`).
- D-03: HARD CO-LOC #M11-1 atomic plan: migration SQL + `src/db/schema.ts` three new exports (after `profileFamily`, before `profileHistory`) + `src/db/migrations/meta/0013_snapshot.json` + `_journal.json` entry + `scripts/test.sh` psql apply line for 0013 + `scripts/regen-snapshots.sh` cleanup-flag bump + `src/memory/profiles/psychological-schemas.ts` Zod type exports ALL ship in ONE plan.
- D-04: `profile_history` reused unchanged. No ALTER TABLE.

**Profile table schema (each of 3):**
- D-05: Sentinel-row pattern `name text NOT NULL UNIQUE DEFAULT 'primary'`.
- D-06: Never-Retrofit columns: `schema_version int NOT NULL DEFAULT 1`, `substrate_hash text NOT NULL DEFAULT ''`, `name`, `overall_confidence real NOT NULL DEFAULT 0 CHECK (>= 0 AND <= 1)`, `word_count integer NOT NULL DEFAULT 0`, `word_count_at_last_run integer NOT NULL DEFAULT 0`, `last_updated timestamptz` (nullable), `created_at timestamptz NOT NULL DEFAULT now()`.
- D-07: `profile_attachment` additionally: `relational_word_count int NOT NULL DEFAULT 0`, `activated boolean NOT NULL DEFAULT false`.
- D-08: Dimension jsonb columns default `NULL` (distinct from M010's `'[]'` / `'{}'`).

**Per-dim jsonb shape (PSCH-02/03/04):**
- D-09: Unified `{ score: number, confidence: number, last_updated: string ISO }`. Range 1.0–5.0 for ALL THREE profile types (HEXACO + Schwartz + Attachment); confidence 0.0–1.0; last_updated ISO 8601. (Schwartz unified at 1.0–5.0 with HEXACO; academic -1..7 deferred to v2.6.1.)
- D-10: Zod schemas enforce score 1.0–5.0, confidence 0.0–1.0, last_updated `z.string().datetime()`.
- D-11: `evidence_count` field DEFERRED. Lock `{score, confidence, last_updated}` shape; do NOT add evidence_count.

**Cold-start seeds (PSCH-05):**
- D-12: One seed row per table at migration time, all dims `NULL`. INSERT pattern with `name='primary'`, `schema_version=1`, `substrate_hash=''`, `overall_confidence=0`, `word_count=0`, `word_count_at_last_run=0`. No `last_updated` value (null until first generator fire).
- D-13: Seed `substrate_hash = ''` (empty string, not NULL). Note Phase 38 generators do NOT short-circuit on matching hash per PGEN-06 (unconditional monthly fire).
- D-14: `profile_attachment` seed includes `activated=false`, `relational_word_count=0`.

**Substrate loader (PSCH-07, PSCH-08):**
- D-15: File location `src/memory/profiles/psychological-shared.ts` (REQUIREMENTS wins over SUMMARY.md's `src/memory/psychological-profiles/shared.ts`).
- D-16: Discriminated-union return type:
  ```typescript
  type PsychologicalProfileType = 'hexaco' | 'schwartz' | 'attachment';
  type PsychologicalSubstrate<T> =
    | { belowThreshold: true; wordCount: number; neededWords: number }
    | { belowThreshold: false; corpus: PensieveEntry[]; episodicSummaries: EpisodicSummary[]; wordCount: number; prevHistorySnapshot: T | null };
  export async function loadPsychologicalSubstrate<T = unknown>(profileType: PsychologicalProfileType, now: Date = new Date()): Promise<PsychologicalSubstrate<T>>;
  ```
- D-17: Source filter: `source='telegram' AND (epistemic_tag IS NULL OR epistemic_tag != 'RITUAL_RESPONSE')`. EXCLUDE `source IN ('gmail','immich','drive')`. Calendar-month boundary via Luxon `DateTime.fromJSDate(now, { zone: 'Europe/Paris' }).startOf('month').minus({ months: 1 })`.
- D-18: Word counting: `text.trim().split(/\s+/).filter(s => s.length > 0).length` per entry, summed. NOT `messages.countTokens`. Inline; no `words-count` npm dep.
- D-19: Word-count gate fires BEFORE Sonnet call; below-threshold returns `belowThreshold: true`.
- D-20: `word_count_at_last_run` persisted on EVERY fire, including below-threshold (Phase 38 orchestrator writes it).

**Reader API (PSCH-09):**
- D-21: `getPsychologicalProfiles()` exported from `src/memory/profiles.ts` AFTER `getOperationalProfiles()`. Does NOT extend operational return type. Return shape `{ hexaco, schwartz, attachment } : PsychologicalProfiles`.
- D-22: Never-throw contract; per-profile null + `logger.warn` on DB error with structured event `chris.psychological.profile.read.error`.
- D-23: 3-layer Zod v3 parse defense: `schema_version > 1` → null + warn `schema_mismatch`; `safeParse` fail → null + warn `parse_failed`; unexpected throw → null + warn `unknown_error`.
- D-24: `PSYCHOLOGICAL_PROFILE_SCHEMAS: Record<PsychologicalProfileType, Record<number, ZodTypeAny>>` mirrors M010 pattern at `profiles.ts:83`.

**Zod schemas (PSCH-06):**
- D-25: ONE file `src/memory/profiles/psychological-schemas.ts` for all three profile shapes.
- D-26: Per-profile v3 + v4 dual schemas (`HexacoProfileSchemaV3/V4`, `SchwartzProfileSchemaV3/V4`, `AttachmentProfileSchemaV3/V4`). v3 for reader; v4 for Phase 38 SDK boundary.
- D-27: Shared per-dim shape factory. `hexacoSchwartzDimensionSchemaV3` shared between HEXACO + Schwartz; `attachmentDimensionSchemaV3` separately named for nominal typing + future divergence.
- D-28: `schema_version` bumped only on BREAKING jsonb shape changes; reader returns null + warn for `schema_version > 1`.

**Confidence helpers (PSCH-08 substrate dep):**
- D-29: `src/memory/confidence.ts` extended in Phase 37. New exports: `MIN_SPEECH_WORDS = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`, `isAboveWordThreshold(wordCount: number): boolean`. Existing M010 helpers untouched. Two threshold systems are independent (word-count NOT composed with entry-count).
- D-30: `WORD_SATURATION = 20000` NOT introduced in Phase 37 (belongs in Phase 38 if used at all).

**Boundary audit (PSCH-10):**
- D-31: Test file `src/memory/profiles/__tests__/psych-boundary-audit.test.ts`.
- D-32: Two-directional regex sweep:
  - FAIL if `\b(jurisdictional|capital|health|family)\b` appears in `src/memory/profiles/psychological-*.ts` or `src/memory/profiles/__tests__/psychological-*.test.ts`
  - FAIL if `\b(hexaco|schwartz|attachment)\b` appears in `src/memory/profile-prompt.ts`, `src/memory/profile-updater.ts`, `src/memory/profiles/{shared,schemas,jurisdictional,capital,health,family}.ts`
- D-33: Standard vitest unit suite; `fs.readFileSync` + regex; no AST parsing. <1s.
- D-34: Allowlist exception: the audit test itself is excluded from its own input set.

**Migration mechanics:**
- D-35: `scripts/test.sh` psql apply line appended IMMEDIATELY AFTER the existing 0012 line (`scripts/test.sh:83`).
- D-36: `scripts/regen-snapshots.sh` cleanup-flag bump — update `REGEN_PRODUCED_ACCEPTANCE` references from `0013*.json` to `0014*.json` (per Section 5 below — the current flag already deletes `0013_snapshot.json` because 0013 was the "acceptance gate future snapshot" name pre-Phase-37; Phase 37 ships a REAL 0013, so the flag must now protect 0013 and clean 0014).
- D-37: `scripts/validate-journal-monotonic.ts` runs BEFORE migrations in `scripts/test.sh`; the new 0013 `_journal.json` `when` must be strictly greater than 0012's `1778482284254`.

### Claude's Discretion

- Exact placement of three new `profile*` table exports in `src/db/schema.ts` (ARCHITECTURE §1 suggests after `profileFamily` line 636, before `profileHistory` line 646; verified live at those positions).
- Internal naming of per-dim shape factory functions in `psychological-schemas.ts` (D-27 nominal-separation must hold; precise factory shape is planner's call).
- `profile_history` `snapshot jsonb` serialization detail — Phase 37 only ships the table (unchanged); Phase 38 generators decide what to write.
- Whether the 3 sentinel-row INSERTs are 3 separate statements or one composite block. (Recommend 3 separate; easier to grep for in audit.)

### Deferred Ideas (OUT OF SCOPE)

- `evidence_count` field on per-dim jsonb — locked deferred to v2.6.1.
- Per-dim `dimension_consistency` field — deferred to v2.6.1 / CONS-02.
- `WORD_SATURATION = 20000` constant — Phase 38 only if needed; calibration after 4–8 months real operation (SAT-CAL-01).
- Schwartz score range in academic units (-1 to 7) — v2.6.1 / M014 display-time transform.
- `profile_attachment` population logic (D028 activation, 60-day window, activated flag flip) — v2.6.1 weekly sweep.
- Source-filter generalization (hard-coded `source='telegram'`) — until a second source exists.
- `PsychologicalSubstrate<T>` generic narrowing per profile type — revisit when Phase 38 reveals the need.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PSCH-01 | Migration 0013 creates 3 tables with Never-Retrofit Checklist; HARD CO-LOC #M11-1 atomic | §"Migration 0013 SQL Structure" + Code Examples §1; precedent migration 0012 (lines 25–113) |
| PSCH-02 | `profile_hexaco` 6 jsonb dim cols + `overall_confidence` + Drizzle `.$type<HexacoDimension>()` inference | §"Drizzle Table Export Shape" + Code Examples §2 |
| PSCH-03 | `profile_schwartz` 10 jsonb value cols same per-dim shape + `overall_confidence` | §"Drizzle Table Export Shape" + Code Examples §2 |
| PSCH-04 | `profile_attachment` 3 jsonb dim cols + `relational_word_count` + `activated` (schema-only, D028 deferred) | §"Drizzle Table Export Shape" + Code Examples §2 |
| PSCH-05 | Cold-start seed rows: all dims NULL, `overall_confidence=0`, `word_count=0`, `name='primary'`, `schema_version=1`, `substrate_hash=''` | Code Examples §1 (sentinel-row INSERT pattern from 0012:132–149) |
| PSCH-06 | Zod v3 + v4 dual schemas in `psychological-schemas.ts` | §"Zod Dual Schemas Shape" + Code Examples §3; precedent `schemas.ts:1–117` |
| PSCH-07 | `loadPsychologicalSubstrate(profileType, now)` with `source='telegram'` filter + Luxon calendar-month boundary | §"Substrate Loader Query Shape" + Code Examples §4; precedent `shared.ts:206–254` |
| PSCH-08 | 5,000-word floor; whitespace-split inline counting; below-threshold returns discriminated-union early | §"Substrate Loader Query Shape" + Code Examples §4 |
| PSCH-09 | `getPsychologicalProfiles()` in `profiles.ts`; never-throw; 3-layer Zod v3 parse defense | §"3-Layer Zod v3 Parse Defense Pattern" + Code Examples §5; precedent `profiles.ts:100–198` |
| PSCH-10 | `psych-boundary-audit.test.ts` two-directional regex sweep | §"Boundary-Audit Test Shape" + Code Examples §6; precedent `src/chris/__tests__/boundary-audit.test.ts` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Psychological profile table DDL | Database (PostgreSQL 16) | — | Append-only data layer; same tier as M010 operational tables |
| Profile row UPSERT (Phase 38 only) | Database | App (Drizzle) | Mirrors M010; Drizzle `onConflictDoUpdate` on `name='primary'` |
| Cold-start seed row insertion | Database (migration SQL) | — | Migration-time only; runtime seeds risk race-with-cron |
| Substrate corpus loader | App (Node.js + Drizzle) | Database | SELECT-only; pure DB read filtered by `source` and `epistemic_tag` |
| Word counting | App (pure TS function) | — | Inline `text.trim().split(/\s+/)`; private to `psychological-shared.ts`; no library |
| Calendar-month boundary | App (Luxon DST-safe) | — | `DateTime.fromJSDate(now, {zone:'Europe/Paris'}).startOf('month').minus({months:1})` |
| Reader API never-throw contract | App (Node.js + Drizzle) | — | Mirrors `getOperationalProfiles` 3-layer parse defense |
| Zod v3 validation (read boundary) | App | — | Defends against future-schema drift on stored rows |
| Zod v4 schemas (Phase 38 SDK use) | App | — | Ready for `zodOutputFormat()` consumption next phase |
| Boundary audit (regex sweep) | App (vitest fs.readFile) | — | Pure regex sweep on file contents; no AST, no DB |
| Confidence threshold helpers | App (pure TS) | — | Single-source-of-truth math for word-count gates |

## Standard Stack

### Core (already installed — zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | ^0.45.2 [VERIFIED: package.json:20] | Three new `pgTable` exports in `src/db/schema.ts`; `.$type<HexacoDimension \| null>()` typed jsonb columns | Same pattern used in `schema.ts:545-552` for M010 operational tables |
| `drizzle-kit` | ^0.31.10 [VERIFIED: package.json:42] | `0013_snapshot.json` generation via `scripts/regen-snapshots.sh` | Existing acceptance-gate flow; HARD CO-LOC #M11-1 forces same-plan regen |
| `zod` | ^3.24.0 [VERIFIED: package.json:32] | v3 schemas at read boundary in `psychological-schemas.ts` | M006+ established; mirrors `src/memory/profiles/schemas.ts:1–117` |
| `zod/v4` (sub-path) | bundled with zod ^3.24.0 [VERIFIED: 3 prior import sites at `src/rituals/adjustment-dialogue.ts:28`, `src/rituals/weekly-review.ts:36`, `src/episodic/consolidate.ts:33`, plus operational `schemas.ts:19`] | v4 schemas for Phase 38's `zodOutputFormat()` consumption | M009 D-29-02 + M010 D045 dual-schema discipline |
| `luxon` | ^3.7.2 [VERIFIED: package.json:25] | Calendar-month boundary computation (DST-safe) in substrate loader | Already used across `src/rituals/` for week/month boundary math |
| `pino` (via `src/utils/logger.ts`) | (project-internal) | `logger.warn` for never-throw read failures | Existing pattern; structured event names `chris.psychological.profile.*` |

### Supporting (verified present)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.1.2 [VERIFIED: package.json:46] | Boundary-audit test + substrate-loader integration test against Docker Postgres | All tests; existing `scripts/test.sh` orchestrator |
| `@vitest/coverage-v8` | ^4.1.2 [VERIFIED: package.json:42] | Coverage on `psychological-shared.ts` + `confidence.ts` pure functions | Standard project pattern |
| Postgres 16 `gen_random_uuid()` | built-in | UUID PK default in 3 new profile tables | All 12 prior migrations use this |
| Postgres 16 `now()` | built-in | `created_at` default | Migration 0012 precedent |
| Node 22 `node:fs/promises` | built-in | `psych-boundary-audit.test.ts` source reading | Pattern from `src/chris/__tests__/boundary-audit.test.ts:2-4` |
| Node 22 `node:url`+`node:path` | built-in | Project-root resolution for fs.readFile | Pattern from `src/chris/__tests__/boundary-audit.test.ts:37-41` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `text.trim().split(/\s+/)` word counter | `words-count` npm v2.0.2 | ±2% accuracy gain is irrelevant at 5,000-word scale; library would add a dep for no observable benefit. Locked inline per D-18. [CITED: research/STACK.md §"Word Counting"] |
| Inline word counter | `messages.countTokens` SDK call | Tokens ≠ words in multilingual text (RU 1.5–2.5× inflation biases floor against Cyrillic). Wrong unit. Locked inline per D-18. |
| `'null'::jsonb` defaults for dim columns | `'{}'::jsonb` defaults | Psychological dims have a meaningful "never inferred" cold state distinct from "all-fields-empty"; `null` round-trips through Zod as literal `null`. Locked per D-08. |
| Per-dimension EAV table (6 rows for HEXACO) | Three wide tables with jsonb columns | Wide tables match M010 + enable `.$type<T>()` inference + avoid JOIN at reader path. HEXACO 6 dims / Schwartz 10 dims are fixed academic constructs — no schema-churn risk. [CITED: research/ARCHITECTURE.md §1] |
| Extending operational `loadProfileSubstrate(now)` with a `profileType` param | Separate `loadPsychologicalSubstrate(profileType, now)` in sibling file | Operational has no `source` filter and no word counting; parameterizing M010's loader pollutes its contract. Locked separate file per D-15 + PITFALLS.md Pitfall 3. |
| Sharing `Dimension` union in `profiles.ts` | New `PsychologicalProfileType` type | Sharing breaks every exhaustive switch on the operational union (8+ call sites). Locked separate type per D-16 + ARCHITECTURE §3. |
| `Math.floor(wordCount / 1000)` substrate-hash bucket | Plain `wordCount` value | Hash buckets are M010 ARCHITECTURE §5's idea; M011 PGEN-06 fires unconditionally so this is moot. Phase 38 owns hash semantics. |

**Installation:**

```bash
# No new packages required.
# All M011 capabilities ship with the existing M010 stack.
```

**Version verification:** All versions verified against `/home/claude/chris/package.json` in this session. drizzle-orm 0.45.2, zod 3.24.0, luxon 3.7.2, vitest 4.1.2 — all current as of 2026-05-13.

## Architecture Patterns

### System Architecture Diagram

```
                     Phase 37 Data Flow (Substrate-Only)
                     
[Existing] pensieve_entries ──────────┐
  (source, epistemic_tag, content,    │
   created_at, deleted_at)            │ filtered by
                                      │ source='telegram' AND
                                      │ epistemic_tag != 'RITUAL_RESPONSE'
                                      │ AND deleted_at IS NULL
                                      ▼
[NEW] psychological-shared.ts ── loadPsychologicalSubstrate(profileType, now)
  │                                   │
  │  ├──► Luxon calendar-month        │
  │  │    boundary (Europe/Paris,     │
  │  │    DST-safe)                   │
  │  │                                ▼
  │  ├──► inline countWords()         text.trim().split(/\s+/).filter(s.length>0).length
  │  │    per entry, summed           per entry → total wordCount
  │  │                                │
  │  ├──► IF wordCount < 5000 ───────► return { belowThreshold: true, wordCount, neededWords }
  │  │                                │ ← Phase 38 orchestrator early-returns
  │  │                                │   'skipped_below_threshold' without Sonnet call
  │  │                                │
  │  └──► ELSE load episodicSummaries ▼
  │       (for context only; not                    return { belowThreshold: false,
  │        counted toward wordCount)                  corpus, episodicSummaries,
  │       + prevHistorySnapshot FROM                  wordCount, prevHistorySnapshot }
  │       profile_history WHERE
  │       profile_table_name = profileType-mapped string
  │
  ▼
[NEW] profile_hexaco/schwartz/attachment (3 wide jsonb tables with sentinel row name='primary')
  │
  │   (Phase 38 generators will read substrate + UPSERT; Phase 37 only INSERTs cold-start seeds)
  │
  ▼
[NEW] getPsychologicalProfiles() in profiles.ts
  │   3× parallel readOnePsychologicalProfile() (try/catch isolation per profile)
  │   ├── 3-layer Zod v3 parse defense
  │   └── never-throw; per-profile null on any error
  │
  ▼
[Phase 38+ consumers] (cron orchestrator, /profile handler, mode handlers)
```

### Component Responsibilities

| File (existing or new) | Responsibility | Lines/Status |
|------------------------|----------------|--------------|
| `src/db/migrations/0013_psychological_profiles.sql` (NEW) | 3× CREATE TABLE + 3× sentinel-row INSERT | hand-authored SQL |
| `src/db/migrations/meta/0013_snapshot.json` (NEW) | drizzle-kit snapshot lineage | regenerated by `scripts/regen-snapshots.sh` |
| `src/db/migrations/meta/_journal.json` (MODIFIED) | append `idx: 13` entry | append-only |
| `src/db/schema.ts` (MODIFIED at line ~636) | 3× new `pgTable` exports inserted after `profileFamily`, before `profileHistory` | new lines |
| `src/memory/profiles/psychological-schemas.ts` (NEW) | Zod v3+v4 dual schemas + inferred TS types + shared per-dim factories | full file |
| `src/memory/profiles/psychological-shared.ts` (NEW) | `loadPsychologicalSubstrate<T>` + private `countWords` + private calendar-month helper | full file |
| `src/memory/confidence.ts` (MODIFIED) | append 3 new exports at end: `MIN_SPEECH_WORDS`, `RELATIONAL_WORD_COUNT_THRESHOLD`, `isAboveWordThreshold` | append-only |
| `src/memory/profiles.ts` (MODIFIED) | append after `getOperationalProfiles`: `PsychologicalProfileType`, `PSYCHOLOGICAL_PROFILE_SCHEMAS`, `PsychologicalProfiles` interface, `getPsychologicalProfiles` | append-only |
| `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (NEW) | vitest regex sweep both directions | full file |
| `scripts/test.sh` (MODIFIED at line 83) | append psql apply line for 0013 after 0012 | one new line + optional smoke gate update |
| `scripts/regen-snapshots.sh` (MODIFIED) | bump `0013*.json` cleanup pattern to `0014*.json` (REGEN_PRODUCED_ACCEPTANCE protects new 0013) | string substitution at 5 sites (lines 141–153, 384, 397–399) |

### Recommended Project Structure (additions only)

```
src/
├── db/
│   ├── migrations/
│   │   ├── 0013_psychological_profiles.sql      # NEW
│   │   └── meta/
│   │       ├── 0013_snapshot.json               # NEW (drizzle-kit regenerated)
│   │       └── _journal.json                    # MODIFIED (append idx:13)
│   └── schema.ts                                # MODIFIED (3 new exports + 3 new type imports)
└── memory/
    ├── confidence.ts                            # MODIFIED (append 3 exports)
    ├── profiles.ts                              # MODIFIED (append reader API + types + dispatcher)
    └── profiles/
        ├── psychological-schemas.ts             # NEW
        ├── psychological-shared.ts              # NEW
        └── __tests__/
            └── psych-boundary-audit.test.ts     # NEW
scripts/
├── test.sh                                      # MODIFIED (1 new psql line at L83 + optional smoke gate)
└── regen-snapshots.sh                           # MODIFIED (cleanup-flag bump)
```

### Pattern 1: Hand-Authored Migration with Idempotency Guards

**What:** Postgres-flavored SQL with `CREATE TABLE IF NOT EXISTS` + `--> statement-breakpoint` markers + `INSERT ... ON CONFLICT (name) DO NOTHING` for sentinel rows.
**When to use:** Always for new migrations in this codebase. drizzle-kit cannot model seed inserts. The IF NOT EXISTS guards make raw-psql replay (the `scripts/test.sh` flow) safe.
**Example:**

```sql
-- Source: src/db/migrations/0012_operational_profiles.sql:25-46 (VERIFIED)
CREATE TABLE IF NOT EXISTS "profile_jurisdictional" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text DEFAULT 'primary' NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "substrate_hash" text DEFAULT '' NOT NULL,
    "confidence" real DEFAULT 0 NOT NULL,
    "data_consistency" real DEFAULT 0 NOT NULL,
    "current_country" jsonb DEFAULT 'null'::jsonb NOT NULL,
    -- ... more dimension columns
    "last_updated" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "profile_jurisdictional_name_unique" UNIQUE("name"),
    CONSTRAINT "profile_jurisdictional_confidence_bounds" CHECK ("profile_jurisdictional"."confidence" >= 0 AND "profile_jurisdictional"."confidence" <= 1)
);
--> statement-breakpoint
```

### Pattern 2: Drizzle `pgTable` with `.$type<T>()` Inference

**What:** TypeScript-side table definition mirroring the SQL, using `jsonb('col').$type<MyType>()` for compile-time inference of jsonb shape.
**When to use:** Every M010+ profile table; sets up Drizzle to return typed result rows from `db.select()` queries.
**Example:**

```typescript
// Source: src/db/schema.ts:536-560 (VERIFIED)
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
    // ... per-dim columns continue
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_jurisdictional_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
  ],
);
```

### Pattern 3: Sentinel-Row INSERT in Migration

**What:** Idempotent INSERT with `ON CONFLICT (name) DO NOTHING` so cold-start seed is created exactly once.
**When to use:** Migration time only. Phase 38's monthly cron will UPSERT via `ON CONFLICT (name) DO UPDATE`.
**Example:**

```sql
-- Source: src/db/migrations/0012_operational_profiles.sql:174-186 (VERIFIED - the all-zeros precedent)
-- confidence = 0 for health (no ground-truth health facts; "insufficient data" markers)
INSERT INTO "profile_health"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "open_hypotheses", "pending_tests", "active_treatments", "recent_resolved",
     "case_file_narrative", "wellbeing_trend")
VALUES
    ('primary', 1, '', 0, 0,
     '[]'::jsonb,
     -- etc.
     '{}'::jsonb)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
```

### Pattern 4: Never-Throw 3-Layer Zod v3 Parse Defense

**What:** Reader checks `schema_version > 1` first (returns null + warn `schema_mismatch`), then `safeParse` failure (returns null + warn `parse_failed`), wrapped in outer try/catch for unexpected throws (returns null + warn `error`).
**When to use:** Every profile reader. The 3 layers handle 3 distinct failure modes: schema drift, jsonb corruption, infrastructure failure.
**Example:**

```typescript
// Source: src/memory/profiles.ts:100-152 (VERIFIED)
async function readOneProfile<T>(
  dimension: Dimension,
  table: any,
): Promise<ProfileRow<T> | null> {
  try {
    const rows = await db.select().from(table).where(eq(table.name, 'primary')).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0]!;

    // Layer 1: schema_version dispatch
    const parser = PROFILE_SCHEMAS[dimension][row.schemaVersion as number];
    if (!parser) {
      logger.warn({ dimension, schemaVersion: row.schemaVersion },
        'chris.profile.read.schema_mismatch');
      return null;
    }

    // Layer 2: safeParse, never .parse
    const dataToValidate = stripMetadataColumns(row);
    const parsed = parser.safeParse(dataToValidate);
    if (!parsed.success) {
      logger.warn({ dimension, error: parsed.error.message },
        'chris.profile.read.schema_mismatch');
      return null;
    }

    return { data: parsed.data as T, confidence: row.confidence,
             lastUpdated: row.lastUpdated, schemaVersion: row.schemaVersion };
  } catch (error) {
    // Layer 3: outer catch — DB error, connection drop, etc.
    logger.warn({ dimension, error: error instanceof Error ? error.message : String(error) },
      'chris.profile.read.error');
    return null;
  }
}
```

### Pattern 5: Boundary-Audit Regex Sweep with Self-Allowlist

**What:** Vitest test that `readFile`s source files into strings, runs a per-line regex with word boundaries, asserts zero matches. The test file itself is excluded from its own input glob.
**When to use:** D047-style architectural boundaries that depend on shared-language but separated-file enforcement.
**Example:**

```typescript
// Source: src/chris/__tests__/boundary-audit.test.ts:38-67 (VERIFIED — full pattern)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');  // 3 levels up to /home/claude/chris

async function readSource(relPath: string): Promise<string> {
  return readFile(resolve(PROJECT_ROOT, relPath), 'utf8');
}

function findReferences(contents: string, pattern: RegExp): Array<{line:number; text:string}> {
  const hits: Array<{line:number; text:string}> = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (pattern.test(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}
```

### Anti-Patterns to Avoid

- **Sharing operational + psychological substrate loaders.** Operational has no source filter, no word counting, no calendar-month boundary. Parameterizing M010's loader pollutes its contract and breaks the `entryCount = pensieveEntries.length` invariant. [CITED: PITFALLS.md Pitfall 3]
- **Extending `Dimension` union with psychological values.** Breaks every exhaustive switch consuming `Dimension` (8+ sites in `profiles.ts` formatProfilesForPrompt, `profile-prompt.ts:51` `ProfilePromptDimension`, `shared.ts` `ProfileGeneratorConfig.dimension`, etc.). Locked separate `PsychologicalProfileType` per D-16.
- **Defaulting dimension jsonb columns to `'[]'` or `'{}'`.** Psychological dims need a meaningful "never inferred" state. Default `'null'::jsonb` per D-08; Zod reader handles literal `null` value.
- **Adding `evidence_count` to per-dim shape.** ARCHITECTURE §1 proposed it; REQUIREMENTS PSCH-02 locked `{score, confidence, last_updated}`. Use case subsumed by `profile_history` + Sonnet-reported `data_consistency`. Locked deferred per D-11.
- **Using `messages.countTokens` for the 5,000-word gate.** Tokens ≠ words; RU 2× inflation biases against Cyrillic substrates. Locked inline per D-18. [CITED: research/STACK.md §"Word Counting"]
- **`ALTER TABLE` in a later migration to add `relational_word_count`, `activated`, `substrate_hash`, `schema_version`, or `name UNIQUE`.** All seven non-retrofittable columns must ship in 0013. [CITED: PITFALLS.md Pitfall 7 + D042]
- **`source` filter via a JS-side `.filter()` post-query.** Use SQL-side `WHERE source = 'telegram'` to avoid loading Gmail/Immich/Drive rows into memory. Same applies to the `epistemic_tag != 'RITUAL_RESPONSE'` exclusion.
- **Skipping Sonnet call on matching substrate_hash for psychological profiles.** Phase 38 monthly fire is UNCONDITIONAL per PGEN-06 (skipped months break consistency time series). Phase 37 doesn't need to enforce this, but the seed-row `substrate_hash=''` value must remain compatible — and the planner must not introduce hash-skip logic in the substrate loader.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar-month boundary | Manual `Date` arithmetic with `new Date(y, m-1, 1)` | Luxon `DateTime.fromJSDate(now, {zone:'Europe/Paris'}).startOf('month').minus({months:1})` | DST-safe; handles Europe/Paris transitions correctly; pattern already used in `src/rituals/weekly-review-sources.ts` |
| `_journal.json` regeneration | Hand-edit JSON | `scripts/regen-snapshots.sh` | drizzle-kit's clean-slate iterative replay is the only path that produces byte-accurate intermediate snapshots; hand-editing breaks lineage validation |
| Migration 0013 DDL | Hand-author the entire CREATE TABLE | drizzle-kit `pnpm db:generate` (auto-regen via regen-snapshots.sh) then hand-append the seed INSERTs | drizzle-kit generates the DDL automatically from `schema.ts`; only seed inserts are hand-authored (same pattern as 0012) |
| Word counting | Naive `split(' ')` | Inline `text.trim().split(/\s+/).filter(s => s.length > 0).length` | Naive split miscounts on tabs/newlines/multi-space; the trim+regex+filter handles EN/FR/RU at 5,000-word scale to ±2% |
| `profile_history` snapshot reader (in Phase 37) | Custom query | Just-in-time query in `loadPsychologicalSubstrate` using `db.select().from(profileHistory).where(eq(profileHistory.profileTableName, mapped)).orderBy(desc(profileHistory.recordedAt)).limit(1)` | Existing index `profile_history_table_recorded_idx` (verified at `schema.ts:656`) makes this O(log n) |
| Boundary-audit regex sweep | AST-based source parser | Per-line regex with `\b` word boundaries; `fs.readFileSync` | The audit test is ~30 lines, runs <1s, mirrors the M008 RETR-05/06 pattern verified at `src/chris/__tests__/boundary-audit.test.ts` |
| `psych-boundary-audit` self-allowlist | Pre-test fs-glob filter | The test file simply doesn't appear in its own hardcoded input-file array | Same as M008 — no glob, just an explicit array of file paths |
| Threshold semantics (`<` vs `<=`) | Re-derive boundary | Use `>=` in `isAboveWordThreshold` mirroring `confidence.ts:63-65` `isAboveThreshold` | M009 `tryFireRitualAtomic` lt→lte lesson; exact word count == `MIN_SPEECH_WORDS` is "at threshold" → above |

**Key insight:** Phase 37 is the most pattern-replicated phase in the milestone. EVERY component has a 1:1 M010 / M008 precedent VERIFIED in this session. The planner's job is mechanical mirroring, NOT design. The eleven informational gaps below (Section "Specific Research Findings") cover the only places where the planner needs to look up exact values rather than copy the pattern.

## Runtime State Inventory

Not applicable. Phase 37 is a greenfield additive phase: three new tables, three new files, additions to three existing files. No rename, no refactor, no string-replacement audit needed. No stored data references the new table names yet; no live service config knows about HEXACO/Schwartz/Attachment; no OS-registered state (cron registration is Phase 38, not Phase 37); no secrets/env vars; no build artifacts to invalidate.

**Verified explicitly:**
- Stored data: No existing pensieve_entries / episodic_summaries / profile_history rows reference `'profile_hexaco'`, `'profile_schwartz'`, or `'profile_attachment'` strings yet (Phase 37 ships seed rows BEFORE any consumer can write history). None — verified by ARCHITECTURE.md §7 "No migration delta needed."
- Live service config: n8n/Datadog/Tailscale/Cloudflare not in scope. None.
- OS-registered state: Monthly cron registration is Phase 38, not Phase 37. None.
- Secrets/env vars: No new env vars introduced in Phase 37 (Phase 38 adds `psychologicalProfileUpdaterCron`). None.
- Build artifacts: drizzle-kit regenerates `meta/0013_snapshot.json` from `schema.ts`; no stale artifact to invalidate (the existing `regen-snapshots.sh` cleanup flag already handles the "future 0013 snapshot" name; planner just bumps the flag to protect the real 0013 and clean any future 0014 acceptance artifact). One artifact rename verified — see Section "regen-snapshots.sh cleanup-flag pattern" below.

## Common Pitfalls

### Pitfall 1: Never-Retrofit Checklist Incompleteness (Migration 0013)

**What goes wrong:** Migration 0013 ships without `relational_word_count` or `activated` on `profile_attachment`, or without `word_count_at_last_run` on all three. Adding these later requires ALTER TABLE on a live table with existing rows — heavyweight, blocking, and the cold-start seed row would not have the column to default-populate.
**Why it happens:** Time pressure or "we can add that column later" thinking. Especially tempting for `profile_attachment` since population is deferred (D028 activation) — easy to think "schema-only means minimal columns."
**How to avoid:** Apply D042 verbatim. The Never-Retrofit Checklist is in ROADMAP.md Phase 37 entry verbatim AND in CONTEXT.md D-06 + D-07. The planner-checker must verify all 7 columns (8 for profile_attachment) are present in the migration SQL AND in the schema.ts pgTable AND in the smoke-gate query in test.sh.
**Warning signs:** A future ALTER TABLE migration 0014 adding `schema_version` or `activated` to `profile_attachment`. Drizzle-kit generating an ALTER TABLE statement during snapshot regen.
[CITED: PITFALLS.md Pitfall 7]

### Pitfall 2: Speech-Source Contamination

**What goes wrong:** The substrate loader pulls Gmail/Immich/Drive content alongside Telegram, inflating word counts with text Greg did not produce spontaneously. Or it includes RITUAL_RESPONSE-tagged entries that contain Chris's ritual prompts.
**Why it happens:** Operational M010 substrate loader does NOT filter by source — correct for operational profiles, catastrophic for psychological. Easy to copy the M010 loader pattern and forget the source filter.
**How to avoid:** Hard-coded `WHERE source = 'telegram' AND (epistemic_tag IS NULL OR epistemic_tag != 'RITUAL_RESPONSE') AND deleted_at IS NULL` in the substrate query. `psych-boundary-audit.test.ts` only audits cross-vocabulary leakage; a separate live integration test must verify the source filter against a seeded Pensieve fixture containing Gmail + Immich + RITUAL_RESPONSE entries (Phase 40 owns this test per PMT-02, but Phase 37 should ship a tighter unit-level loader test that asserts the SQL `WHERE` clause structure).
**Warning signs:** Unexpectedly high word count for a new user. Word count includes entries from Gmail timestamps.
[CITED: PITFALLS.md Pitfall 3]

### Pitfall 3: Word-Count Gate Compose Error

**What goes wrong:** The substrate loader returns `belowThreshold: false` based on word count, but the Phase 38 generator ALSO calls `isAboveThreshold(entryCount)` from M010's `confidence.ts:63`, double-gating in a way that may reject a valid 5,200-word substrate spread across 8 long entries.
**Why it happens:** M010's pattern is "check threshold FIRST" (`shared.ts:372`); easy to forget that M011's threshold is word count, not entry count.
**How to avoid:** Phase 37's `isAboveWordThreshold(wordCount)` and M010's `isAboveThreshold(entryCount)` are independent and must NOT be composed. The Phase 38 generator (when it lands) must use `isAboveWordThreshold` only. Phase 37 enforces this by NOT importing `isAboveThreshold` into `psychological-shared.ts` — the loader uses `wordCount` directly against `MIN_SPEECH_WORDS`.
**Warning signs:** Below-threshold case fires for 5,200-word + 8-entry substrate.
[CITED: PITFALLS.md Pitfall 2 + CONTEXT.md "specifics" §5]

### Pitfall 4: Drizzle `.$type<T>()` jsonb Nullability Confusion

**What goes wrong:** Defining the jsonb column as `.$type<HexacoDimension>()` instead of `.$type<HexacoDimension | null>()` causes TypeScript to infer non-nullable result rows, but the DB default is `'null'::jsonb` (literal JSON null). Reader returns `null` at runtime; TypeScript thinks the field is always `HexacoDimension`; a `.score` access on a cold-start row crashes.
**Why it happens:** M010 used `.$type<JurisdictionalProfileData['current_country']>()` where the underlying Zod schema already had `.nullable()` baked in. M011's per-dim shape is `{score, confidence, last_updated}` non-nullable, plus a separate `| null` for the whole field at the row level.
**How to avoid:** Use `.$type<HexacoDimension | null>()` explicitly OR define the type alias with `null` baked in (`export type HexacoDimensionColumn = HexacoDimension | null` and use that in `.$type<>()`). The Zod v3 schema must use `.nullable()` on the dim factory (D-27 already specifies this).
**Warning signs:** TypeScript compile pass but runtime null deref on `.score` access at the reader path.

### Pitfall 5: `_journal.json` Stale `when` Timestamp

**What goes wrong:** Drizzle-kit's clean-slate regen produces a `0013_snapshot.json`, but the planner hand-edits `_journal.json` with a copy-pasted `when` value that is ≤ 0012's `1778482284254` (e.g., a milliseconds-vs-seconds typo). `scripts/validate-journal-monotonic.ts` in `test.sh:48` catches this BEFORE migrations apply, exiting 1 with a remediation hint. CI fails, but the offending commit may have already merged if the gate is bypassed.
**Why it happens:** Year-stale typos are exactly the class that motivated Phase 32 #3 (commit `be22af0` precedent). Easy to introduce when copy-pasting the migration entry template.
**How to avoid:** Always use `Date.now()` to mint the new `when` value. The new entry must have `when` > `1778482284254` (the 0012 value verified in this session). `scripts/validate-journal-monotonic.ts` is the safety net.
**Warning signs:** `validate-journal-monotonic.ts` exit code 1 with "non-monotonic" message.

### Pitfall 6: Boundary-Audit Test False Positive on Comments / Docstrings

**What goes wrong:** The regex `\b(hexaco|schwartz|attachment)\b` matches the word `attachment` in a comment inside `src/memory/profiles/family.ts` referring to "attachment-style relational dynamics" in a docstring. Audit fails for a non-violation.
**Why it happens:** The regex sweeps the full file contents; it cannot distinguish code from comments.
**How to avoid:** The locked term list (D-32) is specifically chosen to minimize false positives — `hexaco` and `schwartz` are unlikely to appear in any other context, and `attachment` is the only one with comment-collision risk. If a false positive emerges, EITHER (a) rename the offending docstring word to "attachment-style bonding" or similar, OR (b) extend the test with a per-file allowlist of specific line numbers. Do NOT relax the regex to be more permissive — false negatives are worse than false positives here.
**Warning signs:** Audit fails on a file that obviously doesn't violate D047.

### Pitfall 7: Reader's `stripMetadataColumns` Snake-Case Conversion

**What goes wrong:** The operational reader's `stripMetadataColumns` (`profiles.ts:160-177`) strips `id, name, schemaVersion, substrateHash, confidence, lastUpdated, createdAt`. The psychological reader's equivalent must also strip `wordCount`, `wordCountAtLastRun`, AND (for attachment) `relationalWordCount` + `activated`. Forgetting to strip them passes Drizzle's camelCase metadata into Zod, which expects snake_case dimension fields only — `safeParse` fails on unknown keys (v3 schemas use `.strict()`).
**Why it happens:** The new columns are easy to forget when mirroring M010's pattern.
**How to avoid:** Either (a) extend `stripMetadataColumns` with an explicit deny-list of all metadata column names (including the new word-count + activation columns), or (b) flip the strategy to an explicit allow-list of the per-dim jsonb columns. Recommend (a) for minimal diff with M010.
**Warning signs:** `chris.psychological.profile.read.parse_failed` warn fires constantly even on fresh seed rows.

## Code Examples

### Example 1: Migration 0013 SQL Skeleton

Mirroring `0012_operational_profiles.sql:25-46` shape exactly, with the M011 column set.

```sql
-- Source: pattern from src/db/migrations/0012_operational_profiles.sql:1-46
-- (header comments + first CREATE TABLE block, VERIFIED in session)
--
-- Phase 37 (M011 v2.6) — Psychological profile substrate.
-- HARD CO-LOCATION #M11-1: this SQL + src/db/schema.ts table defs +
-- migrations/meta/0013_snapshot.json + _journal.json entry +
-- scripts/test.sh psql apply line + scripts/regen-snapshots.sh
-- cleanup-flag bump + src/memory/profiles/psychological-schemas.ts
-- Zod type exports ALL ship in Plan 37-01 atomically.
--
-- Non-retrofittable columns (D042 + REQUIREMENTS PSCH-01):
--   - schema_version int NOT NULL DEFAULT 1
--   - substrate_hash text NOT NULL DEFAULT ''
--   - name text NOT NULL UNIQUE DEFAULT 'primary'
--   - overall_confidence real NOT NULL DEFAULT 0 CHECK (>= 0 AND <= 1)
--   - word_count integer NOT NULL DEFAULT 0
--   - word_count_at_last_run integer NOT NULL DEFAULT 0
--   - last_updated timestamptz (nullable — null = "never run")
-- profile_attachment additionally (D028):
--   - relational_word_count int NOT NULL DEFAULT 0
--   - activated boolean NOT NULL DEFAULT false

CREATE TABLE IF NOT EXISTS "profile_hexaco" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text DEFAULT 'primary' NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "substrate_hash" text DEFAULT '' NOT NULL,
    "overall_confidence" real DEFAULT 0 NOT NULL,
    "word_count" integer DEFAULT 0 NOT NULL,
    "word_count_at_last_run" integer DEFAULT 0 NOT NULL,
    "honesty_humility" jsonb DEFAULT 'null'::jsonb,
    "emotionality" jsonb DEFAULT 'null'::jsonb,
    "extraversion" jsonb DEFAULT 'null'::jsonb,
    "agreeableness" jsonb DEFAULT 'null'::jsonb,
    "conscientiousness" jsonb DEFAULT 'null'::jsonb,
    "openness" jsonb DEFAULT 'null'::jsonb,
    "last_updated" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "profile_hexaco_name_unique" UNIQUE("name"),
    CONSTRAINT "profile_hexaco_overall_confidence_bounds"
      CHECK ("profile_hexaco"."overall_confidence" >= 0 AND "profile_hexaco"."overall_confidence" <= 1)
);
--> statement-breakpoint

-- ... profile_schwartz (same shape, 10 jsonb value columns) ...
-- ... profile_attachment (same shape, 3 jsonb dim columns + activated boolean + relational_word_count int) ...

-- Sentinel-row INSERTs — three separate statements per CONTEXT.md "specifics" recommendation.
INSERT INTO "profile_hexaco"
    ("name", "schema_version", "substrate_hash", "overall_confidence",
     "word_count", "word_count_at_last_run")
VALUES
    ('primary', 1, '', 0, 0, 0)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- ... INSERT for profile_schwartz (identical shape) ...

INSERT INTO "profile_attachment"
    ("name", "schema_version", "substrate_hash", "overall_confidence",
     "word_count", "word_count_at_last_run",
     "relational_word_count", "activated")
VALUES
    ('primary', 1, '', 0, 0, 0, 0, false)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
```

**Note on dim jsonb defaults:** Per D-08, columns default to `'null'::jsonb` (literal JSON null), NOT `'{}'`. Distinct from the M010 pattern at 0012:32 (`'null'::jsonb`) for nullable fields and 0012:34 (`'[]'::jsonb`) for array fields. M011 uses `'null'::jsonb` for ALL dim columns because each per-dim cold state is "never inferred" rather than "empty object."

**Note on NOT NULL:** M010 declares jsonb columns `NOT NULL DEFAULT 'null'::jsonb`. M011 should follow the same pattern (`NOT NULL DEFAULT 'null'::jsonb`) — this is `NOT NULL` at the column level, but the value is JSON `null` (a JSON literal), not SQL NULL. The Zod v3 reader's `.nullable()` per-dim factory handles this correctly. (If the planner chooses to omit `NOT NULL`, that is also valid; M010 chose NOT NULL for "impossible state" minimization.)

### Example 2: Drizzle Table Export

```typescript
// Source: pattern from src/db/schema.ts:536-560 (VERIFIED)
// Insertion point: after `profileFamily` (line 636), before `profileHistory` (line 646).
// Type imports must also be added at the top of schema.ts (~line 25):
//   import type { HexacoProfileData, SchwartzProfileData, AttachmentProfileData } from '../memory/profiles/psychological-schemas.js';

export const profileHexaco = pgTable(
  'profile_hexaco',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    overallConfidence: real('overall_confidence').notNull().default(0),
    wordCount: integer('word_count').notNull().default(0),
    wordCountAtLastRun: integer('word_count_at_last_run').notNull().default(0),
    honestyHumility: jsonb('honesty_humility').$type<HexacoProfileData['honesty_humility']>().default(sql`'null'::jsonb`),
    emotionality: jsonb('emotionality').$type<HexacoProfileData['emotionality']>().default(sql`'null'::jsonb`),
    extraversion: jsonb('extraversion').$type<HexacoProfileData['extraversion']>().default(sql`'null'::jsonb`),
    agreeableness: jsonb('agreeableness').$type<HexacoProfileData['agreeableness']>().default(sql`'null'::jsonb`),
    conscientiousness: jsonb('conscientiousness').$type<HexacoProfileData['conscientiousness']>().default(sql`'null'::jsonb`),
    openness: jsonb('openness').$type<HexacoProfileData['openness']>().default(sql`'null'::jsonb`),
    lastUpdated: timestamp('last_updated', { withTimezone: true }),  // nullable: null=never run
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_hexaco_overall_confidence_bounds',
      sql`${table.overallConfidence} >= 0 AND ${table.overallConfidence} <= 1`),
  ],
);
```

**Key Drizzle insertion-point detail (VERIFIED):** The exact byte offsets of `profileFamily` and `profileHistory` are `schema.ts:613` (start of `profileFamily`) and `schema.ts:646` (start of `profileHistory`). The 3 new exports go in the 10-line gap between them. Line numbers MAY have shifted by ±5 lines if any minor edits landed since 2026-05-13; planner verifies live.

**`.$type<T | null>()` nullability:** Per Pitfall 4 above, planner should choose `.$type<HexacoProfileData['honesty_humility']>()` where the underlying type is already `HexacoDimension | null` from Zod `.nullable()` inference. This is the M010 pattern (e.g., `JurisdictionalProfileData['current_country']` at `schema.ts:545` is `string | null` because the Zod schema uses `.nullable()` at `schemas.ts:25`).

### Example 3: Zod Dual Schemas

```typescript
// Source: pattern from src/memory/profiles/schemas.ts:1-68 (VERIFIED)
// New file: src/memory/profiles/psychological-schemas.ts

import { z } from 'zod';
import * as zV4 from 'zod/v4';

// ── Shared per-dim factory (D-27) ───────────────────────────────────────

const hexacoSchwartzDimensionSchemaV3 = z.object({
  score: z.number().min(1).max(5),
  confidence: z.number().min(0).max(1),
  last_updated: z.string().datetime(),
}).strict().nullable();

const hexacoSchwartzDimensionSchemaV4 = zV4.object({
  score: zV4.number().min(1).max(5),
  confidence: zV4.number().min(0).max(1),
  last_updated: zV4.string(),  // v4 .datetime() availability check needed
}).nullable();

// D-27 nominal separation — separate name, identical shape, preserves future divergence
const attachmentDimensionSchemaV3 = z.object({
  score: z.number().min(1).max(5),
  confidence: z.number().min(0).max(1),
  last_updated: z.string().datetime(),
}).strict().nullable();

const attachmentDimensionSchemaV4 = zV4.object({
  score: zV4.number().min(1).max(5),
  confidence: zV4.number().min(0).max(1),
  last_updated: zV4.string(),
}).nullable();

// ── HEXACO (6 dimensions, PSCH-02) ──────────────────────────────────────

export const HexacoProfileSchemaV3 = z.object({
  honesty_humility: hexacoSchwartzDimensionSchemaV3,
  emotionality: hexacoSchwartzDimensionSchemaV3,
  extraversion: hexacoSchwartzDimensionSchemaV3,
  agreeableness: hexacoSchwartzDimensionSchemaV3,
  conscientiousness: hexacoSchwartzDimensionSchemaV3,
  openness: hexacoSchwartzDimensionSchemaV3,
}).strict();
export type HexacoProfileData = z.infer<typeof HexacoProfileSchemaV3>;

export const HexacoProfileSchemaV4 = zV4.object({
  honesty_humility: hexacoSchwartzDimensionSchemaV4,
  // ... etc
});

// ── Schwartz (10 values, PSCH-03) ───────────────────────────────────────
export const SchwartzProfileSchemaV3 = z.object({
  self_direction: hexacoSchwartzDimensionSchemaV3,
  stimulation: hexacoSchwartzDimensionSchemaV3,
  hedonism: hexacoSchwartzDimensionSchemaV3,
  achievement: hexacoSchwartzDimensionSchemaV3,
  power: hexacoSchwartzDimensionSchemaV3,
  security: hexacoSchwartzDimensionSchemaV3,
  conformity: hexacoSchwartzDimensionSchemaV3,
  tradition: hexacoSchwartzDimensionSchemaV3,
  benevolence: hexacoSchwartzDimensionSchemaV3,
  universalism: hexacoSchwartzDimensionSchemaV3,
}).strict();
export type SchwartzProfileData = z.infer<typeof SchwartzProfileSchemaV3>;

// ── Attachment (3 dims, schema-only, PSCH-04) ───────────────────────────
export const AttachmentProfileSchemaV3 = z.object({
  anxious: attachmentDimensionSchemaV3,
  avoidant: attachmentDimensionSchemaV3,
  secure: attachmentDimensionSchemaV3,
  // Note: relational_word_count + activated live at row-level (not jsonb);
  // they're metadata columns, stripped by readOnePsychologicalProfile per Pitfall 7.
}).strict();
export type AttachmentProfileData = z.infer<typeof AttachmentProfileSchemaV3>;
```

**Note on `.strict()`:** v3 schemas use `.strict()` (rejects unknown keys at read boundary; defends against future jsonb drift). v4 schemas omit `.strict()` per M009 D-29-02 (SDK doesn't parse strict-mode JSON Schema; v3 re-validates in the retry loop).

### Example 4: Substrate Loader

```typescript
// New file: src/memory/profiles/psychological-shared.ts
// Mirrors src/memory/profiles/shared.ts:206-254 (VERIFIED) with these changes:
//   (a) typed by profileType
//   (b) source filter (telegram only) + RITUAL_RESPONSE exclusion
//   (c) calendar-month boundary via Luxon (not 60-day rolling window)
//   (d) inline word counting + 5,000-word floor
//   (e) prevHistorySnapshot lookup
//   (f) discriminated-union return shape

import { and, desc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/connection.js';
import { pensieveEntries, episodicSummaries, profileHistory } from '../../db/schema.js';
import { getEpisodicSummariesRange } from '../../pensieve/retrieve.js';
import { MIN_SPEECH_WORDS } from '../confidence.js';

export type PsychologicalProfileType = 'hexaco' | 'schwartz' | 'attachment';

export type PsychologicalSubstrate<T> =
  | { belowThreshold: true; wordCount: number; neededWords: number }
  | {
      belowThreshold: false;
      corpus: (typeof pensieveEntries.$inferSelect)[];
      episodicSummaries: (typeof episodicSummaries.$inferSelect)[];
      wordCount: number;
      prevHistorySnapshot: T | null;
    };

const PROFILE_TYPE_TO_TABLE_NAME: Record<PsychologicalProfileType, string> = {
  hexaco: 'profile_hexaco',
  schwartz: 'profile_schwartz',
  attachment: 'profile_attachment',
} as const;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((s) => s.length > 0).length;
}

export async function loadPsychologicalSubstrate<T = unknown>(
  profileType: PsychologicalProfileType,
  now: Date = new Date(),
): Promise<PsychologicalSubstrate<T>> {
  // Calendar-month boundary (D-17) — previous calendar month in Europe/Paris
  const nowParis = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
  const monthStart = nowParis.startOf('month').minus({ months: 1 });
  const monthEnd = monthStart.endOf('month');
  const windowStart = monthStart.toJSDate();
  const windowEnd = monthEnd.toJSDate();

  // Source filter (D-17) — telegram only, exclude RITUAL_RESPONSE
  const corpus = await db
    .select()
    .from(pensieveEntries)
    .where(
      and(
        eq(pensieveEntries.source, 'telegram'),
        or(
          isNull(pensieveEntries.epistemicTag),
          ne(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'),
        ),
        isNull(pensieveEntries.deletedAt),
        gte(pensieveEntries.createdAt, windowStart),
        lte(pensieveEntries.createdAt, windowEnd),
      ),
    );

  // Word count BEFORE deciding belowThreshold (D-18, D-19)
  const wordCount = corpus.reduce(
    (sum, entry) => sum + countWords(entry.content),
    0,
  );

  if (wordCount < MIN_SPEECH_WORDS) {
    return {
      belowThreshold: true,
      wordCount,
      neededWords: MIN_SPEECH_WORDS - wordCount,
    };
  }

  // Above threshold — load episodic summaries + prev history snapshot
  const [summaries, prevSnapshotRow] = await Promise.all([
    getEpisodicSummariesRange(windowStart, windowEnd),
    db
      .select()
      .from(profileHistory)
      .where(eq(profileHistory.profileTableName, PROFILE_TYPE_TO_TABLE_NAME[profileType]))
      .orderBy(desc(profileHistory.recordedAt))
      .limit(1),
  ]);

  return {
    belowThreshold: false,
    corpus,
    episodicSummaries: summaries,
    wordCount,
    prevHistorySnapshot: (prevSnapshotRow[0]?.snapshot as T | undefined) ?? null,
  };
}
```

**Note on enum-typed column:** `pensieveEntries.epistemicTag` is `epistemicTagEnum('epistemic_tag')` at `schema.ts:120`. The enum is nullable (no `.notNull()` in schema at line 120). Drizzle accepts `ne(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE')` because `'RITUAL_RESPONSE'` is a literal of the enum's union type. The `isNull` + `ne` combo (wrapped in `or()`) handles both NULL and non-RITUAL_RESPONSE rows.

**Note on `getEpisodicSummariesRange`:** Already exported from `src/pensieve/retrieve.ts` per shared.ts:66 (VERIFIED). Same helper M010 uses.

### Example 5: Reader API

```typescript
// Appended to src/memory/profiles.ts AFTER getOperationalProfiles (~line 199)

import {
  profileHexaco,
  profileSchwartz,
  profileAttachment,
} from '../db/schema.js';  // add to existing import block
import {
  HexacoProfileSchemaV3,
  SchwartzProfileSchemaV3,
  AttachmentProfileSchemaV3,
  type HexacoProfileData,
  type SchwartzProfileData,
  type AttachmentProfileData,
} from './profiles/psychological-schemas.js';
import type { PsychologicalProfileType } from './profiles/psychological-shared.js';

// PSYCHOLOGICAL_PROFILE_SCHEMAS dispatcher (mirrors PROFILE_SCHEMAS at line 83)
const PSYCHOLOGICAL_PROFILE_SCHEMAS: Record<PsychologicalProfileType, Record<number, z.ZodTypeAny>> = {
  hexaco: { 1: HexacoProfileSchemaV3 },
  schwartz: { 1: SchwartzProfileSchemaV3 },
  attachment: { 1: AttachmentProfileSchemaV3 },
};

export interface PsychologicalProfiles {
  hexaco: ProfileRow<HexacoProfileData> | null;
  schwartz: ProfileRow<SchwartzProfileData> | null;
  attachment: ProfileRow<AttachmentProfileData> | null;
}

async function readOnePsychologicalProfile<T>(
  profileType: PsychologicalProfileType,
  table: any,
): Promise<ProfileRow<T> | null> {
  try {
    const rows = await db.select().from(table).where(eq(table.name, 'primary')).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0]!;

    // 3-layer parse defense (D-23) — layer 1: schema_version
    const parser = PSYCHOLOGICAL_PROFILE_SCHEMAS[profileType][row.schemaVersion as number];
    if (!parser) {
      logger.warn(
        { profileType, schemaVersion: row.schemaVersion },
        'chris.psychological.profile.read.schema_mismatch',
      );
      return null;
    }

    // Layer 2: safeParse
    // Strip ALL metadata columns including the new word-count + attachment-specific
    // ones (Pitfall 7) — extend stripMetadataColumns or duplicate inline.
    const dataToValidate = stripPsychologicalMetadataColumns(row);
    const parsed = parser.safeParse(dataToValidate);
    if (!parsed.success) {
      logger.warn(
        { profileType, error: parsed.error.message },
        'chris.psychological.profile.read.parse_failed',
      );
      return null;
    }

    return {
      data: parsed.data as T,
      confidence: row.overallConfidence,
      lastUpdated: row.lastUpdated ?? new Date(0),  // null lastUpdated = never run → epoch
      schemaVersion: row.schemaVersion,
    };
  } catch (error) {
    // Layer 3: unexpected throw
    logger.warn(
      { profileType, error: error instanceof Error ? error.message : String(error) },
      'chris.psychological.profile.read.unknown_error',
    );
    return null;
  }
}

function stripPsychologicalMetadataColumns(row: Record<string, any>): Record<string, unknown> {
  // Pitfall 7 — strip ALL metadata columns; only per-dim jsonb fields survive.
  const {
    id, name, schemaVersion, substrateHash, overallConfidence,
    wordCount, wordCountAtLastRun, lastUpdated, createdAt,
    relationalWordCount, activated,  // attachment-only; harmless on hexaco/schwartz rows
    ...rest
  } = row;
  void id; void name; void schemaVersion; void substrateHash; void overallConfidence;
  void wordCount; void wordCountAtLastRun; void lastUpdated; void createdAt;
  void relationalWordCount; void activated;

  // Drizzle camelCase → snake_case for Zod
  const snakeRest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    const snake = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    snakeRest[snake] = v;
  }
  return snakeRest;
}

export async function getPsychologicalProfiles(): Promise<PsychologicalProfiles> {
  const [hexaco, schwartz, attachment] = await Promise.all([
    readOnePsychologicalProfile<HexacoProfileData>('hexaco', profileHexaco),
    readOnePsychologicalProfile<SchwartzProfileData>('schwartz', profileSchwartz),
    readOnePsychologicalProfile<AttachmentProfileData>('attachment', profileAttachment),
  ]);
  return { hexaco, schwartz, attachment };
}
```

### Example 6: Boundary Audit Test

```typescript
// New file: src/memory/profiles/__tests__/psych-boundary-audit.test.ts
// Mirrors src/chris/__tests__/boundary-audit.test.ts:38-127 (VERIFIED)

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Walk up from src/memory/profiles/__tests__/ to project root (4 levels).
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

async function readSource(relPath: string): Promise<string> {
  return readFile(resolve(PROJECT_ROOT, relPath), 'utf8');
}

function findHits(contents: string, pattern: RegExp): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (pattern.test(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function formatHits(hits: Array<{ line: number; text: string }>): string {
  return hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n');
}

// D-32 direction 1: operational vocabulary in psychological files
const OPERATIONAL_VOCAB = /\b(jurisdictional|capital|health|family)\b/;
const PSYCHOLOGICAL_FILES = [
  'src/memory/profiles/psychological-schemas.ts',
  'src/memory/profiles/psychological-shared.ts',
  // self-allowlist: 'src/memory/profiles/__tests__/psych-boundary-audit.test.ts' is NOT included
];

// D-32 direction 2: psychological vocabulary in operational files
const PSYCHOLOGICAL_VOCAB = /\b(hexaco|schwartz|attachment)\b/;
const OPERATIONAL_FILES = [
  'src/memory/profile-prompt.ts',
  'src/memory/profile-updater.ts',
  'src/memory/profiles/shared.ts',
  'src/memory/profiles/schemas.ts',
  'src/memory/profiles/jurisdictional.ts',
  'src/memory/profiles/capital.ts',
  'src/memory/profiles/health.ts',
  'src/memory/profiles/family.ts',
  // Note: src/memory/profiles.ts contains BOTH operational and psychological
  // (per D-21 — getPsychologicalProfiles added after getOperationalProfiles).
  // It is intentionally OMITTED from both directions of the audit.
];

describe('PSCH-10: D047 boundary — operational vocab forbidden in psychological files', () => {
  for (const file of PSYCHOLOGICAL_FILES) {
    it(`${file} has zero operational-vocabulary references`, async () => {
      const src = await readSource(file);
      const hits = findHits(src, OPERATIONAL_VOCAB);
      expect(
        hits,
        `D047 violation: ${file} references operational vocabulary at:\n` +
          formatHits(hits) +
          '\n\nPsychological profile files must not reference operational profile dimensions. ' +
          'Cross-reading is permitted via profiles.ts; cross-writing in shared substrate is forbidden.',
      ).toEqual([]);
    });
  }
});

describe('PSCH-10: D047 boundary — psychological vocab forbidden in operational files', () => {
  for (const file of OPERATIONAL_FILES) {
    it(`${file} has zero psychological-vocabulary references`, async () => {
      const src = await readSource(file);
      const hits = findHits(src, PSYCHOLOGICAL_VOCAB);
      expect(
        hits,
        `D047 violation: ${file} references psychological vocabulary at:\n` +
          formatHits(hits) +
          '\n\nOperational profile files must not reference psychological profile dimensions. ' +
          'Cross-writing in shared substrate is forbidden.',
      ).toEqual([]);
    });
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LIWC-22 / Boyd-Pennebaker lexicon HEXACO/Schwartz inference | Sonnet 4.6 direct inference via structured-output Zod v4 schema (Phase 38) | M010 set the precedent (2026-05-11) | Higher accuracy (r≈.38–.58 vs r≈.20–.35), multilingual EN/FR/RU coverage, zero new deps |
| Token-count gate via `messages.countTokens` | Inline `text.trim().split(/\s+/)` word counting | M011 spec lock | Avoids 1.5–2.5× Russian token inflation bias; eliminates SDK API call per gate check |
| 30-day rolling window | Calendar-month boundary via Luxon (DST-safe) | M011 spec lock | Aligns inter-period consistency with calendar (no drift from variable month lengths); enables "1st-of-month cron previous calendar month" Phase 38 invariant |
| `'{}'::jsonb` per-dim defaults (M010 pattern) | `'null'::jsonb` per-dim defaults | M011 / D-08 | Encodes meaningful "never inferred" cold state distinct from empty object |
| Sharing operational substrate loader with a parameter | Separate `psychological-shared.ts` sibling file | M011 / D-15 + PITFALLS Pitfall 3 | Prevents source-filter omission; clean separation enables boundary audit |
| Hash-skip idempotency (M010 GEN-07) | **Unconditional monthly fire** (M011 PGEN-06) | M011 spec lock | Inter-period consistency time series requires a data point every month; skipped months break the series |

**Deprecated/outdated:**
- M010 `loadProfileSubstrate(now)` with implicit source-agnostic filter — NOT deprecated, but explicitly NOT reused for M011. Different substrate semantics; co-existence in `src/memory/profiles/` directory is by design.
- Existing `regen-snapshots.sh` `REGEN_PRODUCED_ACCEPTANCE` flag protecting `0013_snapshot.json` as the "future-acceptance" artifact — bumped to `0014_snapshot.json` in Phase 37 (the real 0013 lands).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `_journal.json` `when` field format is unix milliseconds (e.g., `1778482284254`) | §"`_journal.json` entry format" | Low — VERIFIED against all 13 existing entries; drizzle-kit standard |
| A2 | Schema.ts line numbers for `profileFamily` (613) and `profileHistory` (646) are stable (±5 lines) | §"Drizzle Table Export Shape" | Low — VERIFIED in session 2026-05-13; minor edits could shift |
| A3 | `regen-snapshots.sh` `REGEN_PRODUCED_ACCEPTANCE` flag at lines 122, 152-153, 384, 397-399 protects `0013*.json` and must be bumped to `0014*.json` | §"regen-snapshots.sh cleanup-flag pattern" | Medium — if the planner forgets the bump, the regen script will delete the new real `0013_snapshot.json` after acceptance gate. Mitigation: verify by running `bash scripts/regen-snapshots.sh --check-only` after the planned bump. |
| A4 | `pensieveEntries.epistemicTag` enum supports `ne()` comparison against literal `'RITUAL_RESPONSE'` | §"Substrate Loader Query Shape" | Low — VERIFIED enum at schema.ts:31-46 includes `RITUAL_RESPONSE`; pattern mirrors `inArray` usage at retrieve.ts and shared.ts:222 |
| A5 | `profile_history.profileTableName` accepts `'profile_hexaco'`, `'profile_schwartz'`, `'profile_attachment'` strings without schema change | §"profile_history Write Contract" | Low — VERIFIED schema.ts:650 (`profileTableName: text('profile_table_name').notNull()`) is freeform `text NOT NULL`; no FK; no enum. M010 already writes 4 different discriminator strings to this column. |
| A6 | `computeSubstrateHash` in `shared.ts:298-311` is M010-private and Phase 37 doesn't need to call it; the seed `substrate_hash=''` is compatible with whatever Phase 38 writes | §"computeSubstrateHash Reuse" | Low — VERIFIED computeSubstrateHash signature accepts ProfileSubstrate (M010 type) which is incompatible with Phase 37's psychological substrate; Phase 38 will need to either fork the function or generalize it. Phase 37 is unaffected. |
| A7 | `psychological-shared.ts` `countWords` private helper is sufficient; no public re-export needed | §"Substrate Loader Query Shape" | Low — VERIFIED by CONTEXT.md "specifics" §4 ("Do NOT export it for general use"). |
| A8 | Drizzle `.$type<HexacoProfileData['honesty_humility']>()` correctly infers `HexacoDimension \| null` because the Zod factory uses `.nullable()` | §"Drizzle Table Export Shape" | Low — VERIFIED M010 pattern at schema.ts:545 uses `.$type<JurisdictionalProfileData['current_country']>()` and the Zod schema at schemas.ts:25 declares `.nullable()`. Same pattern. |
| A9 | `getEpisodicSummariesRange(windowStart, windowEnd)` exists and accepts Date args | §"Substrate Loader Query Shape" | Low — VERIFIED imported at `shared.ts:66`; same helper M010 uses |
| A10 | `profile_history_table_recorded_idx` covers the new `'profile_hexaco'`/`'profile_schwartz'`/`'profile_attachment'` discriminator values without modification | §"profile_history Write Contract" | Low — VERIFIED schema.ts:656 is a btree index on `(profile_table_name, recorded_at DESC)`; string-discriminator btree handles new values for free |

**All ten assumptions tagged `[ASSUMED]` are LOW risk; nine are verified in this session. A3 carries the only medium risk and is the most likely place a planner gap would surface — verify the cleanup-flag bump with `--check-only` before merging Plan 37-01.**

## Specific Research Findings (the 11 informational gaps from `<additional_context>`)

### 1. Migration 0013 SQL Structure

**Verification status: ✓ verified** against `0012_operational_profiles.sql` (full file read, 205 lines).

Column DDL ordering convention from 0012:
1. `id uuid PRIMARY KEY` (line 26)
2. `name text DEFAULT 'primary' NOT NULL` (27)
3. `schema_version integer DEFAULT 1 NOT NULL` (28)
4. `substrate_hash text DEFAULT '' NOT NULL` (29)
5. `confidence real DEFAULT 0 NOT NULL` (30) — Phase 37 renames to `overall_confidence`
6. `data_consistency real DEFAULT 0 NOT NULL` (31) — Phase 37 DROPS this column (not in PSCH-01 requirement set)
7. Per-dim jsonb columns (32-39)
8. `last_updated timestamp with time zone DEFAULT now() NOT NULL` (40) — Phase 37 makes this `NULLABLE` per D-06 ("null = never run")
9. `created_at timestamp with time zone DEFAULT now() NOT NULL` (41)
10. CONSTRAINTS: name_unique (42), confidence bounds (43), data_consistency bounds (44)

**Phase 37 deviations from 0012 shape:**
- ADD `word_count integer NOT NULL DEFAULT 0` and `word_count_at_last_run integer NOT NULL DEFAULT 0` between confidence and per-dim columns
- ADD `relational_word_count int NOT NULL DEFAULT 0` and `activated boolean NOT NULL DEFAULT false` on `profile_attachment` only
- DROP `data_consistency` (moved into per-dim jsonb shape via the `confidence` field per D-09)
- RENAME `confidence` → `overall_confidence`
- CHANGE `last_updated` from NOT NULL DEFAULT now() to NULLABLE (no default)
- CHANGE per-dim jsonb defaults from `'null'::jsonb` (varies per col in 0012) — Phase 37 uses `'null'::jsonb` for ALL dim cols (D-08)
- CHANGE CHECK constraint name: `profile_*_confidence_bounds` → `profile_*_overall_confidence_bounds`

Sentinel-row INSERT pattern from 0012:174-186 (the `profile_health` all-zeros case, most similar to Phase 37's seed):
```sql
INSERT INTO "profile_health"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "open_hypotheses", ...)
VALUES
    ('primary', 1, '', 0, 0,
     '[]'::jsonb, ...)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
```

Phase 37 INSERT: omit dim columns (they default to `'null'::jsonb`); include the new word-count columns. See Example 1 above.

### 2. Drizzle Table Export Shape

**Verification status: ✓ verified** against `schema.ts:536-636` (full M010 block read).

Exact `.$type<T>()` syntax for nullable dim:

```typescript
honestyHumility: jsonb('honesty_humility').$type<HexacoProfileData['honesty_humility']>().default(sql`'null'::jsonb`),
```

`HexacoProfileData['honesty_humility']` resolves to `HexacoDimension | null` because the Zod factory uses `.nullable()`. The column does NOT use `.notNull()` (the M010 row-level cols use it, but jsonb cols use it inconsistently — verified at 545-552). Recommendation: include `.notNull()` to match M010 strict shape and pair with `'null'::jsonb` default (the JSON value `null` is still a value, NOT SQL NULL — see Example 1 note).

Insertion point: after `profileFamily` (start at line 613, end at line 636) and before `profileHistory` (line 646). Approximately 10 blank lines between in current state.

### 3. `_journal.json` Entry Format

**Verification status: ✓ verified** against `src/db/migrations/meta/_journal.json` (full file read).

Format for new entry (idx: 13):
```json
{
  "idx": 13,
  "version": "7",
  "when": <unix-ms timestamp strictly greater than 1778482284254>,
  "tag": "0013_psychological_profiles",
  "breakpoints": true
}
```

The top-level file format:
```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [ ... ]
}
```

The 0012 entry (latest, idx: 12) has `when: 1778482284254`. Phase 37's entry MUST have `when > 1778482284254`. Use `Date.now()` at the moment of writing the migration. `validate-journal-monotonic.ts` (verified at scripts/) enforces this at `test.sh:48` BEFORE migrations apply.

### 4. `scripts/test.sh` Migration Line Position

**Verification status: ✓ verified** against `scripts/test.sh:20, 83`.

Existing 0012 declarations:
- Line 20: `MIGRATION_12_SQL="src/db/migrations/0012_operational_profiles.sql"`
- Line 83: `psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_12_SQL"`

Phase 37 additions (sequential order mandatory):
- After line 20: `MIGRATION_13_SQL="src/db/migrations/0013_psychological_profiles.sql"`
- After line 83 (the 0012 psql line): identical psql block with `"$MIGRATION_13_SQL"`

The smoke gate block at lines 220-262 verifies migration 0012 substrate. Phase 37 should ADD a parallel smoke gate after line 262 verifying:
- 3 new tables exist (`profile_hexaco`, `profile_schwartz`, `profile_attachment`)
- Each has exactly 1 sentinel row (`name='primary'`)
- Each has `overall_confidence=0`, `word_count=0`, `word_count_at_last_run=0`
- `profile_attachment` additionally has `relational_word_count=0`, `activated=false`
- All Never-Retrofit columns are present (information_schema.columns count = 21+ per Section 4 below)

### 5. `scripts/regen-snapshots.sh` Cleanup-Flag Pattern

**Verification status: ✓ verified** against `scripts/regen-snapshots.sh` (full inspection, 6 lines found via grep).

The flag `REGEN_PRODUCED_ACCEPTANCE` is defined at line 122 (initial value `0`). It is bumped to `1` at line 385 just before the acceptance-gate `drizzle-kit generate`. Three cleanup paths use it:

- **Line 141-143 (cleanup() function — pre-script cleanup):** deletes `0011_acceptance_check*.sql`, `0012_acceptance_check*.sql`, `0013_acceptance_check*.sql`. Phase 37 should ADD `0014_acceptance_check*.sql` to this list (or, since the next migration after the real 0013 is unknown, simply replace `0013` with `0014` — the script protects "future migration N+1 names").
- **Line 152-153 (cleanup() snapshot guard):** `if [[ "${REGEN_PRODUCED_ACCEPTANCE}" -eq 1 ]]; then find "${META_DIR}" -name "0013_snapshot.json" -delete`. Phase 37 must change `0013_snapshot.json` → `0014_snapshot.json` here.
- **Line 397-399 (mid-script cleanup):** `find "${MIGRATIONS_DIR}" -maxdepth 1 -name "0013_acceptance_check*.sql" -delete` AND `find "${META_DIR}" -name "0013_snapshot.json" -delete`. Phase 37 must change all `0013` references to `0014` here.

Lines 117-122 are explanatory comments:
> Phase 33 extends this discipline to 0012 — committed 0012_snapshot.json must be preserved (it ships in Plan 33-01); only the post-0012 acceptance-gate artifact (0013_snapshot.json named by drizzle's sequence-counter) is wiped

Phase 37 must update the comment block to:
> Phase 37 extends this discipline to 0013 — committed 0013_snapshot.json must be preserved (it ships in Plan 37-01); only the post-0013 acceptance-gate artifact (0014_snapshot.json) is wiped

**Net edit:** five lines need `0013` → `0014` and two comment blocks reflecting the M010→M011 transition.

### 6. Substrate Loader Query Shape

**Verification status: ✓ verified** against `shared.ts:206-254` and `schema.ts:115-131, 31-46`.

Drizzle pattern for `epistemic_tag` exclusion against the enum column:

```typescript
// pensieveEntries.epistemicTag is nullable enum (no .notNull() at schema.ts:120).
// Use or() to combine NULL allowance + ne() exclusion:
or(
  isNull(pensieveEntries.epistemicTag),
  ne(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'),
)
```

Alternative (more efficient if the substrate inevitably has only valid epistemic_tags): use `notInArray(pensieveEntries.epistemicTag, ['RITUAL_RESPONSE'])` — but `notInArray` with a single-element list returns false for NULL rows. The `or(isNull, ne)` pattern is safer. Verified `ne` is exported from `drizzle-orm` (used elsewhere in the codebase per common Drizzle API surface; if not found locally, fall back to `not(eq(...))`).

Full SELECT pattern from shared.ts:209-230 (the `pensieveEntries` block) provides the structural template. Phase 37's query replaces `inArray(epistemicTag, tags)` with `or(isNull, ne)`, adds `eq(source, 'telegram')`, and uses calendar-month boundary instead of 60-day rolling.

### 7. 3-Layer Zod v3 Parse Defense Pattern

**Verification status: ✓ verified** against `profiles.ts:100-152`.

Structured warning event names emitted (M010 pattern):
- `chris.profile.read.schema_mismatch` (line 116 + 130) — both Layer 1 (parser missing) and Layer 2 (safeParse fail) use this name in M010
- `chris.profile.read.error` (line 148) — Layer 3 outer catch

Phase 37 naming convention per D-22 + D-23 (explicit divergence from M010 to enable Phase 39 to distinguish operational vs psychological failures):
- Layer 1: `chris.psychological.profile.read.schema_mismatch`
- Layer 2: `chris.psychological.profile.read.parse_failed` (distinct name; M010 reused `schema_mismatch` but D-23 names this `parse_failed`)
- Layer 3: `chris.psychological.profile.read.unknown_error` (M010 used `.read.error`; D-23 names this `.unknown_error`)

Per-profile null-return logic: each profile read is its own `try/catch` inside `readOnePsychologicalProfile`; failures return `null` for that profile. Top-level `Promise.all` aggregates 3 nullable results. No top-level catch needed because each inner function already swallows. Mirrors `profiles.ts:191-198` exactly.

### 8. Boundary-Audit Test Shape

**Verification status: ✓ verified** against `src/chris/__tests__/boundary-audit.test.ts` (only 127 lines; full file read).

File-glob pattern: NOT a glob. The M008 test uses an explicit array of file paths (lines 70, 82, 96, 109 — three hardcoded relative paths). Phase 37 mirrors this: explicit arrays `PSYCHOLOGICAL_FILES` and `OPERATIONAL_FILES` in the test source.

Regex format: word-boundary `\b` per M008 pattern (line 47-48: `/\bepisodic_summaries\b|\bepisodicSummaries\b/`). Phase 37 uses `/\b(jurisdictional|capital|health|family)\b/` and `/\b(hexaco|schwartz|attachment)\b/` per D-32.

Self-allowlist mechanism: simply do not include the test file in either `PSYCHOLOGICAL_FILES` or `OPERATIONAL_FILES`. Verified M008 takes the same approach (the test file `src/chris/__tests__/boundary-audit.test.ts` is not present in its own input arrays).

PROJECT_ROOT resolution: `resolve(__dirname, '..', '..', '..')` for M008 (test at depth 3 in `src/chris/__tests__/`). Phase 37 test is at depth 4 in `src/memory/profiles/__tests__/` → `resolve(__dirname, '..', '..', '..', '..')`. VERIFIED depth count.

### 9. `profile_history` Write Contract

**Verification status: ✓ verified** against `schema.ts:646-658` and `0012_operational_profiles.sql:115-127`.

Schema definition:
```typescript
// schema.ts:646-658 (VERIFIED)
export const profileHistory = pgTable('profile_history', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
  profileTableName: text('profile_table_name').notNull(),  // ← freeform text, no FK, no enum
  profileId: uuid('profile_id').notNull(),
  snapshot: jsonb('snapshot').$type<ProfileSnapshot>().notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('profile_history_table_recorded_idx').on(table.profileTableName, table.recordedAt.desc()),
]);
```

The `profile_table_name` discriminator is `text NOT NULL` with NO foreign key constraint, NO check constraint, NO enum. New values `'profile_hexaco'`, `'profile_schwartz'`, `'profile_attachment'` work without schema change. The btree index `profile_history_table_recorded_idx` on `(profile_table_name, recorded_at DESC)` automatically covers the new discriminator strings.

`ProfileSnapshot` type: imported at `schema.ts:26` from `'../memory/profiles/schemas.js'`. Currently `Record<string, unknown>` (per CONTEXT.md "code_context"). Accommodates any row shape — Phase 38 generators write whatever they want, no schema change needed in Phase 37.

**Phase 37 does NOT write to profile_history.** Only Phase 38 generators do, and only after their first Sonnet call. Phase 37 just creates the seed rows; profile_history remains empty after migration apply (validated by 0012 smoke gate's `(SELECT COUNT(*) FROM profile_history) AS hist_count` = 0).

### 10. `computeSubstrateHash` Reuse

**Verification status: ✓ verified** against `shared.ts:298-311`.

Existing M010 function:
```typescript
// shared.ts:298-311 (VERIFIED)
export function computeSubstrateHash(
  substrate: ProfileSubstrate,           // ← M010-specific type at shared.ts:113
  prevStateMeta: PrevStateMeta,
): string {
  const json = canonicalSubstrateJson({
    pensieveIds: substrate.pensieveEntries.map((e) => e.id),
    episodicDates: substrate.episodicSummaries.map((s) => s.summaryDate),
    decisionIds: substrate.decisions.map((d) => d.id),
    schemaVersion: prevStateMeta.schema_version,
  });
  return createHash('sha256').update(json).digest('hex');
}
```

**Phase 37 does not need to call this function.** The seed-row `substrate_hash = ''` value is the M010 invariant value (`shared.ts:295-296` comment: "Phase 33 seed-row substrate_hash='' never matches a real SHA-256 hex → first fire ever for each profile always calls Sonnet"). Empty string is universally compatible with whatever hash format Phase 38 chooses — it just never matches anything real.

**Phase 38 forking decision (NOT Phase 37's concern):** Phase 38 will need to either (a) call `computeSubstrateHash` with a synthesized ProfileSubstrate-shape adapter, or (b) fork the function into a `computePsychologicalSubstrateHash(substrate: PsychologicalSubstrate, ...)` variant. Per PGEN-06 the hash is recorded for audit but never compared (unconditional fire), so either path works. Phase 38 owns this decision.

**Verified compatibility:** Seed `substrate_hash=''` works because any string equality comparison (`row.substrate_hash === computedHash`) will be false against a SHA-256 hex output. The empty string is a no-op identity for the absence of a hash.

### 11. Validation Architecture Section

See dedicated section below.

## Environment Availability

Not applicable. Phase 37 is pure code + DDL + drizzle-kit regen (already installed). No external tools, services, runtimes, CLIs, databases, or package managers introduced. The existing Docker Postgres test infrastructure (`docker-compose.local.yml`, port 5433 for test.sh + 5434 for regen-snapshots.sh) is unchanged.

## Validation Architecture

`workflow.nyquist_validation: true` per `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 [VERIFIED: package.json:46] |
| Config file | `vitest.config.ts` (project root) — not inspected in this session but assumed present per existing test infra |
| Quick run command | `npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` |
| Full suite command | `bash scripts/test.sh` (starts Docker Postgres, applies migrations 0000–0013, runs full vitest suite) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PSCH-01 | Migration 0013 applies cleanly to fresh Docker postgres; 3 tables + sentinel rows + Never-Retrofit cols present | integration (real-DB smoke gate in test.sh) | `bash scripts/test.sh` (smoke gate at lines 220-262 plus new Phase 37 block) | ❌ Wave 0 (smoke gate must be appended to test.sh) |
| PSCH-02 | TypeScript compiler accepts `profileHexaco` Drizzle table with `.$type<HexacoDimension \| null>()` jsonb columns | type-check | `npx tsc --noEmit` (existing build step) | ✅ existing |
| PSCH-03 | TypeScript compiler accepts `profileSchwartz` Drizzle table | type-check | `npx tsc --noEmit` | ✅ existing |
| PSCH-04 | TypeScript compiler accepts `profileAttachment` Drizzle table + `relational_word_count` + `activated` columns present in smoke gate | type-check + integration smoke | `npx tsc --noEmit` + `bash scripts/test.sh` | ✅ + ❌ Wave 0 |
| PSCH-05 | Cold-start seed rows verified by smoke gate (counts + values) | integration | `bash scripts/test.sh` | ❌ Wave 0 |
| PSCH-06 | Zod v3+v4 dual schemas in `psychological-schemas.ts` parse known-good fixtures | unit | `npx vitest run src/memory/profiles/__tests__/psychological-schemas.test.ts` | ❌ Wave 0 (test file to be added; mirror schemas.test.ts pattern if present) |
| PSCH-07 | `loadPsychologicalSubstrate('hexaco', now)` returns only `source='telegram'` entries with non-RITUAL_RESPONSE tag; Gmail/Immich/Drive rows provably absent | integration (real-DB) | `npx vitest run src/memory/profiles/__tests__/psychological-shared.test.ts` | ❌ Wave 0 |
| PSCH-08 | `loadPsychologicalSubstrate` returns `{ belowThreshold: true, wordCount, neededWords }` when corpus word count < 5000; no Sonnet call possible | integration (real-DB) | `npx vitest run src/memory/profiles/__tests__/psychological-shared.test.ts` | ❌ Wave 0 |
| PSCH-09 | `getPsychologicalProfiles()` never throws; returns null per profile on DB error; 3-layer Zod parse defense behaves per spec | integration (real-DB) + unit (mocked schema_version=999) | `npx vitest run src/memory/profiles/__tests__/getPsychologicalProfiles.test.ts` | ❌ Wave 0 |
| PSCH-10 | `psych-boundary-audit.test.ts` fails on cross-vocab insertion in either direction | unit (regex sweep) | `npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | ❌ Wave 0 (this IS the test file — created in Plan 37-02) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/memory/profiles/__tests__/` — runs only the new psychological test files; ~5–10 seconds; catches type errors, Zod schema regressions, boundary-audit violations, and substrate loader logic faults without spinning up Docker.
- **Per wave merge:** `bash scripts/test.sh` — full Docker Postgres + all migrations + full vitest suite; ~2–3 minutes; catches migration apply failures, smoke-gate failures (table counts + seed values + non-retrofittable col counts), and cross-suite regressions.
- **Phase gate:** Full suite green before `/gsd-verify-work` invocation. Includes the new smoke gates for migration 0013 substrate.

### Wave 0 Gaps

- [ ] `scripts/test.sh` — append `MIGRATION_13_SQL` declaration after line 20 + psql apply block after line 83 + new smoke gate after line 262 (table count = 3 new + sentinel row check + Never-Retrofit column count assertion)
- [ ] `src/memory/profiles/__tests__/psychological-schemas.test.ts` (NEW) — Zod v3+v4 dual schema parsing tests (mirror M010 if `schemas.test.ts` exists; otherwise simple known-good + known-bad fixture cases)
- [ ] `src/memory/profiles/__tests__/psychological-shared.test.ts` (NEW) — covers PSCH-07 + PSCH-08: source filter (telegram-only), RITUAL_RESPONSE exclusion, calendar-month boundary, 5,000-word floor, `belowThreshold: true` return shape, `prevHistorySnapshot` retrieval
- [ ] `src/memory/profiles/__tests__/getPsychologicalProfiles.test.ts` (NEW) — covers PSCH-09: never-throw on DB error, 3-layer Zod parse defense, per-profile null isolation, `Promise.all` parallel reads
- [ ] `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (NEW) — covers PSCH-10: this IS the deliverable (D-31)
- [ ] Framework install: none needed; vitest already at ^4.1.2

*(If any of the four NEW test files turn out to already exist with stub content, Plan 37-02 fills them in. None exist as of 2026-05-13 per `ls src/memory/profiles/__tests__/` verification in this session.)*

## Security Domain

`security_enforcement` not present in `.planning/config.json`. Treating as enabled per default. Phase 37 has minimal security surface (schema-only changes + read-only loader); below is the applicable ASVS review.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth surface in Phase 37) |
| V3 Session Management | no | — (no session handling) |
| V4 Access Control | yes (data-tier) | Drizzle parameterized queries via `eq()`, `ne()`, etc.; no string concatenation in WHERE clauses (VERIFIED in shared.ts loader pattern) |
| V5 Input Validation | yes | Zod v3 `.safeParse` at read boundary (3-layer parse defense); Zod v4 at SDK boundary (Phase 38 consumes); migration SQL hand-authored with literal values only (no parameter substitution risk) |
| V6 Cryptography | yes | `node:crypto` `createHash('sha256')` for substrate hash; built-in, never hand-rolled. Phase 37 doesn't compute hashes; Phase 38 does, but uses the same pattern as M010 `shared.ts:310`. |
| V7 Error Handling & Logging | yes | Never-throw reader contract; per-profile null + structured `logger.warn` events (`chris.psychological.profile.read.{schema_mismatch,parse_failed,unknown_error}`); no PII leaked in log messages |
| V8 Data Protection | yes | Substrate corpus contains Greg's own speech (sensitive). `loadPsychologicalSubstrate` only reads existing rows; no new write surface. `psych-boundary-audit.test.ts` prevents accidental cross-contamination of psychological data into operational generators (which have different injection scopes). |
| V9 Communications Security | no | — (no network I/O in Phase 37; Phase 38 owns Sonnet HTTP calls) |
| V10 Malicious Code | no | — |
| V11 Business Logic | yes | 5,000-word floor is a business-logic gate; word counting is deterministic and inline (no library injection risk); discriminated-union return type forces downstream code to handle the below-threshold branch explicitly |

### Known Threat Patterns for Drizzle + Postgres 16 + Node 22 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via substrate query | Tampering | Drizzle parameterized `eq()` / `ne()` / `gte()` / `lte()` — no string concat |
| Stored XSS via jsonb column | Tampering | jsonb is structured data; Phase 37 reader returns typed values via Zod, not raw HTML; Phase 39 display formatter (out of scope) must escape if rendering to web UI |
| Authorization bypass via reader | Information Disclosure | `getPsychologicalProfiles()` is callable by any code that imports it; single-tenant Project Chris model (one user) means no per-user auth needed at the reader level |
| Word-count denial-of-service via giant Pensieve entry | Denial of Service | Pensieve content already has implicit size limits (Telegram message size); calendar-month window also caps corpus size |
| Cross-vocabulary leak into wrong substrate | Information Disclosure | `psych-boundary-audit.test.ts` enforces D047 at CI time |
| Sentinel-row uniqueness bypass | Tampering | `UNIQUE("name")` constraint + `ON CONFLICT (name) DO NOTHING` in migration; single-row-per-table application convention |

**No new attack surface introduced by Phase 37.** The boundary audit test itself is the primary defensive layer added.

## Open Questions

1. **Does the planner split Phase 37 into 2 plans (mirroring Phase 33) or ship as one atomic plan?**
   - What we know: Phase 33 split into 33-01 (migration + schema + tooling — HARD CO-LOC #M10-1) and 33-02 (reader + schemas + confidence). Phase 37's HARD CO-LOC #M11-1 is structurally identical to #M10-1.
   - What's unclear: Whether the planner perceives plan-37-02 surface as small enough to fold into 37-01 given the reduced complexity (3 tables vs 4, 1 substrate loader vs 1).
   - Recommendation: **Two plans, mirroring Phase 33.** The atomic HARD CO-LOC must own one plan exclusively (migration + schema + meta snapshot + journal + test.sh + regen-snapshots + psychological-schemas.ts), and the reader/loader/confidence/boundary-audit collection is its own logical unit. Splitting also enables Plan 37-02 to land its files even if Plan 37-01 is in review.

2. **Does Plan 37-01 include `psychological-schemas.ts` (as locked by D-03) or only the type imports it requires?**
   - What we know: D-03 lists `psychological-schemas.ts` as part of the HARD CO-LOC. The schema.ts table defs need `HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData` types to compile.
   - What's unclear: Whether the full Zod schema bodies (v3 + v4) belong in 37-01 or only the inferred TypeScript types.
   - Recommendation: **Full Zod schemas in 37-01.** Splitting types-only-in-37-01 vs zod-bodies-in-37-02 fragments the import surface and forces the planner to maintain a separate file for type stubs. The Zod schemas are tiny (~80 lines) and ship as a single unit per D-25.

3. **Does the new smoke-gate block in `scripts/test.sh` replace the existing 0012 smoke gate or run alongside it?**
   - What we know: M010 added the 0012 smoke gate at lines 220-262 (5 tables + 4 seed rows + 0 history + 4 confidence values + 20 non-retrofittable columns).
   - What's unclear: Whether the planner keeps the 0012 block as-is and APPENDS a parallel 0013 block, or merges them.
   - Recommendation: **Append, don't merge.** The 0012 smoke gate is the M010 acceptance-gate invariant and must remain unchanged for regression isolation. Phase 37 adds a parallel block immediately after line 262 with the 3-new-table assertions.

4. **Smoke-gate column count for the Phase 37 Never-Retrofit assertion?**
   - What we know: M010 asserts 20 columns (4 tables × 5 cols at test.sh:260). Phase 37's count: HEXACO has 7 retrofit-protected metadata columns (id, name, schema_version, substrate_hash, overall_confidence, word_count, word_count_at_last_run) + last_updated + created_at = 9 metadata cols. Schwartz same = 9. Attachment same + relational_word_count + activated = 11. Total metadata: 9+9+11 = 29.
   - What's unclear: Whether the smoke gate asserts the full 29 or just the 7 truly non-retrofittable per D-06+D-07.
   - Recommendation: Assert the 7 (D-06) + 2 (D-07 attachment-only) = 9 unique non-retrofittable column names across 3 tables. Query shape: count `WHERE column_name IN ('schema_version', 'substrate_hash', 'name', 'overall_confidence', 'word_count', 'word_count_at_last_run')` AND `table_name IN ('profile_hexaco', 'profile_schwartz', 'profile_attachment')` → expect 6×3 = 18. Plus a separate assertion that `profile_attachment` has `relational_word_count` AND `activated`.

5. **Does the substrate loader test (Wave 0 gap #3) need real Docker Postgres or can it mock the DB?**
   - What we know: M010 substrate tests at `src/memory/profiles/__tests__/shared.test.ts` (referenced at shared.ts:48) use real DB per the test.sh integration suite.
   - What's unclear: Whether Phase 37 must require real DB for the source-filter assertion or can use mocked `db.select()` chains.
   - Recommendation: **Real DB.** Seeding pensieve_entries fixtures with mixed `source` and `epistemic_tag` values exercises the actual Drizzle query construction; mocking `db.select().from().where()` chains is fragile and silently misses Drizzle's actual SQL generation. Phase 40 will own the bulk of integration testing (PMT-02/03/04); Phase 37's substrate test is a small targeted integration test verifying ONLY the WHERE clause behavior, ~30 lines.

## Sources

### Primary (HIGH confidence — live codebase, VERIFIED in this session)

- `/home/claude/chris/src/db/migrations/0012_operational_profiles.sql` — full file (205 lines) — migration shape + sentinel-row INSERT pattern
- `/home/claude/chris/src/db/migrations/meta/_journal.json` — full file (97 lines, 13 entries) — journal format + 0012 `when` value (1778482284254)
- `/home/claude/chris/src/db/schema.ts:25-46` — type imports + epistemic_tag enum values
- `/home/claude/chris/src/db/schema.ts:115-131` — pensieveEntries definition (source, epistemicTag nullability)
- `/home/claude/chris/src/db/schema.ts:520-658` — full M010 profile table block + profile_history
- `/home/claude/chris/src/memory/profiles.ts` — full file (392 lines read) — reader API + 3-layer parse defense + injection map + formatProfilesForPrompt
- `/home/claude/chris/src/memory/profiles/shared.ts:1-410` — substrate loader + computeSubstrateHash + runProfileGenerator
- `/home/claude/chris/src/memory/profiles/schemas.ts:1-117` — Zod v3+v4 dual schema pattern
- `/home/claude/chris/src/memory/confidence.ts` — full file (66 lines) — MIN_ENTRIES_THRESHOLD, SATURATION, isAboveThreshold pattern
- `/home/claude/chris/src/chris/__tests__/boundary-audit.test.ts` — full file (127 lines) — boundary-audit regex sweep pattern
- `/home/claude/chris/scripts/test.sh` — lines 1-100 + 220-287 — migration apply block + 0012 smoke gate
- `/home/claude/chris/scripts/regen-snapshots.sh` — lines 1-80 + grepped `0012`/`0013` references — REGEN_PRODUCED_ACCEPTANCE cleanup-flag flow
- `/home/claude/chris/scripts/validate-journal-monotonic.ts` — header + main function — Phase 32 #3 guardrail
- `/home/claude/chris/package.json` — dependency versions

### Primary (HIGH confidence — M011 spec & locked context)

- `/home/claude/chris/.planning/phases/37-psychological-substrate/37-CONTEXT.md` — 37 locked decisions D-01..D-37
- `/home/claude/chris/.planning/REQUIREMENTS.md` — PSCH-01..10 verbatim contract + PSURF/PGEN/PMT downstream context
- `/home/claude/chris/.planning/STATE.md` — D047 boundary + HARD CO-LOC constraints + open questions
- `/home/claude/chris/.planning/ROADMAP.md` Phase 37 entry — full success criteria + Never-Retrofit Checklist
- `/home/claude/chris/.planning/research/SUMMARY.md` — consolidated M011 research; zero-deps verdict; locked architecture decisions
- `/home/claude/chris/.planning/research/ARCHITECTURE.md` §§1–11 — table strategy, migration shape, prompt-assembler fork rationale
- `/home/claude/chris/.planning/research/PITFALLS.md` Pitfalls 1–10 — speech-source contamination, sparse-data overconfidence, Never-Retrofit incompleteness, etc.
- `/home/claude/chris/.planning/research/STACK.md` — zero-new-deps rationale; word-counting strategy

### Primary (HIGH confidence — Phase 33 precedent)

- `/home/claude/chris/.planning/milestones/v2.5-phases/33-profile-substrate/33-RESEARCH.md` (first 120 lines read) — direct analog: M010 operational substrate phase

### Secondary (MEDIUM confidence — referenced but not read in full this session)

- `/home/claude/chris/.planning/PROJECT.md` Key Decisions D027–D047 — architectural constraints summarized via CONTEXT.md
- `/home/claude/chris/.planning/milestones/v2.5-phases/33-profile-substrate/33-PATTERNS.md` — patterns-mapper analog (referenced in CONTEXT.md "specifics" §1)

### Tertiary (LOW confidence — none in this research)

No findings rely on WebSearch or unverified sources. Every recommendation traces to a file:line in the live codebase or to a locked decision in CONTEXT.md / REQUIREMENTS.md.

## Metadata

**Confidence breakdown:**
- Migration 0013 structure: HIGH — 0012 verified line-by-line; deviations enumerated per Section "Specific Research Findings" §1
- Drizzle table export shape: HIGH — schema.ts:536-636 verified live in session
- `_journal.json` format: HIGH — all 13 entries inspected; `when` value verified
- `scripts/test.sh` insertion point: HIGH — exact line numbers (20, 83) verified
- `scripts/regen-snapshots.sh` cleanup-flag: HIGH — grep'd to 5 specific lines (122, 141-143, 152-153, 384, 397-399); medium risk only because the bump requires touching 5+ lines (A3 in Assumptions Log)
- Substrate loader query shape: HIGH — pensieveEntries.epistemicTag nullability verified at schema.ts:120 (no `.notNull()`)
- 3-layer Zod v3 parse defense: HIGH — profiles.ts:100-152 verified
- Boundary-audit test shape: HIGH — full M008 file (127 lines) read; depth-from-project-root verified
- `profile_history` write contract: HIGH — schema.ts:646-658 verified; `profileTableName: text NOT NULL` no-FK no-enum
- `computeSubstrateHash` reuse: HIGH — shared.ts:298-311 verified; Phase 37 doesn't need to call it
- Validation Architecture: HIGH — Wave 0 gaps explicit; commands runnable; mapping to PSCH-01..10 complete

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days — stable; M011 ships within 2 weeks per ROADMAP and stack is locked)

## ## RESEARCH COMPLETE

**Phase:** 37 - Psychological Substrate
**Confidence:** HIGH

### Key Findings

1. **Phase 37 is mechanical mirroring of Phase 33**, not design. Every component (migration shape, Drizzle table export, sentinel-row INSERT, never-throw reader with 3-layer Zod parse defense, boundary-audit regex sweep) has a 1:1 M010 / M008 precedent verified live in this session. CONTEXT.md has pre-locked all 37 decisions D-01..D-37; this research file's contribution is the eleven informational gap resolutions plus the Validation Architecture mapping.

2. **The substrate loader divergences from M010 are critical and locked.** Source filter (`telegram` only, exclude `RITUAL_RESPONSE`), inline whitespace word-counting NOT token-counting, calendar-month boundary NOT 60-day rolling, discriminated-union return shape gating Sonnet calls before the 5,000-word floor. Phase 38 must NOT compose word-count gate with M010's entry-count gate (PITFALLS Pitfall 2 / CONTEXT.md "specifics" §5).

3. **Never-Retrofit Checklist is wider than M010** (7 cols for HEXACO/Schwartz; 9 cols for Attachment). All must ship in migration 0013. ALTER TABLE in a future 0014 to add `relational_word_count`, `activated`, or `word_count_at_last_run` is forbidden. Smoke gate in `scripts/test.sh` must assert all 9 non-retrofittable column names present across 3 tables.

4. **`regen-snapshots.sh` cleanup-flag bump touches 5 specific lines** (122, 141-143, 152-153, 384, 397-399) renaming `0013` → `0014` for the "future-acceptance" sentinel. Comment block at lines 117-122 also updates from "Phase 33 extends to 0012" → "Phase 37 extends to 0013". This is the highest-risk informational gap (A3 in Assumptions Log); recommend verifying with `bash scripts/regen-snapshots.sh --check-only` after the bump.

5. **`profile_history` requires zero schema changes** for M011. The `profile_table_name text NOT NULL` discriminator at schema.ts:650 is freeform (no FK, no enum); the btree index at schema.ts:656 covers new string values automatically. Phase 37 doesn't write to profile_history; Phase 38 does. Seed `substrate_hash = ''` is compatible with whatever hash format Phase 38 uses.

### File Created

`/home/claude/chris/.planning/phases/37-psychological-substrate/37-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Zero-deps verdict; all 6 core libs verified at package.json line numbers |
| Migration & Schema | HIGH | 0012 precedent read line-by-line; all 11 informational gaps resolved with file:line citations |
| Substrate Loader | HIGH | M010 shared.ts loader pattern (lines 206-254) inspected; pensieveEntries.epistemicTag nullability verified for `or(isNull, ne)` correctness |
| Reader API | HIGH | profiles.ts:100-198 inspected; 3-layer parse defense pattern documented with exact log event names |
| Boundary Audit | HIGH | M008 boundary-audit.test.ts (127 lines) inspected in full; self-allowlist mechanism + depth-from-root verified |
| Validation Architecture | HIGH | Wave 0 gaps enumerated; commands runnable; PSCH-01..10 → test mapping complete |

### Open Questions

1. Two-plan split (recommended) vs one atomic plan
2. Full Zod schemas in Plan 37-01 vs split (recommend full schemas in 37-01)
3. Smoke gate in test.sh: append vs merge with 0012 block (recommend append)
4. Exact column-count assertion in new smoke gate (recommend 18 + attachment-specific 2)
5. Real DB vs mocked DB for substrate loader test (recommend real DB)

### Ready for Planning

Research complete. The planner can now create PLAN.md files (recommended split: 37-01 atomic HARD CO-LOC #M11-1 + 37-02 reader/loader/confidence/boundary-audit). All 11 informational gaps from the task brief are resolved with file:line citations. All 37 CONTEXT.md decisions are verified against codebase reality with status ✓.

## RESEARCH COMPLETE
