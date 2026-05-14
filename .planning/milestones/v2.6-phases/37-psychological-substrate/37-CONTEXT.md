# Phase 37: Psychological Substrate - Context

**Gathered:** 2026-05-13 (via `/gsd-discuss-phase 37 --auto`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 37 ships the **persistence + read substrate + boundary defenses** for M011 psychological profiles. After this phase:

- Migration 0013 has applied cleanly to a fresh Docker Postgres: three new tables exist (`profile_hexaco`, `profile_schwartz`, `profile_attachment`) with the full Never-Retrofit Checklist on each
- Each profile table has a single sentinel row (`name = 'primary'`) inserted at migration time with all dimensions `NULL`, `overall_confidence = 0`, `word_count = 0`, `word_count_at_last_run = 0`, `substrate_hash = ''`
- `src/db/schema.ts` exports `profileHexaco`, `profileSchwartz`, `profileAttachment` Drizzle tables with `.$type<T>()` jsonb inference
- `src/memory/profiles/psychological-schemas.ts` exports Zod v3 + v4 dual schemas for all three profile shapes
- `src/memory/profiles/psychological-shared.ts` exports `loadPsychologicalSubstrate(profileType, now)` — strict `source='telegram'` + `epistemic_tag != 'RITUAL_RESPONSE'` filter, calendar-month boundary (Luxon DST-safe), 5,000-word floor enforced BEFORE Sonnet call
- `src/memory/confidence.ts` adds `MIN_SPEECH_WORDS = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`, `isAboveWordThreshold()` — alongside existing M010 helpers
- `src/memory/profiles.ts` exports `getPsychologicalProfiles()` returning `{ hexaco, schwartz, attachment }` typed structured object with never-throw + 3-layer Zod v3 parse defense
- `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` enforces D047 boundary in both directions (no operational vocabulary in psychological files; no psychological vocabulary in operational files)

**Explicitly NOT in this phase** (Phases 38–40):
- Sonnet generators (HEXACO, Schwartz) — Phase 38
- `assemblePsychologicalProfilePrompt` shared builder — Phase 38
- Monthly cron registration — Phase 38
- Injection map + formatter for system prompt — Phase 39
- `/profile` Telegram command extension — Phase 39
- Synthetic fixtures + live milestone gate — Phase 40

**Inter-phase coupling:** Zero downstream behavioral dependency. Phase 39 surfaces can wire against `getPsychologicalProfiles()` as soon as Phase 37 ships — rows return seeded cold-start data (`overall_confidence = 0`, all dims null), and Phase 39's formatter must already handle the zero-confidence / below-threshold cases per PSURF-02.

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M011 research pass (STACK + FEATURES + ARCHITECTURE + PITFALLS, synthesized in SUMMARY.md) and REQUIREMENTS.md PSCH-01..10. The `--auto` flag locked each at the recommended option. The planner should treat them as the contract surface and validate via the Phase 37 success criteria in ROADMAP.md.

### Migration shape (PSCH-01)

- **D-01: Migration 0013 is hand-authored SQL.** Drizzle-kit generates DDL from `src/db/schema.ts`; the hand-authored migration appends the seed-row `INSERT` statements (drizzle-kit cannot model seed inserts). Same pattern as v2.4 migrations 0006-0011 and the v2.5 M010 migration 0012. Naming: `src/db/migrations/0013_psychological_profiles.sql`.
- **D-02: Three tables in one migration.** `profile_hexaco`, `profile_schwartz`, `profile_attachment` ship together in 0013. Single migration = single drizzle meta snapshot regeneration = single `scripts/test.sh` psql line update. Splitting into multiple migrations adds lineage complexity for no semantic benefit (mirrors M010 D-02 + HARD CO-LOC #M10-1).
- **D-03: HARD CO-LOC #M11-1 atomic plan.** Migration SQL + `src/db/schema.ts` table definitions (three new exports after `profileFamily` line 636, before `profileHistory` line 646) + `src/db/migrations/meta/0013_snapshot.json` + `_journal.json` entry + `scripts/test.sh` psql apply line for 0013 + `scripts/regen-snapshots.sh` cleanup-flag bump (`0012*.json` → `0013*.json`) + `src/memory/profiles/psychological-schemas.ts` Zod type exports all ship in ONE plan. Splitting any of these reproduces the M010 PITFALL M010-11 lineage break.
- **D-04: profile_history reused unchanged.** No ALTER TABLE on `profile_history`. The existing `profile_table_name text NOT NULL` discriminator already accommodates new values `'profile_hexaco'` / `'profile_schwartz'` / `'profile_attachment'` by design (per ARCHITECTURE §2). Phase 38 generators write history rows using this freeform discriminator.

### Profile table schema (per-table — applies to all 3)

- **D-05: Sentinel-row pattern.** Every profile table has `name text NOT NULL UNIQUE DEFAULT 'primary'`. Single row per table by application convention; the `name` column is the `ON CONFLICT (name) DO UPDATE` target for Phase 38's monthly upsert. Mirrors M010 D-04.
- **D-06: Never-Retrofit Checklist columns (locked from PROJECT.md D042 + REQUIREMENTS PSCH-01):**
  - `schema_version int NOT NULL DEFAULT 1`
  - `substrate_hash text NOT NULL DEFAULT ''`
  - `name text NOT NULL UNIQUE DEFAULT 'primary'`
  - `overall_confidence real NOT NULL DEFAULT 0 CHECK (overall_confidence >= 0 AND overall_confidence <= 1)`
  - `word_count integer NOT NULL DEFAULT 0`
  - `word_count_at_last_run integer NOT NULL DEFAULT 0`
  - `last_updated timestamptz` (nullable — null = "never run"; non-null after first generator fire)
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **D-07: profile_attachment additional non-retrofittable columns:** `relational_word_count int NOT NULL DEFAULT 0`, `activated boolean NOT NULL DEFAULT false`. Both must ship in 0013 per REQUIREMENTS PSCH-04 + ARCHITECTURE §1 — the D028 activation sweep (post-M011) has no column to flip if `activated` is added later.
- **D-08: Dimension jsonb columns default to `NULL`.** Distinct from M010's `'[]'` / `'{}'` defaults: psychological dimensions have a meaningful "never inferred" state (cold-start → `null`) that should round-trip through Zod v3 reader as a literal `null` value, not as an empty object. Confirmed by REQUIREMENTS PSCH-02 ("all dims null" at cold start).

### Per-dimension jsonb shape (PSCH-02, PSCH-03, PSCH-04)

- **D-09: Unified per-dim shape across all three profile types:** `{ score: number, confidence: number, last_updated: string (ISO timestamp) }`. Score range:
  - HEXACO: 1.0–5.0 (academic standard — IPIP-HEXACO 60-item scale)
  - Schwartz: 1.0–5.0 (normalized for visual consistency in `/profile` display + simpler Zod schema reuse; academic Schwartz importance scale is -1 to 7 but downstream Sonnet output and display are easier with a unified 1.0–5.0 range per ARCHITECTURE §1)
  - Attachment: 1.0–5.0 (consistent with HEXACO/Schwartz; population deferred to D028 activation gate)
- **D-10: Zod schemas enforce score range per profile type.** Per-profile-type Zod v3+v4 schemas in `psychological-schemas.ts` clamp `score` to `[1.0, 5.0]` for all three. `confidence` always `[0.0, 1.0]`. `last_updated` is an ISO 8601 string (Zod v3 `z.string().datetime()`).
- **D-11: `evidence_count` field deferred.** ARCHITECTURE §1 proposed `{score, confidence, evidence_count}`. REQUIREMENTS PSCH-02 locked `{score, confidence, last_updated}`. The `evidence_count` use case (inter-period consistency tracking without history) is subsumed by the `profile_history` row written before each upsert + the `prevHistorySnapshot` field threaded to Sonnet per PGEN-07. Lock REQUIREMENTS shape; do NOT add `evidence_count`.

### Cold-start seed rows (PSCH-05)

- **D-12: One seed row per table at migration time, all dims `NULL`.** Insert pattern (psql-friendly):
  ```sql
  INSERT INTO profile_hexaco (name, schema_version, substrate_hash, overall_confidence, word_count, word_count_at_last_run)
  VALUES ('primary', 1, '', 0, 0, 0);
  ```
  Per-dim columns default to `NULL` per D-08. No `last_updated` value (null until first generator fire).
- **D-13: Seed `substrate_hash = ''` (empty string, not NULL).** First generator fire computes a real SHA-256; comparison to `''` always evaluates as "changed" → triggers the first generation pipeline. Mirrors M010 D-11. Note: psychological generators do NOT short-circuit on matching hash per PGEN-06 (unconditional monthly fire), but the empty-string seed value is still required for audit-trail consistency on first fire.
- **D-14: `profile_attachment` seed includes `activated = false` and `relational_word_count = 0`.** Population sweep (post-M011) flips `activated = true` when `relational_word_count >= 2000` over a 60-day window per D028. The seed value `false` is the initial state.

### Substrate loader (PSCH-07, PSCH-08)

- **D-15: File location: `src/memory/profiles/psychological-shared.ts`.** Per REQUIREMENTS PSCH-07 verbatim. Sibling file to existing `src/memory/profiles/shared.ts` (M010 operational substrate loader). Both files live in `src/memory/profiles/` to keep schema + Zod + substrate loaders co-located by domain (per Phase 33 D-14 reasoning). Note: SUMMARY.md suggested `src/memory/psychological-profiles/shared.ts` but REQUIREMENTS wins.
- **D-16: Function signature and return type — discriminated union for type-safe never-fire guards:**
  ```typescript
  type PsychologicalProfileType = 'hexaco' | 'schwartz' | 'attachment';

  type PsychologicalSubstrate<T> =
    | { belowThreshold: true; wordCount: number; neededWords: number }
    | {
        belowThreshold: false;
        corpus: PensieveEntry[];          // source='telegram' AND epistemic_tag != 'RITUAL_RESPONSE'
        episodicSummaries: EpisodicSummary[];  // previous calendar month, scoped per Luxon DST-safe boundary
        wordCount: number;
        prevHistorySnapshot: T | null;     // last profile_history row for this profileType
      };

  export async function loadPsychologicalSubstrate<T = unknown>(
    profileType: PsychologicalProfileType,
    now: Date = new Date(),
  ): Promise<PsychologicalSubstrate<T>>;
  ```
  Discriminated union forces downstream generators (Phase 38) to handle the below-threshold branch explicitly — TypeScript narrows after the `if (substrate.belowThreshold)` guard. Mirrors M009 ritual return-shape pattern.
- **D-17: Source filter and exclusion list (locked):**
  - INCLUDE: `pensieve_entries WHERE source = 'telegram' AND (epistemic_tag IS NULL OR epistemic_tag != 'RITUAL_RESPONSE')`
  - EXCLUDE (provably absent from corpus): `source IN ('gmail', 'immich', 'drive')`, any `epistemic_tag = 'RITUAL_RESPONSE'` row
  - Episodic summaries: always included (any source); they ground the corpus temporally but do NOT count toward `wordCount`
  - Calendar-month boundary: `DateTime.fromJSDate(now, { zone: 'Europe/Paris' }).startOf('month').minus({ months: 1 })` → start of previous calendar month; `.endOf('month')` → end. Luxon handles DST transitions correctly.
- **D-18: Word counting strategy (locked from REQUIREMENTS PSCH-08 + SUMMARY):**
  ```typescript
  const wordCount = corpus
    .map(entry => entry.content.trim().split(/\s+/).filter(s => s.length > 0).length)
    .reduce((sum, n) => sum + n, 0);
  ```
  Accurate to ±2% on EN/FR/RU at 5,000-word scale per SUMMARY. Explicitly NOT `messages.countTokens` (token inflation 1.5–2.5× in Russian biases the floor against Cyrillic substrates). Inline computation; no `words-count` npm dependency.
- **D-19: Word-count gate fires BEFORE Sonnet call (PITFALL §2 mitigation).** The substrate loader returns `belowThreshold: true` when `wordCount < MIN_SPEECH_WORDS (5000)`. The Phase 38 orchestrator early-returns `'skipped_below_threshold'` without invoking Sonnet. The 5,000-word check is the cheaper gate and must fire first.
- **D-20: `word_count_at_last_run` persisted on every fire**, including below-threshold fires. Phase 38 orchestrator writes this column even when no Sonnet call happens — it enables the `/profile` "need N more words" display (PSURF-04) without re-querying corpus.

### Reader API (PSCH-09)

- **D-21: `getPsychologicalProfiles()` exported from `src/memory/profiles.ts`.** Added AFTER `getOperationalProfiles()`. Does NOT extend the operational reader's return type (8+ existing call sites; ARCHITECTURE §5). Return shape:
  ```typescript
  export interface PsychologicalProfiles {
    hexaco: ProfileRow<HexacoProfileData> | null;
    schwartz: ProfileRow<SchwartzProfileData> | null;
    attachment: ProfileRow<AttachmentProfileData> | null;
  }
  export async function getPsychologicalProfiles(): Promise<PsychologicalProfiles>;
  ```
- **D-22: Never-throw contract** (mirrors M010 D-12). On DB error: per-profile null + `logger.warn` with the error message and structured event `chris.psychological.profile.read.error`. Consumer-side null handling: Phase 39 mode handlers omit injection; `/profile` falls back to the insufficient-data branch.
- **D-23: 3-layer Zod v3 parse defense** (mirrors M010 D-13 + PROJECT.md PITFALLS M010-11):
  1. `schema_version > 1` → return null + warn `chris.psychological.profile.read.schema_mismatch`
  2. `schema_version` matches but `safeParse` fails → return null + warn `chris.psychological.profile.read.parse_failed`
  3. Any unexpected throw → return null + warn `chris.psychological.profile.read.unknown_error`
- **D-24: Per-profile schema-version dispatcher** (mirrors M010 `PROFILE_SCHEMAS` pattern at `src/memory/profiles.ts:83`):
  ```typescript
  const PSYCHOLOGICAL_PROFILE_SCHEMAS: Record<PsychologicalProfileType, Record<number, z.ZodTypeAny>> = {
    hexaco: { 1: HexacoProfileSchemaV3 },
    schwartz: { 1: SchwartzProfileSchemaV3 },
    attachment: { 1: AttachmentProfileSchemaV3 },
  };
  ```

### Zod schemas (PSCH-06)

- **D-25: One file for all three profile shapes:** `src/memory/profiles/psychological-schemas.ts`. Sibling to `src/memory/profiles/schemas.ts` (operational). Mirrors Phase 33 D-15 file-consolidation pattern.
- **D-26: Per-profile-type Zod v3 + v4 dual schemas:**
  - `HexacoProfileSchemaV3` + `HexacoProfileSchemaV4` — 6 dimension fields, each `nullable()` of the per-dim shape
  - `SchwartzProfileSchemaV3` + `SchwartzProfileSchemaV4` — 10 value fields, each `nullable()` of the per-dim shape
  - `AttachmentProfileSchemaV3` + `AttachmentProfileSchemaV4` — 3 dimension fields, each `nullable()`; plus `relational_word_count` + `activated` at the row level
  - v3 used by `getPsychologicalProfiles()` reader; v4 used by Phase 38's `zodOutputFormat` at the SDK boundary (per M010 D045 dual-schema discipline)
- **D-27: Shared per-dim shape factory.** A `hexacoSchwartzDimensionSchemaV3 = z.object({ score: z.number().min(1).max(5), confidence: z.number().min(0).max(1), last_updated: z.string().datetime() }).nullable()` helper, reused by HEXACO and Schwartz schemas. Attachment uses an identical-shape but separately-named factory (`attachmentDimensionSchemaV3`) to preserve nominal typing and allow future divergence (e.g., attachment may add `evidence_count` post-D028 activation without affecting HEXACO/Schwartz).
- **D-28: `schema_version` semantics — bump only on BREAKING jsonb shape changes** (renamed field, removed field, changed type). Additive fields keep `schema_version = 1`. Reader returns null + warn for `schema_version > 1` until the consumer migration completes (mirrors M010 D-16).

### Confidence helpers extension (PSCH-08 substrate dependency)

- **D-29: `src/memory/confidence.ts` extended in Phase 37**, not introduced in Phase 38. Mirrors Phase 33 D-19 ("substrate, not inference"). New exports:
  ```typescript
  export const MIN_SPEECH_WORDS = 5000;                  // PSCH-08 floor
  export const RELATIONAL_WORD_COUNT_THRESHOLD = 2000;   // D028 attachment activation
  export function isAboveWordThreshold(wordCount: number): boolean;
  ```
  Existing `MIN_ENTRIES_THRESHOLD = 10`, `SATURATION = 50`, `computeProfileConfidence`, `isAboveThreshold` are unchanged. The two threshold systems (entry-count for operational, word-count for psychological) are independent and do NOT compose into a single helper.
- **D-30: `wordSaturation` constant NOT introduced in Phase 37.** Research SUMMARY.md flags "lock to 20,000 for Phase 37 planning; flag for calibration after 4–8 months of real M011 operation." Phase 37 ships only `MIN_SPEECH_WORDS` (the floor). A `WORD_SATURATION = 20000` constant for confidence-curve calibration belongs in Phase 38 alongside the generator's confidence computation (if used at all — PGEN-07 has Sonnet self-report `data_consistency`, so host-side word-saturation math may not be needed).

### Boundary audit test (PSCH-10)

- **D-31: Test file location:** `src/memory/profiles/__tests__/psych-boundary-audit.test.ts`. Sibling to existing `src/memory/profiles/__tests__/` tests. Naming mirrors M008 `boundary-audit.test.ts` and M010 boundary-audit patterns.
- **D-32: Two-directional regex sweep (locked from REQUIREMENTS PSCH-10):**
  - FAIL if `\b(jurisdictional|capital|health|family)\b` appears in any file matching `src/memory/profiles/psychological-*.ts` or `src/memory/profiles/__tests__/psychological-*.test.ts` (and the matching path under any `src/memory/psychological-*` if those paths emerge)
  - FAIL if `\b(hexaco|schwartz|attachment)\b` appears in operational profile files: `src/memory/profile-prompt.ts`, `src/memory/profile-updater.ts`, `src/memory/profiles/{shared,schemas,jurisdictional,capital,health,family}.ts`
  - Word-boundary `\b` prevents false positives on substrings (e.g., `attachment_url` in an unrelated context — though that string isn't expected to appear in operational files anyway)
- **D-33: Test runs in standard vitest unit suite.** No special harness; uses `fs.readFileSync` + regex against the file contents, no AST parsing required. Fast (<1s).
- **D-34: Allowlist exception — the audit test itself.** The test file contains the forbidden tokens by necessity. The test glob explicitly excludes `__tests__/psych-boundary-audit.test.ts` from its own input set. Mirrors M008 boundary-audit pattern.

### Migration mechanics + tooling alignment

- **D-35: `scripts/test.sh` psql apply line** — append a line for 0013 immediately after the existing 0012 line at `scripts/test.sh:65-80` (per Phase 33 D-03 precedent). Sequential apply order is mandatory.
- **D-36: `scripts/regen-snapshots.sh` cleanup-flag bump** — update `REGEN_PRODUCED_ACCEPTANCE` reference from `0012*.json` to `0013*.json`. The existing acceptance-gate cleanup pattern catches stale snapshot artifacts on regeneration.
- **D-37: `scripts/validate-journal-monotonic.ts`** (Phase 32 #3 guardrail) — runs before migrations apply in `scripts/test.sh`. The new 0013 `_journal.json` entry must use a `when` timestamp strictly greater than 0012's. No code change needed; the guardrail catches any stale value automatically.

### Claude's Discretion

The planner has flexibility on:

- **Exact placement of the three new `profile*` table exports in `src/db/schema.ts`.** ARCHITECTURE §1 suggests "after `profileFamily` (line 636), before `profileHistory` (line 646)." Acceptable; line numbers may have shifted post-M010. Maintain the source-ordering convention: profile tables grouped together, `profile_history` immediately after.
- **Internal naming of the per-dim shape factory functions** in `psychological-schemas.ts` (e.g., `makePerDimSchema(...)` vs explicit `hexacoSchwartzDimensionSchemaV3 + attachmentDimensionSchemaV3`). The D-27 nominal-separation principle must hold; the precise factory shape is the planner's call.
- **Profile-history `snapshot jsonb` serialization** — whether the snapshot stores the full row (including `id`/`name`/`schema_version`) or just the user-facing fields. Mirrors Phase 33 Claude's-Discretion item: recommend the full row including metadata for replayability. Phase 37 only ships the schema; Phase 38 generators decide what to write.
- **Whether to split the 3 sentinel-row INSERTs into one composite `INSERT ... VALUES (...), (...), (...)` block per table, or three separate statements.** Cosmetic; either is fine. Three separate INSERTs (one per table, each its own statement) is easier to grep for in a migration audit.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### M011 Research (locked decisions)
- `.planning/research/SUMMARY.md` — consolidated M011 research summary; zero new deps; locked architecture decisions; phase-ownership map
- `.planning/research/STACK.md` — zero new npm dependencies; word-count whitespace-split; Drizzle `.$type<T>()` pattern; Zod v3+v4 dual schemas
- `.planning/research/FEATURES.md` — table-stakes vs differentiators vs anti-features; per-dim shape rationale
- `.planning/research/ARCHITECTURE.md` §§1–5 — table strategy, migration shape (#M11-1), prompt-assembler fork (Phase 38), orchestrator split (Phase 38), reader API split
- `.planning/research/PITFALLS.md` Pitfalls 1–7 — D027 trait-authority sycophancy (Phase 38/39), speech-source contamination (Phase 37 PSCH-07/PSCH-10), sparse-data overconfidence (Phase 37 PSCH-08), Never-Retrofit incompleteness (Phase 37 PSCH-01), unconditional monthly fire (Phase 38 PGEN-06), injection-map collision (Phase 39 PSURF-01), synthetic-fixture signal erasure (Phase 40 PMT-01)

### Project specs
- `.planning/PROJECT.md` — Key Decisions D027 (Hard Rule), D028 (attachment activation gate), D042 (Never-Retrofit Checklist), D043 (PROFILE_INJECTION_MAP per-mode subset), D044 (substrate-hash idempotency three-cycle test), D045 (three-way `describe.skipIf` for live tests), D046 (live milestone-gate cost discipline), D047-to-be (psychological-vs-operational boundary — Phase 37 locks this)
- `.planning/REQUIREMENTS.md` — PSCH-01..10 are this phase's contract; PSURF-01..05 + PGEN-01..07 + PMT-01..06 give downstream context
- `.planning/ROADMAP.md` Phase 37 entry — full success criteria, HARD CO-LOC #M11-1, Never-Retrofit Checklist verbatim

### Codebase substrate (existing patterns to mirror)
- `src/db/schema.ts` — existing 12-migration schema; profile tables added after `profileFamily` and before `profileHistory`; `.$type<T>()` jsonb columns
- `src/db/migrations/0012_operational_profiles.sql` — most-similar migration precedent (multi-table + jsonb + sentinel-row pattern via UNIQUE constraint + Never-Retrofit Checklist + seed-row INSERT)
- `src/db/migrations/meta/_journal.json` — append new entry for 0013 (Phase 32 #3 monotonic-`when` CI guardrail validates the timestamp)
- `src/memory/profiles.ts:59` — `Dimension` type (operational); add parallel `PsychologicalProfileType` type
- `src/memory/profiles.ts:70-74` — `PROFILE_INJECTION_MAP` exemplar (operational); Phase 39 adds parallel `PSYCHOLOGICAL_PROFILE_INJECTION_MAP`
- `src/memory/profiles.ts:83-87` — `PROFILE_SCHEMAS` schema-version dispatcher exemplar; Phase 37 adds parallel `PSYCHOLOGICAL_PROFILE_SCHEMAS`
- `src/memory/profiles.ts:191` — `getOperationalProfiles()` exemplar of never-throw + 3-layer parse defense; Phase 37 adds parallel `getPsychologicalProfiles()` right after
- `src/memory/profiles/shared.ts:206` — `loadProfileSubstrate(now)` exemplar (operational); Phase 37 adds parallel `loadPsychologicalSubstrate(profileType, now)` in sibling `psychological-shared.ts`
- `src/memory/profiles/schemas.ts` — operational Zod v3+v4 dual-schema consolidation exemplar; Phase 37 adds sibling `psychological-schemas.ts`
- `src/memory/confidence.ts:27,31,46,49,64` — `MIN_ENTRIES_THRESHOLD`, `SATURATION`, `computeProfileConfidence`, `isAboveThreshold`; Phase 37 adds `MIN_SPEECH_WORDS`, `RELATIONAL_WORD_COUNT_THRESHOLD`, `isAboveWordThreshold` in the same file
- `src/pensieve/retrieve.ts` — exemplar of the never-throw + log-warn pattern that PSCH-09 follows
- `scripts/test.sh:65-80` — sequential `psql ... < $MIGRATION_N_SQL` block; Migration 0013 line appended here
- `scripts/regen-snapshots.sh` — drizzle meta regen script; existing acceptance-gate cleanup flag (`REGEN_PRODUCED_ACCEPTANCE`) bumped from `0012*.json` to `0013*.json`
- `scripts/validate-journal-monotonic.ts` — Phase 32 #3 guardrail; runs in `scripts/test.sh` BEFORE migrations apply; catches stale `when` in new 0013 journal entry

### M010 reference patterns (most-similar phase precedents)
- `.planning/milestones/v2.5-phases/33-profile-substrate/33-CONTEXT.md` — direct analog: M010 Phase 33 was the operational substrate phase; Phase 37 mirrors its structure (migration + tables + Zod schemas + reader API + boundary defenses)
- `.planning/milestones/v2.5-phases/33-profile-substrate/33-01-PLAN.md` + `33-02-PLAN.md` — plan-shape precedent for atomic migration + reader-API + schemas split
- `.planning/milestones/v2.5-phases/33-profile-substrate/33-VERIFICATION.md` — verification structure for substrate phases
- `.planning/milestones/v2.4-phases/25-ritual-scheduling-foundation-process-gate/25-01-PLAN.md` — most-similar migration + drizzle meta + scripts/test.sh psql line ATOMIC plan precedent

### M008 boundary-audit pattern (mirror target for PSCH-10)
- `src/episodic/__tests__/boundary-audit.test.ts` — exact pattern Phase 37's `psych-boundary-audit.test.ts` must mirror (regex-based file content sweep + self-allowlist)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/memory/confidence.ts`** — extend in-place with `MIN_SPEECH_WORDS`, `RELATIONAL_WORD_COUNT_THRESHOLD`, `isAboveWordThreshold` per D-29. Existing helpers untouched.
- **`src/memory/profiles.ts:266-391`** — operational `formatProfilesForPrompt` + `renderDimensionForPrompt` exemplars; Phase 39 will fork these. Phase 37 just adds the reader API alongside `getOperationalProfiles()`.
- **`src/memory/profiles/shared.ts:206`** — `loadProfileSubstrate(now)` shape and structure to mirror in `loadPsychologicalSubstrate(profileType, now)` — except: (a) typed by `profileType`, (b) word-counts substrate, (c) discriminated-union return for below-threshold case.
- **`src/db/schema.ts:536-636`** — four M010 profile tables; pattern (Drizzle `pgTable` + `.$type<T>()` jsonb columns + sentinel-row UNIQUE constraint) replicated verbatim for the three new psychological tables. `profile_history` (lines ~640–660) needs zero ALTER — its discriminator already accommodates new values.
- **`src/pensieve/retrieve.ts`** — exemplar of the never-throw + log-warn pattern; `getPsychologicalProfiles()` mirrors this structure exactly.
- **Luxon import path** — `import { DateTime } from 'luxon'`; already imported across `src/rituals/` for DST-safe boundary math. The pattern `DateTime.fromJSDate(now, { zone: 'Europe/Paris' }).startOf('month').minus({ months: 1 })` is standard in this codebase.
- **Drizzle migration meta scripts** — `pnpm db:generate` (or equivalent) regenerates `meta/_journal.json` + `meta/0013_snapshot.json`. The exact command lives in `scripts/regen-snapshots.sh` and `package.json`.

### Established Patterns

- **Never-Retrofit Checklist (D042)** — ALL non-retrofittable columns ship in the initial migration with `NOT NULL DEFAULT` values. Adding columns to existing tables requires a separate migration with backfill coordination per M010 PITFALL M010-11. Phase 37 ships every column listed in D-06 + D-07.
- **Sentinel-row pattern (`name = 'primary'`)** — single-row-per-table convention via UNIQUE constraint. `ON CONFLICT (name) DO UPDATE` is the upsert target for Phase 38's monthly generator. Phase 37 only inserts the seed row; Phase 38 owns the upsert path.
- **Schema-version dispatcher** — `PROFILE_SCHEMAS: Record<Dimension, Record<number, ZodSchema>>` at `src/memory/profiles.ts:83`. Phase 37 adds the parallel `PSYCHOLOGICAL_PROFILE_SCHEMAS`. Explicit `if (!parser)` check before `safeParse` so future `schema_version` values fail gracefully (PITFALL M010-11).
- **3-layer Zod v3 parse defense** — `schema_version` mismatch → null + warn; `safeParse` failure → null + warn; unknown throw → null + warn. Mirrors `getOperationalProfiles()` exactly.
- **Boundary-audit invariant test** — regex sweep of file contents, fast (<1s), self-excludes the test file from its own input set. Pattern: M008 `boundary-audit.test.ts`.
- **Hand-authored SQL migration + drizzle-kit snapshot regen + `scripts/test.sh` psql apply line + `_journal.json` entry** — all five artifacts ship in one atomic plan (HARD CO-LOC).

### Integration Points

- **`src/db/schema.ts`** — three new `pgTable` exports (`profileHexaco`, `profileSchwartz`, `profileAttachment`), each with full Never-Retrofit Checklist columns + jsonb dimension columns typed via `.$type<HexacoDimension | null>()`, `.$type<SchwartzDimension | null>()`, `.$type<AttachmentDimension | null>()`.
- **`src/memory/profiles.ts`** — new exports added AFTER existing operational exports: `PsychologicalProfileType`, `PSYCHOLOGICAL_PROFILE_SCHEMAS`, `PsychologicalProfiles` interface, `getPsychologicalProfiles()`. No existing function modified.
- **`src/memory/profiles/psychological-schemas.ts` (NEW FILE)** — Zod v3 + v4 dual schemas: `HexacoProfileSchemaV3`, `HexacoProfileSchemaV4`, `SchwartzProfileSchemaV3`, `SchwartzProfileSchemaV4`, `AttachmentProfileSchemaV3`, `AttachmentProfileSchemaV4`, plus the inferred TypeScript types and per-dim shape factories.
- **`src/memory/profiles/psychological-shared.ts` (NEW FILE)** — `PsychologicalSubstrate<T>` discriminated union type + `loadPsychologicalSubstrate<T>(profileType, now)` function + helper `countWords(text)` (private) + Luxon-based calendar-month boundary helper (private).
- **`src/memory/confidence.ts`** — three new exports added at the END of the file (preserve existing line numbers): `MIN_SPEECH_WORDS`, `RELATIONAL_WORD_COUNT_THRESHOLD`, `isAboveWordThreshold`.
- **`src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (NEW FILE)** — vitest test, mirrors M008 `boundary-audit.test.ts` shape; self-allowlists itself.
- **`src/db/migrations/0013_psychological_profiles.sql` (NEW FILE)** — three `CREATE TABLE` statements + three sentinel-row `INSERT` statements.
- **`src/db/migrations/meta/0013_snapshot.json` (NEW FILE)** — regenerated by drizzle-kit from `schema.ts`. Do not hand-author.
- **`src/db/migrations/meta/_journal.json`** — append entry: `{ idx: 13, version: '7', when: <monotonic>, tag: '0013_psychological_profiles', breakpoints: true }` (or whatever the current schema journal format is — match the 0012 entry).
- **`scripts/test.sh`** — append psql apply line for 0013 after the 0012 line.
- **`scripts/regen-snapshots.sh`** — bump `REGEN_PRODUCED_ACCEPTANCE` reference from `0012*.json` to `0013*.json` (or augment to accept either if regeneration spans multiple migrations).

</code_context>

<specifics>
## Specific Ideas

- **Mirror Phase 33's plan structure.** Phase 33 (M010 operational substrate) split into two plans: 33-01 (migration + schema + tooling — HARD CO-LOC #M10-1) and 33-02 (reader API + Zod schemas + cold-start handling). Phase 37 should consider the same split, with HARD CO-LOC #M11-1 owning plan 1 atomically. Phase 33 PATTERNS.md (`.planning/milestones/v2.5-phases/33-profile-substrate/33-PATTERNS.md`) is the closest analog for the patterns mapper.
- **`PsychologicalProfileType` as a type-level enum, not a runtime const.** Use `type PsychologicalProfileType = 'hexaco' | 'schwartz' | 'attachment'` rather than a TypeScript `enum`. Aligns with M010 `Dimension` pattern at `src/memory/profiles.ts:59`. Enables exhaustive switch checking.
- **Cold-start `last_updated` is NULL, not `now()`.** Distinct from `created_at` (always set at INSERT). The reader treats `last_updated IS NULL` as "never run" — downstream Phase 39 `/profile` display uses this to show "not yet run; first fire on the 1st of next month" if appropriate.
- **`countWords` helper is private to `psychological-shared.ts`.** Do NOT export it for general use. Word counting in other contexts (e.g., Phase 39 `/profile` display "need N more words") should call `loadPsychologicalSubstrate` and read `.wordCount` from the result, not re-implement counting.
- **The 5,000-word floor checks word count BEFORE entry count.** Phase 38's orchestrator must NOT also check `isAboveThreshold(entryCount)` for psychological profiles — the entry-count gate is operational-profile specific. Mixing the two thresholds was an explicit M010→M011 trap flagged in PITFALL §2.

</specifics>

<deferred>
## Deferred Ideas

- **`evidence_count` field on per-dim jsonb shape** — ARCHITECTURE §1 proposed but REQUIREMENTS locked the `{score, confidence, last_updated}` shape. The use case (cheap inter-period consistency without history reads) is subsumed by `profile_history` + Sonnet-reported `data_consistency` (PGEN-07). Revisit in v2.6.1 only if the host-side stats path needs it.
- **Per-dim `dimension_consistency` field** — ARCHITECTURE proposed alongside overall `data_consistency`. Not in REQUIREMENTS. Defer to v2.6.1 / CONS-02 (trait change-detection alerts).
- **`WORD_SATURATION = 20000` constant** — SUMMARY suggests a first estimate. Belongs in Phase 38 alongside the generator's confidence math, if needed at all. Calibration after 4–8 months of real M011 operation per `SAT-CAL-01`. Not introduced in Phase 37.
- **Schwartz score range in academic units (-1 to 7)** — D-09 locks 1.0–5.0 for display + Zod simplicity. Academic-fidelity score range can be a Phase 39 display-time transform if needed; the underlying score column remains 1.0–5.0. Defer to v2.6.1 / M014.
- **`profile_attachment` population logic** — entire orchestration (relational-word-count sweep, 60-day window, activation flag flip) is gated on D028 and deferred to v2.6.1 weekly sweep per REQUIREMENTS PSCH-04 + ATT-POP-01.
- **Source-filter generalization** — current filter is hard-coded to `source='telegram'`. Future psychological substrates (e.g., voice transcription, future first-party-speech sources) would extend this. Defer until a second source exists.
- **`PsychologicalSubstrate<T>` generic parameter** — currently typed `T = unknown` at the substrate-loader signature; Phase 38 generators narrow it to `HexacoProfileData | SchwartzProfileData | AttachmentProfileData` per profile. If the loader needs to return profile-type-aware shapes (e.g., attachment's `relationalWordCount`), revisit when Phase 38 reveals the need.

</deferred>

---

*Phase: 37-psychological-substrate*
*Context gathered: 2026-05-13*
