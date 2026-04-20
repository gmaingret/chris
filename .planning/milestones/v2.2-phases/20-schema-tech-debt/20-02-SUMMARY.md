---
phase: 20-schema-tech-debt
plan: 02
subsystem: db
tags: [schema, migration, drizzle, zod, config, EPI-01, EPI-02, EPI-03, EPI-04]
requires:
  - "20-01 complete (drizzle-kit snapshots clean, chain 0000→0004 byte-accurate)"
  - "ROADMAP Phase 20 EPI-01, EPI-02, EPI-03, EPI-04"
provides:
  - "episodic_summaries table (9 columns, 3 content indexes + PK, DB-level importance CHECK 1..10)"
  - "Migration 0005 applies cleanly in Docker; drizzle-kit generate no-op against fully-migrated DB"
  - "Three-layer Zod schema chain in src/episodic/types.ts (SonnetOutput → Insert → DB-read)"
  - "config.episodicCron with EPISODIC_CRON env override and default '0 23 * * *'"
  - "scripts/test.sh applies migration 0005 in the raw-psql chain"
affects:
  - "src/db/schema.ts (episodicSummaries pgTable appended; imports extended with check + date)"
  - "src/db/migrations/0005_episodic_summaries.sql (new)"
  - "src/db/migrations/meta/0005_snapshot.json (new)"
  - "src/db/migrations/meta/_journal.json (6th entry added at idx=5)"
  - "src/episodic/types.ts (new file — three Zod schemas + types + parser helper)"
  - "src/config.ts (episodicCron field added after proactive messaging block)"
  - "scripts/test.sh (MIGRATION_5_SQL variable + apply block added)"
  - "package.json (zod ^3.24.0 added to dependencies)"
  - "package-lock.json (zod entry added at version 3.25.76)"
tech-stack:
  added:
    - "zod@^3.24.0 (resolved 3.25.76) — Zod 3.x API targeted by Anthropic SDK messages.parse() / zodOutputFormat() per CONTEXT.md research reference"
  patterns:
    - "Three-layer Zod schema chain via .extend() — strictest (Sonnet output) ⊂ insert (engine-supplied) ⊂ DB-read (row shape)"
    - "DB-level CHECK constraint (importance BETWEEN 1 AND 10) via drizzle-orm `check()` in the trailing-callback — belt-and-suspenders covering operator paths (OPS-01 backfill, direct psql) per CONTEXT.md D-07"
    - "Snake-case DB columns with camelCase TS properties via Drizzle's first-arg SQL name mapping (e.g. `emotionalArc: text('emotional_arc')`)"
    - "Calendar date vs instant distinction — summary_date uses Postgres `date` type (not timestamp) per CONTEXT.md D-09 (day boundary pre-resolved in config.proactiveTimezone at engine boundary)"
key-files:
  created:
    - "src/episodic/types.ts — 67 lines: EpisodicSummarySonnetOutputSchema + EpisodicSummaryInsertSchema + EpisodicSummarySchema + 3 z.infer types + parseEpisodicSummary helper"
    - "src/db/migrations/0005_episodic_summaries.sql — CREATE TABLE with inline UNIQUE + CHECK, two CREATE INDEX statements (GIN on topics, btree on importance)"
    - "src/db/migrations/meta/0005_snapshot.json — drizzle-kit snapshot for migration 0005 (episodic_summaries entry with indexes, uniqueConstraints, checkConstraints populated)"
    - ".planning/phases/20-schema-tech-debt/20-02-SUMMARY.md (this file)"
  modified:
    - "src/db/schema.ts — added `check, date` to drizzle-orm/pg-core import list; appended episodicSummaries pgTable definition (39 lines)"
    - "src/db/migrations/meta/_journal.json — 6th entry added at idx=5 with tag `0005_episodic_summaries`"
    - "src/config.ts — added `episodicCron: process.env.EPISODIC_CRON || '0 23 * * *'` field under new `// Episodic consolidation (M008 Phase 20)` section"
    - "scripts/test.sh — added MIGRATION_5_SQL variable + 2-line apply block following the existing pattern byte-for-byte"
    - "package.json — added `\"zod\": \"^3.24.0\"` to dependencies"
    - "package-lock.json — added zod dependency reference + node_modules/zod entry"
decisions:
  - "Zod installed via tarball extraction + surgical lockfile patch (not `npm install zod@^3.24.0 --save`) because this workspace's root-owned node_modules dedup path makes npm's reify step fail with EACCES. Same environmental constraint noted in Plan 20-01 SUMMARY §\"Environmental Notes\". Integrity sha512-gzUt/... matches the npm registry entry for zod 3.25.76 exactly."
  - "Resolved concrete zod version is 3.25.76 (latest matching `^3.24.0` per npm semver). Plan's `^3.24.0` spec is satisfied; NOT 4.x (Anthropic SDK constraint per CONTEXT.md)."
  - "Table has 9 columns total (1 PK + 8 content columns). CONTEXT.md D-09 and PLAN.md acceptance criteria both enumerate the full 9-column list; the system-prompt `critical_notes` line count of \"EXACTLY 8 columns\" excludes the id PK in its accounting. Schema matches authoritative CONTEXT.md D-09 exactly."
  - "Followed CONTEXT.md D-09 types (`key_quotes text[]`, `emotional_arc text NOT NULL`, `source_entry_ids uuid[]`) not the system-prompt critical_notes variants (`key_quotes JSONB`, `emotional_arc nullable`, `source_entry_ids TEXT[]`) which conflict with D-09 and with the plan's explicit schema. Plan + CONTEXT.md take precedence."
  - "Preserved existing multi-line import style in src/db/schema.ts when adding `check` and `date` (added at the end of the existing multi-line block). The plan's verify regex `\", check, date\"` assumed single-line imports, but the intent (import both identifiers) is satisfied."
metrics:
  duration_seconds: 3135
  duration_human: "~52 minutes"
  completed_date: "2026-04-18"
  tasks: 7
  files_created: 4
  files_modified: 6
  insertions: 1451
  deletions: 4
---

# Phase 20 Plan 02: Episodic Schema + Zod + Config Summary

Shipped the M008 episodic-consolidation database primitives on top of Plan 20-01's clean migration lineage: `episodic_summaries` table (9 columns, UNIQUE(summary_date), GIN(topics), btree(importance), DB-level CHECK on importance bounds) via drizzle-kit-generated migration 0005; three-layer Zod schema chain in `src/episodic/types.ts` (`EpisodicSummarySonnetOutputSchema` → `EpisodicSummaryInsertSchema` → `EpisodicSummarySchema` with strict bounds per CONTEXT.md D-12) + `parseEpisodicSummary` helper surfacing `ZodError.format()` for Phase 21 `notifyError()` readability; `config.episodicCron` with `EPISODIC_CRON` env override and default `'0 23 * * *'`; `scripts/test.sh` extended to apply migration 0005 in the raw-psql chain; and `zod@^3.24.0` (resolved 3.25.76) added as a runtime dependency. The D-03 acceptance gate is green — `drizzle-kit generate` against a freshly-migrated Docker DB with all 6 migrations applied prints "No schema changes, nothing to migrate". `npx tsc --noEmit` exits 0. `bash scripts/test.sh` exits 0 with 843 passed / 61 failed (904 total) — identical to the Plan 20-01 baseline, zero regressions from this plan's changes.

## Objective

Ship the EPI-01 / EPI-02 / EPI-03 / EPI-04 requirements in a single atomic wave on top of Plan 20-01's clean snapshot lineage. Phase 21 (Consolidation Engine) and Phase 22 (Cron + Retrieval Routing) both import from `src/episodic/types.ts` and rely on `config.episodicCron` / the migrated `episodic_summaries` table, so shipping these primitives together keeps Phase 20's delivery atomic and independently revertable from Plan 20-01's tech-debt resolution (CONTEXT.md D-04 rationale).

## What Was Done

### Task 1 — Added zod ^3.24.0 runtime dependency
- Added `"zod": "^3.24.0"` to `dependencies` in `package.json`.
- Added matching entry to `package-lock.json` (`node_modules/zod` at version 3.25.76, integrity `sha512-gzUt/...` matching the npm registry).
- Runtime probe: `node -e "require('zod')"` exits 0.
- Anthropic SDK left at `^0.80.0` per CONTEXT.md (bump to `^0.90.0` for `zodOutputFormat()` lands in Phase 21).
- Used tarball extraction + lockfile patch rather than `npm install --save` because the root-owned `node_modules/vitest/node_modules/esbuild` directory blocks npm's reify step with EACCES (same environmental quirk documented in Plan 20-01 SUMMARY).
- Commit: `6184d1d chore(20-02): add zod ^3.24.0 runtime dependency (EPI-03 prep)`

### Task 2 — Authored src/episodic/types.ts
- Created the directory `src/episodic/` and its FIRST file per CONTEXT.md D-14 (no `index.ts` barrel, no speculative `consolidate.ts` / `prompts.ts` stubs).
- Exports the three-layer Zod chain (D-11):
  - `EpisodicSummarySonnetOutputSchema` — strictest: `summary`, `importance`, `topics`, `emotional_arc`, `key_quotes`.
  - `EpisodicSummaryInsertSchema` — extends with `summary_date: z.date()` and `source_entry_ids: z.array(z.string().uuid())`.
  - `EpisodicSummarySchema` — extends with `id: z.string().uuid()` and `created_at: z.date()`.
- Strict bounds per D-12: `importance` integer [1, 10], `summary` min 50 chars, `topics` 1–10 non-empty strings, `key_quotes` up to 10 (may be empty per CONS-11), `emotional_arc` non-empty.
- TypeScript types exported via `z.infer<typeof X>`; `parseEpisodicSummary(input: unknown): EpisodicSummaryInsert` helper wraps `.parse()`.
- File-header comment `// Episodic consolidation types — M008 Phase 20 EPI-03` on line 1.
- Verification: `npx tsc --noEmit` 0 errors; `parseEpisodicSummary({})` throws `ZodError` with 7 issues; valid input parses cleanly.
- Commit: `356f722 feat(20-02): add src/episodic/types.ts three-layer Zod schema (EPI-03)`

### Task 3 — episodicSummaries pgTable in src/db/schema.ts
- Added `check` and `date` to the existing multi-line drizzle-orm/pg-core import block.
- Appended the `episodicSummaries` `pgTable` definition at the end of the file (after `decisionTriggerSuppressions`) with JSDoc referencing CONTEXT.md D-07 and D-08.
- 9 columns (1 PK + 8 content) matching CONTEXT.md D-09 exactly: `id` (uuid PK, `gen_random_uuid()`), `summaryDate` / `summary_date` (date NOT NULL), `summary` (text NOT NULL), `importance` (integer NOT NULL), `topics` (text[] NOT NULL DEFAULT '{}'), `emotionalArc` / `emotional_arc` (text NOT NULL), `keyQuotes` / `key_quotes` (text[] NOT NULL DEFAULT '{}'), `sourceEntryIds` / `source_entry_ids` (uuid[] NOT NULL DEFAULT '{}'), `createdAt` / `created_at` (timestamptz NOT NULL DEFAULT now() — `.notNull()` added explicitly per CONTEXT.md code_context note).
- Trailing callback contains all three spec indexes (EPI-02 non-retrofitted): `unique('episodic_summaries_summary_date_unique').on(table.summaryDate)`, `index('episodic_summaries_topics_idx').using('gin', table.topics)`, `index('episodic_summaries_importance_idx').on(table.importance)`; plus `check('episodic_summaries_importance_bounds', sql\`${table.importance} BETWEEN 1 AND 10\`)` (D-07 DB-level CHECK).
- Verification: `npx tsc --noEmit` 0 errors; all expected identifiers and names present.
- Commit: `861c8cc feat(20-02): add episodicSummaries pgTable + CHECK constraint (EPI-01, EPI-02)`

### Task 4 — Generated migration 0005 via drizzle-kit
- Brought up fresh Docker postgres (`docker compose -f docker-compose.local.yml up -d postgres`), applied migrations 0000..0004 via raw psql.
- Ran `DATABASE_URL=... npx drizzle-kit generate --name episodic_summaries`. Drizzle-kit detected the new table and emitted:
  - `src/db/migrations/0005_episodic_summaries.sql` (16 lines: CREATE TABLE with inline UNIQUE and CHECK constraints + two CREATE INDEX statements for GIN/topics and btree/importance).
  - `src/db/migrations/meta/0005_snapshot.json` (full schema snapshot with episodic_summaries entry; `indexes`, `uniqueConstraints`, `checkConstraints` all populated).
  - Updated `_journal.json` with 6th entry at idx=5, tag `0005_episodic_summaries`. File name matched target on first pass — no rename needed.
- Acceptance proof: applied the new 0005 SQL to the same postgres, confirmed `\d episodic_summaries` shows all 9 columns + PK + 3 spec indexes + CHECK (importance >= 1 AND importance <= 10).
- D-03 acceptance gate: re-ran `drizzle-kit generate --name regen_check_should_be_noop` — output `No schema changes, nothing to migrate 😴`. No spurious files emitted. Cleaned up container.
- Commit: `63c3cfc feat(db): generate migration 0005 episodic_summaries (EPI-01, EPI-02)`

### Task 5 — Extended scripts/test.sh to apply migration 0005
- Two surgical additions, matching the existing pattern byte-for-byte:
  - `MIGRATION_5_SQL="src/db/migrations/0005_episodic_summaries.sql"` declared right after `MIGRATION_4_SQL` (preserves numeric ordering).
  - `docker compose ... psql ... < "$MIGRATION_5_SQL"` apply block added right after the 0004 apply block.
- No refactoring — no globbing loop replacement.
- Verification: `bash -n scripts/test.sh` exits 0; variable and apply block grep-matches.
- Commit: `2c065d6 chore(20-02): extend scripts/test.sh to apply migration 0005`

### Task 6 — Added config.episodicCron field
- Appended a new `// Episodic consolidation (M008 Phase 20)` block below the existing proactive messaging group in `src/config.ts`:
  ```ts
  // Episodic consolidation (M008 Phase 20)
  // EPI-04: Episodic consolidation cron — fires at 23:00 in config.proactiveTimezone by default.
  episodicCron: process.env.EPISODIC_CRON || '0 23 * * *',
  ```
- `as const` closer preserved. `proactiveSweepCron` block untouched.
- Verification: `npx tsc --noEmit` 0 errors; runtime probe confirms `config.episodicCron === '0 23 * * *'` when `EPISODIC_CRON` is unset.
- Commit: `b12520a feat(config): add config.episodicCron with EPISODIC_CRON override (EPI-04)`

### Task 7 — Final gate (execution only, no files changed)
- `npx tsc --noEmit` → exit 0. No TypeScript errors.
- `bash scripts/test.sh` → **exit 0**, **843 passed / 61 failed (904 total)** in 2431.78s. The 61 failures are the Plan 20-01 pre-existing environmental baseline (primarily `@huggingface/transformers` `EACCES: permission denied, mkdir '.../@huggingface/transformers/.cache'` from the root-owned node_modules subdirectory in this workspace). Zero regressions introduced by this plan. Test count 843 passing is far above the plan's ≥ 152 floor.
- Fresh Docker postgres with all 6 migrations applied + `drizzle-kit generate --name final_noop_check` → `No schema changes, nothing to migrate 😴`. Emitted no artifact.
- `\d episodic_summaries` in that same fresh DB shows all 9 columns + 4 indexes (PK + UNIQUE(summary_date) + GIN(topics) + btree(importance)) + CHECK (importance >= 1 AND importance <= 10).
- ROADMAP Phase 20 Success Criteria #1 (drizzle no-op), #2 (\d shows all indexes), #4 (episodicCron readable), #5 (Docker gate ≥ 152) all green. Criterion #3 (`EpisodicSummaryInsertSchema.parse({})` throws) is covered at the Zod-schema level (runtime probe confirmed ZodError with 7 issues) and will be backed by Plan 20-03's dedicated unit test.

## Verification Results

### ROADMAP Phase 20 Success Criteria
| # | Criterion | Result |
|---|---|---|
| 1 | `drizzle-kit generate` against freshly-migrated Docker DB reports "No schema changes" | PASS — emitted no file; printed the no-op message |
| 2 | `\d episodic_summaries` shows all 3 spec indexes + CHECK | PASS — UNIQUE(summary_date), GIN(topics), btree(importance), CHECK (importance >= 1 AND importance <= 10) |
| 3 | `EpisodicSummaryInsertSchema.parse({})` throws ZodError | PASS at runtime (7 issues); formal unit test ships in Plan 20-03 |
| 4 | `config.episodicCron` readable with default `'0 23 * * *'` | PASS — tsx runtime probe printed `"0 23 * * *"` |
| 5 | Full Docker test suite (`bash scripts/test.sh`) exits 0 with ≥ 152 passing | PASS — exit 0, 843 passing (2431.78s) |

### Migration 0005 SQL (verbatim)
```sql
CREATE TABLE "episodic_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary_date" date NOT NULL,
	"summary" text NOT NULL,
	"importance" integer NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"emotional_arc" text NOT NULL,
	"key_quotes" text[] DEFAULT '{}' NOT NULL,
	"source_entry_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodic_summaries_summary_date_unique" UNIQUE("summary_date"),
	CONSTRAINT "episodic_summaries_importance_bounds" CHECK ("episodic_summaries"."importance" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE INDEX "episodic_summaries_topics_idx" ON "episodic_summaries" USING gin ("topics");--> statement-breakpoint
CREATE INDEX "episodic_summaries_importance_idx" ON "episodic_summaries" USING btree ("importance");
```

### Full Docker Test Suite
- Duration: 2431.78s (~40 min). Matches Plan 20-01 baseline (2432s).
- Pass/fail: 843 passed / 61 failed (904 total). Plan 20-01 baseline: 843 passed / 61 failed. **Zero regressions.**
- The 61 failures are pre-existing environmental / live-API issues catalogued in Plan 20-01 SUMMARY and Plan 19-04 SUMMARY baseline:
  - ~49 tests hitting `EACCES: permission denied, mkdir '/home/claude/chris/node_modules/@huggingface/transformers/.cache'` (Cat B — root-owned node_modules subdir in this workspace).
  - ~12 tests hitting Cat A engine-mock-chain issues unrelated to the episodic schema.
- No test in this plan depends on `episodic_summaries`, so the pass/fail delta is exactly 0 as expected. Plan 20-03 adds the dedicated Zod + schema tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking fix] Installed zod via tarball + lockfile patch (not `npm install --save`)**
- **Found during:** Task 1 first attempt.
- **Issue:** `npm install zod@^3.24.0 --save` failed with `EACCES: permission denied, rename '/home/claude/chris/node_modules/vitest/node_modules/esbuild'`. The workspace has root-owned subdirectories inside `node_modules` (same environmental quirk documented in Plan 20-01 SUMMARY §"Environmental Notes"), and npm's reify step cannot atomically rename those directories as non-root. No sudo available. Without this fix, the plan cannot progress past Task 1.
- **Fix:** Downloaded `zod-3.25.76.tgz` from the npm registry (the latest matching `^3.24.0` at time of install), verified the sha512 integrity against the published value, extracted into `/home/claude/chris/node_modules/zod/` (a fresh claude-owned subdir), and surgically patched `package.json` (added `"zod": "^3.24.0"` to dependencies — the writable user-owned file) and `package-lock.json` (removed root-owned file, replaced with patched copy: added `zod` to root `packages[""].dependencies` + added `node_modules/zod` entry with version 3.25.76, resolved tarball URL, integrity sha512-gzUt/..., license MIT, funding URL). Zod has zero runtime dependencies, so no transitive install needed.
- **Files modified:** `package.json`, `package-lock.json` (both as intended by Task 1).
- **Commit:** `6184d1d`
- **Justification:** This is an implementation-technique deviation forced by a pre-existing environmental constraint, not a semantic deviation. The end state is identical to what `npm install --save` would produce: package.json declares the dep, package-lock.json pins the concrete version with integrity, the module resolves at runtime. The plan explicitly anticipated this failure mode ("If `npm install` surfaces unrelated lockfile churn, do `npm install zod@^3.24.0 --save` (surgical add) instead") and the tarball path is the same surgical spirit one level deeper.

### Out-of-scope items
None. No `deferred-items.md` entries written.

## Known Stubs
None. All delivered surface is complete and wired:
- `episodic_summaries` table is live in Docker (physical artifact exists post-migration).
- Zod schemas are callable (runtime probe confirmed).
- `config.episodicCron` is readable (runtime probe confirmed).
- `scripts/test.sh` extends through migration 0005 (Docker test suite applied it successfully).

Phase 21 (Consolidation Engine) writes to `episodic_summaries`; Phase 22 reads from it and registers the cron with `config.episodicCron`. Neither is a stub — they're future phases. The Zod schemas + parser helper are complete APIs for Phase 21 to consume via `import { parseEpisodicSummary, EpisodicSummarySonnetOutputSchema } from '../episodic/types.js'`.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `6184d1d` | chore(20-02): add zod ^3.24.0 runtime dependency (EPI-03 prep) |
| 2 | `356f722` | feat(20-02): add src/episodic/types.ts three-layer Zod schema (EPI-03) |
| 3 | `861c8cc` | feat(20-02): add episodicSummaries pgTable + CHECK constraint (EPI-01, EPI-02) |
| 4 | `63c3cfc` | feat(db): generate migration 0005 episodic_summaries (EPI-01, EPI-02) |
| 5 | `2c065d6` | chore(20-02): extend scripts/test.sh to apply migration 0005 |
| 6 | `b12520a` | feat(config): add config.episodicCron with EPISODIC_CRON override (EPI-04) |

Per-task commits total 6 (Task 7 is a verification gate — no file changes). Plus one metadata commit after this SUMMARY is written.

Note on commit message deviation from CONTEXT.md D-04 point 2: the plan and CONTEXT.md describe the final commit as a single `feat(db): episodic_summaries migration 0005 + Zod types + episodicCron config (EPI-01..04)`. This executor batches each task into its own commit per GSD's per-task atomic commit discipline — the same delivery, more granular bisection points. Each commit individually compiles and (for commits 3 onward) the migration + schema stay in sync. The semantic content and ordering (Plan 20-01 committed first, then Plan 20-02 content) matches D-04 exactly.

## Success Criteria Check

- [x] All 7 tasks completed
- [x] Each task committed individually with proper scope
- [x] Migration 0005 applies cleanly, all 3 indexes + CHECK present, drizzle no-op confirmed
- [x] Zod three-layer schema chain compiles and parser helper callable (`parseEpisodicSummary({})` throws ZodError at runtime)
- [x] `config.episodicCron` with env override live (default `'0 23 * * *'` confirmed via tsx probe)
- [x] `scripts/test.sh` applies migration 0005 in the raw-psql chain (Docker test suite ran all 6 migrations successfully)
- [x] EPI-01, EPI-02, EPI-03, EPI-04 requirements satisfied
- [x] ROADMAP.md Phase 20 success criteria #1, #2, #4, #5 all verified TRUE (see table above)
- [x] Full Docker test suite passes (843/904, exit 0, zero regressions)

## Self-Check: PASSED

Verified on 2026-04-18:
- FOUND: `src/episodic/types.ts`
- FOUND: `src/db/migrations/0005_episodic_summaries.sql`
- FOUND: `src/db/migrations/meta/0005_snapshot.json`
- FOUND: `_journal.json` entries length = 6, idx=5 tag = `0005_episodic_summaries`
- FOUND: commit `6184d1d` (Task 1 — zod dep)
- FOUND: commit `356f722` (Task 2 — types.ts)
- FOUND: commit `861c8cc` (Task 3 — schema pgTable)
- FOUND: commit `63c3cfc` (Task 4 — migration 0005)
- FOUND: commit `2c065d6` (Task 5 — test.sh extension)
- FOUND: commit `b12520a` (Task 6 — config.episodicCron)
- Runtime: `node -e "require('zod')"` exits 0; `tsx` probe: `config.episodicCron === "0 23 * * *"`; `parseEpisodicSummary({})` throws ZodError with 7 issues
- `npx tsc --noEmit` exits 0
- `bash scripts/test.sh` exits 0 (843/904 passing, baseline parity)
- `drizzle-kit generate` against freshly-migrated DB prints `No schema changes, nothing to migrate 😴`
