# Phase 20: Schema + Tech Debt — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Lay down the M008 episodic consolidation database primitives on a clean migration lineage. Delivers:

- **TD-01:** TECH-DEBT-19-01 resolved — drizzle-kit `meta/0001_snapshot.json` and `meta/0003_snapshot.json` regenerated so migration 0005 writes onto a clean chain. `drizzle-kit generate` returns "No schema changes" after resolution.
- **EPI-01:** `episodic_summaries` table created via migration 0005 with the 8-column schema specified in REQUIREMENTS.md (id uuid pk, summary_date date NOT NULL, summary text NOT NULL, importance integer NOT NULL CHECK 1–10, topics text[] NOT NULL default '{}', emotional_arc text NOT NULL, key_quotes text[] NOT NULL default '{}', source_entry_ids uuid[] NOT NULL default '{}', created_at timestamptz NOT NULL default now()).
- **EPI-02:** All three indexes ship in the initial migration 0005 — `UNIQUE(summary_date)`, `GIN(topics)`, `btree(importance)`. Non-retrofitted.
- **EPI-03:** Three-layer Zod schema in `src/episodic/types.ts` exported with parser helpers.
- **EPI-04:** `config.episodicCron` field with default `"0 23 * * *"` and `EPISODIC_CRON` env override.

**Out of scope (belongs to later M008 phases):** `runConsolidate()` function body, M006 preamble injection, importance rubric prompt, cron registration in `src/index.ts`, retrieval routing, `/summary` command, backfill script, 14-day synthetic fixture, live anti-flattery test. Phase 20 is schema + types + config only; the engine is Phase 21.

</domain>

<decisions>
## Implementation Decisions

### TD-01: Snapshot Regeneration Procedure

- **D-01 (Technique):** **Clean-slate iterative replay** on a throwaway Docker Postgres volume and a dedicated throwaway git branch.
  - Procedure: delete `meta/0002_snapshot.json`, `meta/0004_snapshot.json`, `meta/_journal.json` in the throwaway workspace → apply only `0000_curved_colonel_america.sql` → run `drizzle-kit generate` (temporarily omitting 0001's schema additions to force drizzle-kit to emit 0001 as a snapshot against the 0000 baseline — planner refines the exact recipe) → rename output to `0001_snapshot.json` → repeat for 0003 using the 0000+0001+0002 applied state as baseline → re-emit `_journal.json` referencing the five migrations in order → copy the regenerated files back to the main branch.
  - Rationale: prior Plan 19-04 Option A (`drizzle-kit generate` against fully-migrated Docker) returned "No schema changes, nothing to migrate" — drizzle-kit does not backfill meta for already-applied entries. Clean-slate replay is the only path that produces byte-accurate snapshots. Higher-cost, high-confidence.
- **D-02 (Isolation):** All regeneration work happens on a **dedicated throwaway git branch AND a fresh Docker container on a new Postgres volume**. Zero risk of contaminating production-path files or main-branch drizzle state. Script documents the exact sequence; if it fails mid-way, the branch and container are both disposable.
- **D-03 (Acceptance proof):** **`drizzle-kit generate` = no-op** is the verification. After the regenerated snapshots land and the full migration chain (0000→0004) is applied to a fresh Docker Postgres with `schema.ts` *as-is* (no new additions), `drizzle-kit generate` must print "No schema changes, nothing to migrate". This is Phase 20 Success Criterion #1 verbatim; if anything appears in the diff, the regen is wrong and must be redone.
- **D-04 (Commit split):** **Two separate commits in this order:**
  1. `fix(db): regenerate drizzle-kit snapshots for migrations 0001 and 0003 (TD-01)` — snapshots only, zero schema change, drizzle-kit generate no-op.
  2. `feat(db): episodic_summaries migration 0005 + Zod types + episodicCron config (EPI-01..04)` — the actual Phase 20 schema delivery.
  - Makes TD-01 independently revertable and keeps phase bisection clean.
- **D-05 (Rollback):** If D-03 fails or a downstream regression surfaces tied to the regenerated snapshots, **`git revert` the TD-01 commit in isolation** (thanks to D-04 split), leaving migration 0005 intact if it was already committed. If migration 0005 also fails, revert both and escalate to a different snapshot strategy (e.g. hand-author, or re-defer to M009 per Plan 19-04 precedent). Under no circumstances merge to main until D-03 passes.

### EPI-01 + EPI-02: Migration 0005 Authoring

- **D-06 (Generator):** **Migration 0005 authored via `drizzle-kit generate`**, not hand-written. Add the `episodicSummaries` `pgTable` definition to `src/db/schema.ts`, run `drizzle-kit generate`, commit the emitted `0005_*.sql` + `meta/0005_snapshot.json` + updated `_journal.json`. Matches D016 (Drizzle auto-migrate-on-startup).
- **D-07 (DB-level CHECK constraint):** **Ship `CHECK (importance BETWEEN 1 AND 10)` in migration 0005** (belt-and-suspenders). Rationale for deviating from Phase 13's "defer CHECKs to the write-phase" rule: Phase 21 writes importance, but operator paths (backfill script — OPS-01 in Phase 23, direct SQL debugging, etc.) also write importance. DB-level CHECK is the only defense against all non-Drizzle paths. Cheap, deterministic, impossible to forget later.
- **D-08 (Other DB-level constraints):** **None beyond EPI-01/02 spec** — NOT NULL on all non-id/non-created_at fields, UNIQUE(summary_date), GIN(topics), btree(importance), and the importance CHECK from D-07. No `array_length(source_entry_ids) > 0` CHECK (CONS-02 skips insert for zero-entry days, so redundant). No summary length CHECK (Zod enforces).
- **D-09 (Column types):** Match REQUIREMENTS.md EPI-01 exactly:
  - `summary_date DATE NOT NULL` — `date` type, no timezone (day boundary already computed in `config.proactiveTimezone` before insert; this is a calendar date, not an instant)
  - `summary TEXT NOT NULL`
  - `importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10)`
  - `topics TEXT[] NOT NULL DEFAULT '{}'`
  - `emotional_arc TEXT NOT NULL`
  - `key_quotes TEXT[] NOT NULL DEFAULT '{}'`
  - `source_entry_ids UUID[] NOT NULL DEFAULT '{}'` (no FK constraint possible on array elements — accepted soft-integrity boundary; CONS-01 inserts real entry IDs, backfill script verifies they exist as pre-insert sanity)
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- **D-10 (Index names):** Follow drizzle-kit's default naming. Don't fight the tool. Expected names: `episodic_summaries_summary_date_unique` (unique), `episodic_summaries_topics_idx` (GIN), `episodic_summaries_importance_idx` (btree). Planner confirms exact names after drizzle-kit generates.

### EPI-03: Zod Schema Shape

- **D-11 (Three-layer schema):** **`src/episodic/types.ts` exports three Zod schemas forming an inheritance chain:**
  1. `EpisodicSummarySonnetOutputSchema` — strictest, used with `messages.parse()` via `zodOutputFormat()` in Phase 21's `runConsolidate`. Fields: `summary`, `importance`, `topics`, `emotional_arc`, `key_quotes` only (Sonnet doesn't pick `summary_date` or `source_entry_ids` — those are set by the engine).
  2. `EpisodicSummaryInsertSchema` — extends (1) with `summary_date: z.date()` and `source_entry_ids: z.array(z.string().uuid())` supplied by the engine. Used for `parseEpisodicSummary()` before Drizzle insert.
  3. `EpisodicSummarySchema` — extends (2) with `id: z.string().uuid()` and `created_at: z.date()`. Used for reads from the DB (RETR-01 / Phase 22).
- **D-12 (Strictness — "fail loud"):**
  - `importance: z.number().int().min(1).max(10)` — hard bounds match D-07 DB CHECK.
  - `summary: z.string().min(50)` — minimum length to catch trivially-empty summaries.
  - `topics: z.array(z.string().min(1)).min(1).max(10)` — must have at least one topic, max 10 to prevent topic-explosion hallucination.
  - `key_quotes: z.array(z.string().min(1)).max(10)` — can be empty (CONS-11 sparse-entry case); if present, each must be non-empty. **Note:** Phase 21's prompt enforces verbatim-substring; the runtime verbatim assertion is Phase 21/23 work (TEST-20, CONS-10 prompt clause), NOT Zod.
  - `emotional_arc: z.string().min(1)`
  - `summary_date: z.date()` (Phase 21 converts from timezone-aware ISO string to Date at engine boundary)
  - `source_entry_ids: z.array(z.string().uuid())` — can be empty only if CONS-02 passed entry-count gate with exactly zero entries (but then no insert runs at all), so in practice always length > 0.
- **D-13 (Export surface):** Export from `src/episodic/types.ts`:
  - `EpisodicSummarySonnetOutputSchema`, `EpisodicSummaryInsertSchema`, `EpisodicSummarySchema` (Zod const refs — needed by `messages.parse()` and Drizzle).
  - `EpisodicSummarySonnetOutput`, `EpisodicSummaryInsert`, `EpisodicSummary` (TypeScript types via `z.infer<typeof X>`).
  - `parseEpisodicSummary(input: unknown): EpisodicSummaryInsert` helper that wraps `.parse()` with a clear error prefix (e.g. `EpisodicSummaryValidationError`). Downstream callers import what they need without learning Zod internals.
- **D-14 (Module layout):** **Phase 20 creates `src/episodic/types.ts` and only that.** No `index.ts` barrel, no `consolidate.ts` stub, no `prompts.ts` stub. Phase 21 creates its own files when it writes them. Matches Phase 13's pattern (which added to `src/decisions/` only as files landed, not speculative stubs).

### EPI-04: Config Field

- **D-15 (Config wiring):** Add to `src/config.ts` following the existing `proactiveSweepCron` pattern (line 42–46):
  ```ts
  episodicCron: process.env.EPISODIC_CRON || '0 23 * * *',
  ```
  Placed in the "Proactive messaging" block (or a new "Episodic" block — planner's call). Type-checked via `as const` already present on the exported `config` object.
- **D-16 (No runtime test for EPI-04):** TS compile-only. The `npx tsc --noEmit` 0-errors check on the Docker gate is the test. Matches how `proactiveSweepCron` was added in v1.0 (no dedicated test). Success criterion #4 says "type-checked, no TypeScript errors" — that's the bar.
- **D-17 (Documentation):** Inline comment above the field documenting the default and purpose:
  ```ts
  // Episodic consolidation cron — fires at 23:00 in config.proactiveTimezone by default.
  episodicCron: process.env.EPISODIC_CRON || '0 23 * * *',
  ```

### Test Coverage for Phase 20

- **D-18 (Test floor +3 to +5 tests):** Phase 20 raises the Docker gate floor from 152 by a small, phase-appropriate amount. Ship:
  - **Zod unit tests** (`src/episodic/__tests__/types.test.ts`): valid Sonnet output parses; invalid importance (0, 11, "high") throws; empty topics array throws; missing required field throws; `parseEpisodicSummary` returns typed `EpisodicSummaryInsert`.
  - **Schema integration test** (`src/episodic/__tests__/schema.test.ts`): Docker Postgres test.
    - Insert one valid row → returns id + created_at.
    - Insert second row with same `summary_date` → throws unique-violation.
    - Insert with `importance = 11` → throws CHECK-violation.
    - `SELECT indexname FROM pg_indexes WHERE tablename = 'episodic_summaries'` returns the three expected index names (D-10 format).
- **D-19 (Test location):** `src/episodic/__tests__/` — mirrors `src/decisions/__tests__/` established in v2.1. Phase 21 and later inherit this location.
- **D-20 (Explicit test-gate target):** Phase 20's new tests count is expected to be **~5–8 additional passing tests** (3–5 Zod cases + 3–4 schema integration cases). The Wave-end gate must show test count ≥ 157 passing. This becomes the new floor for Phase 21.

### Claude's Discretion

- Exact naming of the throwaway branch for TD-01 regeneration work (e.g. `tech-debt/td-01-snapshot-regen`).
- Whether the drizzle-kit snapshot regeneration script is captured as `scripts/regen-snapshots.sh` (resumable, documented) or executed ad-hoc with the recipe in the phase SUMMARY (one-time, not reusable).
- Drizzle `pgTable` column ordering in `schema.ts` — planner follows existing convention (id, domain fields, audit timestamps).
- Exact file/test names and internal function naming beyond what's specified above.
- Whether to wrap `parseEpisodicSummary` error in a new `EpisodicSummaryValidationError` class or just surface `ZodError` directly (prefer: surface `ZodError.format()` for Phase 21 `notifyError()` readability — CONS-12).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §"Pre-Work / Tech Debt" (TD-01) and §"Schema & Storage" (EPI-01..04) — hard requirements for Phase 20.
- `.planning/ROADMAP.md` §"Phase 20: Schema + Tech Debt" — five success criteria that must be TRUE at phase completion.
- `.planning/STATE.md` §"Known Tech Debt" — TECH-DEBT-19-01 entry with reactivation trigger now ACTIVE.

### Prior Phase Artifacts (load-bearing)
- `.planning/milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md` — Plan 19-04 ran Option A (`drizzle-kit generate` against fully-migrated Docker) and documented that it returned "No schema changes, nothing to migrate". Motivates the clean-slate-replay approach in D-01. **Must read before attempting TD-01.**
- `.planning/milestones/v2.1-phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — establishes the `pgEnum` + `pgTable` + `withTimezone: true` + trailing-callback-indexes conventions Phase 20 must match; also documents the "defer CHECKs to write-phase" rule that Phase 20 intentionally deviates from (D-07 rationale).

### Research (directly applicable)
- `.planning/research/SUMMARY.md` §"Recommended Stack" — Zod 3.24.0 constraint (NOT 4.x; Anthropic SDK `messages.parse()` helpers target Zod 3 API). Anthropic SDK bump `^0.80.0 → ^0.90.0` for `zodOutputFormat()` (Phase 21 dependency; Phase 20 does not need the bump).
- `.planning/research/SUMMARY.md` §"Critical Pitfalls" #5 — TECH-DEBT-19-01 identified as build blocker; no migration 0005 until it's resolved.
- `.planning/research/ARCHITECTURE.md` — `src/episodic/` module pattern mirrors `src/decisions/`.
- `.planning/research/PITFALLS.md` — 17 catalogued pitfalls; Phase 20 is exposed only to #5 (TD-01) and #17 (embedding pollution — RETR-06 enforcement belongs to Phase 22; Phase 20 just establishes the no-summary-in-pensieve-embeddings boundary by making `episodic_summaries` a distinct table).

### Project Decisions (PROJECT.md)
- **D004** — Append-only Pensieve discipline. Phase 20's new table `episodic_summaries` is strictly additive; no mutation of `pensieve_entries`.
- **D016** — Drizzle auto-migrate on startup. Migration 0005 must be auto-apply-safe.
- **D018** — No skipped tests. Docker Postgres gate is mandatory.
- **D019** — Production deployment requires explicit user approval. TD-01 regen and migration 0005 ship to main only after Docker gate green; no Proxmox push in Phase 20.
- **D031** — Structured facts vs interpretation. Phase 20 establishes the architectural seed for RETR-05/RETR-06 (summary text never embedded, never in Known Facts) by making the table distinct from `pensieve_entries` and `pensieve_embeddings`.

### Existing Code Patterns (reuse, do not reinvent)
- `src/db/schema.ts` lines 20–300 — exact `pgEnum`/`pgTable` style Phase 20 must match. `contradictions` table (lines 193–202) is the closest structural template (no FKs to content tables, simple column list, trailing index callback).
- `src/db/migrate.ts` — auto-migration entrypoint (D016). Migration 0005 runs through this path at every startup.
- `src/db/migrations/meta/_journal.json` — current shape (5 entries, version 7). Regen must preserve this schema.
- `src/config.ts` lines 42–46 — `proactiveSweepCron` template for EPI-04.
- `src/decisions/__tests__/` — directory + file-naming convention Phase 20 inherits.
- `scripts/test.sh` — Docker gate entrypoint. Phase 20's final commit runs this and reports ≥ 157 passing.

### Drizzle-Specific
- `drizzle.config.ts` — dialect: `postgresql`, schema: `./src/db/schema.ts`, out: `./src/db/migrations`. Regen must work within this configuration.
- Drizzle snapshots live in `src/db/migrations/meta/` — do NOT hand-edit (D-06 rules this out except in the D-01 replay procedure where the throwaway branch produces them via `drizzle-kit generate`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`pgTable` + trailing-callback index pattern** (schema.ts:210–249 `decisions` table): exact template for `episodic_summaries`. Copy the shape, not the column list.
- **`gen_random_uuid()` primary-key default** (schema.ts:99, 117, 213, 254): standard pattern for `episodic_summaries.id`.
- **`timestamp('created_at', { withTimezone: true }).defaultNow()`** (ubiquitous): use as-is for `created_at`. Note: the `NOT NULL` bit differs — EPI-01 requires NOT NULL, and the existing tables use `.defaultNow()` which is NULL-safe at insert time but doesn't imply `.notNull()`. Add `.notNull()` explicitly.
- **Array types** (pensieveEntries `supporting_entries: uuid('supporting_entries').array()` line 136): precedent for `uuid[]` columns. Phase 20 uses the same pattern for `source_entry_ids`. For `text[]` columns (`topics`, `key_quotes`), use `text('topics').array().notNull().default([])`.
- **`integer().notNull()` + CHECK** — no precedent in current schema.ts (no CHECK constraints anywhere yet). This is a mild deviation from existing style; Drizzle 0.45.2 supports CHECK via the `.check()` method on columns or via a table-level `check()` primitive. Planner confirms Drizzle version support.
- **Zod pattern** — no existing Zod schemas in the codebase. Phase 20 introduces the pattern; Phase 21 and 22 will follow. Follow Anthropic SDK docs for `zodOutputFormat()` (will be a Phase 21 concern; Phase 20 just establishes the schema shape).

### Established Patterns
- **Auto-migration on startup** (src/db/migrate.ts + D016) — migration 0005 runs automatically when the app boots. Migration must be idempotent per Drizzle convention (CREATE TABLE IF NOT EXISTS is drizzle-generated default).
- **Drizzle snapshots live in `src/db/migrations/meta/`** — byte-accuracy matters; drizzle-kit uses them to compute the diff on subsequent generates. A corrupt chain produces spurious diffs (this is exactly TD-01).
- **Docker Postgres is the test target** — per memory + D018. All schema tests run against `docker-compose.test.yml`.
- **`scripts/test.sh`** — current 152-test gate target. Phase 20 must raise this to ≥ 157 passing.

### Integration Points
- `src/db/schema.ts` — add `episodicSummaries` `pgTable` definition (and nothing else in this phase). Don't touch other tables.
- `src/config.ts` — add `episodicCron` field in the config block (near `proactiveSweepCron`, which is the thematic neighbor).
- `src/episodic/types.ts` — new file, new module. First touch of the `src/episodic/` directory.
- `src/episodic/__tests__/types.test.ts` — new file.
- `src/episodic/__tests__/schema.test.ts` — new file, Docker integration.
- `src/db/migrations/0005_*.sql` — drizzle-kit output.
- `src/db/migrations/meta/0001_snapshot.json`, `0003_snapshot.json`, `0005_snapshot.json`, `_journal.json` — regenerated/emitted via the TD-01 procedure and migration 0005 generation respectively.

### Boundaries (do NOT touch in Phase 20)
- `src/pensieve/store.ts` — no consolidation writes (D004). Phase 20 is schema-only.
- `src/proactive/sweep.ts` — not a consolidation channel. Phase 22 does cron wiring, not this phase.
- `src/chris/engine.ts` — no new mode. RETR-04 INTERROGATE injection is Phase 22.
- `src/decisions/`, `src/pensieve/known-facts.ts`, `src/chris/modes/*` — not touched.
- Any code outside `src/episodic/`, `src/db/schema.ts`, `src/config.ts`, and `src/db/migrations/` — out of bounds for Phase 20.

</code_context>

<specifics>
## Specific Ideas

- **Plan 19-04 Option A is documented as failing.** The STATE.md resolution hint ("run `drizzle-kit generate` against Docker with all migrations applied; drizzle-kit will implicitly regenerate") is wrong — the 19-04 SUMMARY (§"Accomplishments" bullet 3) records the actual observed behavior: "No schema changes, nothing to migrate". Planner must not rely on STATE.md's hint; follow D-01 clean-slate-replay instead, and update STATE.md's note as part of the TD-01 commit.
- **Clean-slate-replay is expensive but load-bearing.** The procedure in D-01 may take one to two hours of iteration to get right. Budget for this in the Phase 20 plan estimate. If the first iteration fails, the throwaway branch + container make retries cheap.
- **`drizzle-kit generate = no-op` is the acceptance gate.** Any other success proxy (file counts, snapshot byte size, visual inspection) is not sufficient. If the command shows any diff, the regen failed — redo it.
- **Three-layer Zod schema is Phase 21 infrastructure paid for in Phase 20.** `EpisodicSummarySonnetOutputSchema` is used by `messages.parse()` in `runConsolidate` (Phase 21); `EpisodicSummarySchema` is used by `getEpisodicSummary` (Phase 22). Phase 20 lands them all so downstream phases don't migrate the type shape.
- **DB-level `CHECK (importance BETWEEN 1 AND 10)` is a deliberate deviation from Phase 13's defer-CHECKs-to-write-phase rule.** Rationale: operator paths (OPS-01 backfill script, direct psql for debugging, potential future `/resummary`) write importance too, not just the Phase 21 engine. DB-level CHECK is the only defense that covers all write paths. The rule isn't broken — it's applied with the actual write-path surface in mind.
- **`source_entry_ids uuid[]` accepts a soft-integrity boundary.** Postgres cannot FK on array elements. CONS-01 must insert real, existing Pensieve entry IDs; OPS-01 backfill must verify existence as a pre-insert sanity check. Phase 20 does not enforce this at the DB level — it's a Phase 21/23 runtime concern.

</specifics>

<deferred>
## Deferred Ideas

- **Migration 0005 custom naming** (`0005_episodic_summaries.sql` vs drizzle-kit's auto-suffix). Accept drizzle-kit's output; renaming invites manual drift between file name and journal.
- **`array_length(source_entry_ids, 1) > 0` CHECK** — redundant with CONS-02 (zero-entry gate skips insert entirely). Adding it would add no real protection.
- **`length(summary) >= 50` CHECK at DB level** — Zod's `min(50)` handles it before insert. DB-level would cover only direct psql inserts, which aren't a real risk surface here.
- **Stub files for Phase 21 (`consolidate.ts`, `prompts.ts`)** — rejected: speculative, invites dead-code comments, Phase 21 creates them cleanly when it writes them.
- **Migration rollback (down.sql)** — codebase doesn't use migration rollbacks (D016 auto-migrate-forward only). Out of scope.
- **`EpisodicSummaryValidationError` custom error class** — deferred to Claude's discretion; surfacing `ZodError.format()` via `notifyError()` (Phase 21's CONS-12) may be sufficient.
- **`episodic_embeddings` table (EPI-FUTURE-02)** — rejected for M008 per REQUIREMENTS.md Out of Scope table. Lands in M010 if profile inference needs it.
- **Versioned summaries / auto-replace on re-run (EPI-FUTURE-01)** — rejected for M008; `/resummary` command is EPI-FUTURE-01, not in M008 scope.

</deferred>

---

*Phase: 20-schema-tech-debt*
*Context gathered: 2026-04-18*
