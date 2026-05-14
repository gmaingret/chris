# Phase 38: Psychological Inference Engine — Research

**Researched:** 2026-05-14
**Domain:** Sonnet-driven psychological trait inference (HEXACO + Schwartz); shared prompt-assembler fork; `Promise.allSettled` orchestrator; 5th monthly cron with unconditional fire (inverse of M010 hash-skip idempotency); 3-cycle integration test
**Confidence:** HIGH — every finding grounded in direct codebase inspection on `main` HEAD (current 2026-05-14); zero speculation. CONTEXT.md's 36 decisions and the 4 canonical-ref docs lock all gray areas; this research's job is verification + structural-pattern extraction with file:line anchors, not re-decision.

---

## Summary

Phase 38 is a near-mechanical mirror of Phase 34 (M010 inference engine) shifted into the psychological namespace, with **one load-bearing divergence** that drives the entire phase: **unconditional monthly fire** (PGEN-06 — inverse of M010 GEN-07's hash-skip idempotency). Every other locked decision falls out of "mirror M010 Phase 34 with HEXACO + Schwartz instead of jurisdictional/capital/health/family, monthly instead of weekly, two generators instead of four."

The implementation lands across three plans (38-01 → 38-02 → 38-03, strict ordering per D-02) and creates four new source files: `src/memory/psychological-profile-prompt.ts` (NEW; shared builder; HARD CO-LOC #M11-2 anchor), `src/memory/profiles/hexaco.ts` (NEW), `src/memory/profiles/schwartz.ts` (NEW), and `src/memory/psychological-profile-updater.ts` (NEW). Five existing files are modified: `src/cron-registration.ts` (add 5th cron registration + status/deps fields), `src/config.ts` (add `psychologicalProfileUpdaterCron` validated env var), `src/index.ts` (wire orchestrator into `registerCrons` deps + add `psychological_profile_cron_registered` to `/health`), and (test extensions) `src/rituals/__tests__/cron-registration.test.ts` + `src/__tests__/config.test.ts`. New tests: `src/memory/__tests__/psychological-profile-prompt.test.ts` (structural; Plan 38-01), `src/memory/profiles/__tests__/{hexaco,schwartz}.test.ts` (unit; Plan 38-02), and `src/memory/__tests__/psychological-profile-updater.integration.test.ts` (3-cycle unconditional-fire; HARD CO-LOC, Plan 38-02). Total scope: 4 new source files, ~3 new test files, 5 modified files. Zero new npm dependencies.

**Critical schema gap surfaced by this research:** Phase 37's v4 schemas at `src/memory/profiles/psychological-schemas.ts:93-100,120-131` declare per-dimension shape only — **no top-level `data_consistency` field, no top-level `overall_confidence` field**. M010's operational v4 schemas at `src/memory/profiles/schemas.ts:67,116,181,236` have `data_consistency: zV4.number().min(0).max(1)` at the top level (which is how Sonnet is asked to self-report and how the DB column is populated). **Phase 38 MUST extend the SDK-boundary schema with `data_consistency` at minimum** so Sonnet emits the value PGEN-07 requires; the row-level `overallConfidence` is host-derived or also Sonnet-emitted (planner decides). Without this extension, `overall_confidence > 0` (D-34 cycle 1 assertion + PMT-04 populated assertion) can never be satisfied. See Plan-38-02 critical findings below.

**Primary recommendation:** Mirror Phase 34's three plans literally — 34-01 prompt+test → 34-02 generators+test → 34-03 orchestrator+cron+config+health. Substitute `dimension: 'jurisdictional'|'capital'|'health'|'family'` (4-way) → `profileType: 'hexaco'|'schwartz'` (2-way). Substitute `Promise.allSettled` over 4 → over 2. Substitute Sunday-weekly cron → 1st-of-month monthly cron. **Delete the hash-skip branch** in the generator body (D-17). Add the **schema extension** for `data_consistency` (and host-injected `overall_confidence` if Sonnet doesn't emit it). Everything else is rename + table-name swap.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 1st-of-month 09:00 Paris cron tick | Node host (`node-cron`) | — | Background data pipeline; mirrors the existing 4 crons in `src/cron-registration.ts:96-193` |
| Substrate loading (`source='telegram'` corpus + episodic summaries + prevHistorySnapshot per profile type) | Application — Drizzle/Postgres | — | Phase 37 shipped `loadPsychologicalSubstrate` at `src/memory/profiles/psychological-shared.ts:161-235`; Phase 38 consumes it (2 calls per fire per D-24) |
| Substrate-hash computation (recorded, NOT used for skip) | Application — pure function (reuse `computeSubstrateHash` from M010) | — | SHA-256 over canonical JSON of {pensieveIds, episodicDates, schemaVersion}; same shape as M010 but **without M011 decision columns** because PSCH-07 corpus is `source='telegram'` only and there is no resolved-decisions reader in the M011 substrate |
| Shared prompt assembly | Application — pure function in new `src/memory/psychological-profile-prompt.ts` | — | Forked from `src/memory/profile-prompt.ts:175-223` per D-03; reuses `CONSTITUTIONAL_PREAMBLE` + `DO_NOT_INFER_DIRECTIVE` by import |
| Sonnet inference call (1 per profile type — NOT per dim) | Anthropic SDK boundary | Application (Zod v3 re-validate per D-32 + M008/M009 dual-schema discipline) | `messages.parse({model, system, messages, output_format})` shape exists in `src/memory/profiles/shared.ts:457-480` and `src/episodic/consolidate.ts:129-158`; mirror verbatim |
| Per-generator upsert (`name='primary'` sentinel) + write-before-upsert to `profile_history` | Database — Drizzle insert + `onConflictDoUpdate` | — | Polymorphic `profile_history.profile_table_name` discriminator already accepts new strings (`profile_hexaco`, `profile_schwartz`); index `profile_history_table_recorded_idx` at `src/db/schema.ts:758` already covers |
| `Promise.allSettled` fan-out (2 generators) | Application — orchestrator in new `src/memory/psychological-profile-updater.ts` | — | Mirror `src/memory/profile-updater.ts:64-142` `updateAllOperationalProfiles` with 2 generators + unconditional-fire comment |
| 5th cron registration | `src/cron-registration.ts` (modified) | `src/config.ts` (modified — `validatedCron` env var) | Mirror lines 178-193 (M010 profile cron block); add new `psychologicalProfileUpdate` status field at line 29 and new `runPsychologicalProfileUpdate` dep at line 52 |
| `/health` endpoint psych-cron-registered field | `src/index.ts` (modified) | Module-scoped `cronStatus` | One-line addition at `src/index.ts:72` mirror of `profile_cron_registered` |
| 3-cycle unconditional-fire integration test | `vitest` + real Docker Postgres + mocked `anthropic.messages.parse` | — | Mirror `src/memory/profiles/__tests__/generators.two-cycle.test.ts` STRUCTURE but with INVERTED Cycle-2 assertion (4 cumulative calls, not 2 — unconditional fire) per D-34/D-35 |

---

## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from `.planning/phases/38-psychological-inference-engine/38-CONTEXT.md`)

**Plan split (D-01, D-02):**
- 3 plans, strict ordering: 38-01 (prompt builder + structural test) → 38-02 (HEXACO + Schwartz generators + 3-cycle integration test) → 38-03 (orchestrator + cron + config + /health)
- 38-01 MUST ship before 38-02 (HARD CO-LOC #M11-2 — both generators import the builder)
- Both generators MUST ship in 38-02 (HARD CO-LOC #M11-2 — prevents per-generator prompt drift)

**Shared prompt builder (D-03..D-10):**
- `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount)` in `src/memory/psychological-profile-prompt.ts`
- `profileType: 'hexaco' | 'schwartz'` — attachment deferred per D-23
- Returns `{system: string, user: string}`; pure function, zero side effects
- `CONSTITUTIONAL_PREAMBLE` re-imported from `src/chris/personality.ts`; first section
- `DO_NOT_INFER_DIRECTIVE` re-imported verbatim from `src/memory/profile-prompt.ts` (NOT redeclared — one source of truth)
- `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant exported from the new file (D027 extension; locked phrasing in D-07)
- Word-count framing (D-08): tells Sonnet to emit `data_consistency` (0-1); host does NOT compute confidence
- Previous-state injection (D-09): `prevHistorySnapshot` rendered verbatim under `## CURRENT PROFILE STATE` when non-null
- Per-profile-type directive blocks (D-10): HEXACO emphasizes cross-dimension coherence; Schwartz emphasizes circumplex structure; both include the r ≈ .31–.41 empirical-limits framing

**Per-profile-type generators (D-11..D-16):**
- `src/memory/profiles/hexaco.ts` and `src/memory/profiles/schwartz.ts`, identical shape
- Each exports `generate{Hexaco,Schwartz}Profile(deps): Promise<PsychologicalProfileGenerationOutcome>`
- Body: receive substrate → check `belowThreshold` → call Sonnet → parse v4 → re-validate v3 → write history snapshot → upsert
- Profile-type config objects: `{profileType, v3Schema, v4Schema}` shape
- Optional `runPsychologicalProfileGenerator(config, deps)` helper extraction (D-11/D-12; Claude's discretion)
- Sonnet model: `SONNET_MODEL` (`claude-sonnet-4-6` from `src/config.ts:41`)
- ONE Sonnet call per profile type — NOT per dimension (D-15)
- Discriminated outcome: `{profileType, outcome: 'updated' | 'skipped_below_threshold' | 'error', error?, wordCount?, overallConfidence?, durationMs}` (D-14)
- Structured log names verbatim: `chris.psychological.hexaco.{updated,skipped_below_threshold,error}` and `chris.psychological.schwartz.{updated,skipped_below_threshold,error}` (D-14 + PGEN-02)

**Unconditional fire (D-17, D-18 — PGEN-06):**
- `substrate_hash` computed on every fire via reused M010 `computeSubstrateHash` helper
- Hash persisted in `substrate_hash` column for audit trail
- **NO hash-skip branch** — Sonnet is called every fire regardless of whether the hash matches the prior row (direct inverse of M010 `src/memory/profiles/shared.ts:399-409` GEN-07 hash-skip)
- Rationale comment inline at top of `updateAllPsychologicalProfiles()` body (D-18; phrasing locked)

**prevHistorySnapshot injection (D-19, D-20 — PGEN-07):**
- Orchestrator threads `prevHistorySnapshot` from `loadPsychologicalSubstrate` return → generator → `assemblePsychologicalProfilePrompt(profileType, substrate, prevHistorySnapshot, wordCount)`
- Sonnet self-reports `data_consistency` in structured output; host stores verbatim
- Host-side stddev / inter-period math DEFERRED to v2.6.1 (CONS-01)

**Orchestrator (D-21..D-25 — PGEN-04):**
- `updateAllPsychologicalProfiles()` in `src/memory/psychological-profile-updater.ts`
- `Promise.allSettled([generateHexacoProfile(deps), generateSchwartzProfile(deps)])` — HEXACO failure does NOT abort Schwartz
- No retry within a fire (D-22 — next month's cron is the retry)
- Attachment generator NOT included (D-23 — deferred to v2.6.1)
- Substrate loaded TWICE per fire (D-24 — once per profile type for the per-type `prevHistorySnapshot`)
- Returns `Promise<void>` — fire-and-forget (D-25)

**Monthly cron registration (D-26..D-31 — PGEN-05):**
- 5th cron: `'0 9 1 * *'` with `{timezone: config.proactiveTimezone}` (default `'Europe/Paris'`)
- `config.psychologicalProfileUpdaterCron` validated env var (`PSYCHOLOGICAL_PROFILE_UPDATER_CRON`; default `'0 9 1 * *'`)
- `cron.validate` fail-fast at module load (mirror `src/config.ts:87` shape)
- `CronRegistrationStatus.psychologicalProfileUpdate: 'registered' | 'failed'` field
- `RegisterCronsDeps.runPsychologicalProfileUpdate: () => Promise<void>` field
- `/health` reports `psychological_profile_cron_registered` (verbatim snake_case per PGEN-05)
- Wired in `src/index.ts` `registerCrons({...})` deps
- Collision-avoidance with M010 Sunday 22:00 cron verified at registration time via 12-month next-fire enumeration unit test (D-27)

**Sonnet structured output schema (D-32, D-33):**
- v4 schemas from `src/memory/profiles/psychological-schemas.ts` consumed via `zodOutputFormat`
- ⚠️ Phase 37 v4 schemas may need `data_consistency` extension at the SDK boundary — planner verifies (D-32 explicit caveat)
- NO `.refine()` ceiling on `overall_confidence` (D-33 — diverges from M010 D-32; 5,000-word floor is upstream gate)

**3-cycle unconditional-fire integration test (D-34..D-36 — verifies PGEN-06):**
- File: `src/memory/__tests__/psychological-profile-updater.integration.test.ts`
- Real Docker Postgres; mocked `anthropic.messages.parse`
- Cycle 1: 6,000 telegram words across 30 days → 2 Sonnet calls (1 HEXACO + 1 Schwartz); both rows populated with `overall_confidence > 0`; `profile_history` has 2 rows
- Cycle 2 (identical substrate): cumulative **4** Sonnet calls (NOT 2 — UNCONDITIONAL FIRE; inverse of M010 PTEST-03); `profile_history` has 4 rows total
- Cycle 3 (INSERT 5 new telegram entries): cumulative 6 calls; `profile_history` 6 rows
- Test docblock includes the explicit "INVERSE of M010 PTEST-03" comment (D-35; phrasing locked)
- Mocked Sonnet returns realistic HEXACO + Schwartz payloads (D-36; values irrelevant for unconditional-fire assertion)

### Claude's Discretion

- Whether to extract `runPsychologicalProfileGenerator(config, deps)` helper in `psychological-shared.ts` or keep separate functions in each generator file (M010 extracted; M011 has only 2 generators — extraction may be premature)
- Whether `PSYCHOLOGICAL_HARD_RULE_EXTENSION` is a const string or a const-returning function (const string mirrors `DO_NOT_INFER_DIRECTIVE` at `src/memory/profile-prompt.ts:107`)
- Whether the prompt-builder structural test (`psychological-profile-prompt.test.ts`) is separate from the generator integration test (recommend: separate — unit-level structural assertions are cheaper)
- Exact comment phrasing for the unconditional-fire divergence (D-18 provides starting phrasing)
- Where the `PROFILE_TYPE_TO_TABLE_NAME` discriminator constant lives (currently module-private in `src/memory/profiles/psychological-shared.ts:103-107`; Phase 38 generators need it for `profile_history` writes — **recommend exporting it** to avoid duplication)

### Deferred Ideas (OUT OF SCOPE)

- Attachment generator (D-23 + PGEN-04 verbatim — deferred to v2.6.1 / ATT-POP-01)
- Host-side inter-period consistency math (D-20 + PGEN-07 — deferred to v2.6.1 / CONS-01)
- `.refine()` ceiling on `overall_confidence` (D-33)
- Single-load substrate optimization (D-24 — 2 substrate loads per fire accepted)
- Per-profile-type substrate filtering (different corpus for HEXACO vs Schwartz)
- Retry on Sonnet failure beyond "next month's cron"
- `hash_recorded` debug-level log event (D-17 — optional; planner may collapse into main outcome log)
- Cron-collision dodge to `'0 9 2 * *'` (D-27 explicitly rejects)
- Live Sonnet 4.6 milestone-gate test against real API (Phase 40 — PMT-06)
- Primed `m011-30days` / `m011-1000words` fixtures + signature-detection assertion (Phase 40)
- Phase 39 surfaces (`PSYCHOLOGICAL_PROFILE_INJECTION_MAP`, formatter, mode handlers, `/profile`)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PGEN-01 | `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount)` shared builder in `src/memory/psychological-profile-prompt.ts`; forks M010 `assembleProfilePrompt`; includes `CONSTITUTIONAL_PREAMBLE` + `DO_NOT_INFER_DIRECTIVE` + Hard Rule D027 extension inline | Verified — fork target at `src/memory/profile-prompt.ts:175-223` (8-section structure); imports at lines 41 + 107. New file mirrors structure with substitutions in §"Plan 38-01" below |
| PGEN-02 | HEXACO generator at `src/memory/profiles/hexaco.ts`; single Sonnet call (6 dims in one structured output); v4 parse + v3 re-validate; upsert + `profile_history`; emits `chris.psychological.hexaco.{updated,skipped_below_threshold,error}` | Verified — mirror target at `src/memory/profiles/jurisdictional.ts:84-88` (delegates to shared helper). Sonnet call shape at `src/memory/profiles/shared.ts:457-480`. Discriminated outcome shape at `shared.ts:140-144`. v3-after-v4 parse at `shared.ts:487`. Write-before-upsert at `shared.ts:495-501` |
| PGEN-03 | Schwartz generator at `src/memory/profiles/schwartz.ts`; same shape (10 values in one call) | Verified — same mirror target as PGEN-02; only profile-type config differs |
| PGEN-04 | `updateAllPsychologicalProfiles()` orchestrator with `Promise.allSettled`; HEXACO failure does not abort Schwartz; attachment NOT included | Verified — mirror target at `src/memory/profile-updater.ts:64-142`; Promise.allSettled invocation at lines 81-86 (4-element array → reduce to 2-element) |
| PGEN-05 | Monthly cron `'0 9 1 * *'` Europe/Paris with `psychologicalProfileUpdaterCron` env var + `cron.validate` fail-fast + `/health` reports `psychological_profile_cron_registered` + day-and-hour collision-avoidance with Sunday 22:00 cron verified at registration time | Verified — cron registration template at `src/cron-registration.ts:178-193`. `validatedCron` helper at `src/config.ts:20-26`. Existing collision test pattern at `src/rituals/__tests__/cron-registration.test.ts:135-200`. Collision analysis in `.planning/research/ARCHITECTURE.md:230-240` |
| PGEN-06 | UNCONDITIONAL fire — `substrate_hash` recorded but does NOT short-circuit. Inverse of M010 GEN-07. Inline comment documents the divergence | Verified — M010 hash-skip branch at `src/memory/profiles/shared.ts:399-409` is the line to DELETE in the M011 generator. Comment phrasing locked in D-18 |
| PGEN-07 | `prevHistorySnapshot` threaded into prompt; Sonnet self-reports `data_consistency`; host does NOT compute stddev | Verified — `prevHistorySnapshot` returned by `loadPsychologicalSubstrate` at `src/memory/profiles/psychological-shared.ts:212-225,233`. **GAP: v4 schema does not declare `data_consistency` (see §Critical findings)** |

---

## Critical Findings — Schema & Naming Gaps the Planner MUST Address

### Finding 1: Phase 37 v4 schemas omit `data_consistency` / `overall_confidence`

**Where:** `src/memory/profiles/psychological-schemas.ts:93-100, 120-131, 146-150`

**What's there:**
```typescript
// Lines 93-100 — HexacoProfileSchemaV4
export const HexacoProfileSchemaV4 = zV4.object({
  honesty_humility: hexacoSchwartzDimensionSchemaV4,
  emotionality: hexacoSchwartzDimensionSchemaV4,
  extraversion: hexacoSchwartzDimensionSchemaV4,
  agreeableness: hexacoSchwartzDimensionSchemaV4,
  conscientiousness: hexacoSchwartzDimensionSchemaV4,
  openness: hexacoSchwartzDimensionSchemaV4,
});
```

**What's missing (compare to M010 — `src/memory/profiles/schemas.ts:61-68`):**
```typescript
// M010 — HexacoProfileSchemaV4 EQUIVALENT shape pattern (jurisdictional)
export const JurisdictionalProfileSchemaV4 = zV4.object({
  // ...per-field properties...
  data_consistency: zV4.number().min(0).max(1),  // ← REQUIRED for the host to know what Sonnet inferred
});
```

**Why it matters:**
- D-08 and PGEN-07 say "Sonnet self-reports `data_consistency`"
- D-32 explicitly flags this: "the v4 schema may need a small adjustment to allow Sonnet to omit `last_updated` and let the host inject it — the planner verifies whether Phase 37's v4 schema currently requires `last_updated` from Sonnet or accepts host-injection"
- D-34 Cycle 1 assertion is "both profile rows have `overall_confidence > 0`" — impossible without a Sonnet-emitted value to write into the `overallConfidence` column

**What the planner MUST do (Plan 38-02):**
The Phase 38 generator MUST construct the SDK-boundary v4 schema by extending `HexacoProfileSchemaV4` / `SchwartzProfileSchemaV4` with the top-level fields Sonnet needs to emit. Two equivalent shapes:

**Option A — extend in the generator (closure-captured):**
```typescript
// Inside generateHexacoProfile (or runPsychologicalProfileGenerator)
const HexacoSchemaV4ForSdk = HexacoProfileSchemaV4.extend({
  data_consistency: zV4.number().min(0).max(1),
  overall_confidence: zV4.number().min(0).max(1),
});
```

**Option B — declare in `psychological-schemas.ts` (recommend):**
Add the SDK-boundary variants alongside the existing schemas:
```typescript
// In src/memory/profiles/psychological-schemas.ts (Plan 38-02 modification)
export const HexacoProfileSchemaV4Sdk = HexacoProfileSchemaV4.extend({
  data_consistency: zV4.number().min(0).max(1),
  overall_confidence: zV4.number().min(0).max(1),
});
export const SchwartzProfileSchemaV4Sdk = SchwartzProfileSchemaV4.extend({...same...});
```

The v3 schema must also gain the matching fields (for the v3 re-validate step at `shared.ts:487`). Equivalent extensions in the v3 versions.

The planner MUST also decide: does the host inject `last_updated` per-dimension (since the v4 schema requires it via `hexacoSchwartzDimensionSchemaV4.last_updated: zV4.string()` at `psychological-schemas.ts:56`)? Two options:
- **Option A:** Sonnet emits `last_updated` per dim — the prompt must instruct it to (current v4 schema requires this)
- **Option B:** Make `last_updated` optional in the SDK schema and host-inject after parse

**Confidence:** HIGH — verified by direct file read. This gap was explicitly flagged in CONTEXT.md D-32 as "the planner verifies."

### Finding 2: `PROFILE_TYPE_TO_TABLE_NAME` is module-private; generators need to write history rows

**Where:** `src/memory/profiles/psychological-shared.ts:103-107`

```typescript
const PROFILE_TYPE_TO_TABLE_NAME: Record<PsychologicalProfileType, string> = {
  hexaco: 'profile_hexaco',
  schwartz: 'profile_schwartz',
  attachment: 'profile_attachment',
} as const;
```

This is currently module-private (no `export`). Phase 38 generators write `profile_history` rows via `db.insert(profileHistory).values({profileTableName: ..., profileId: ..., snapshot: ...})` (mirror of `src/memory/profiles/shared.ts:495-501`). They need the table-name string per profile type.

**Recommendation (Claude's discretion):** Export `PROFILE_TYPE_TO_TABLE_NAME` from `psychological-shared.ts` so generators can import it. Alternative: each generator declares its own string literal — but this risks the "typo in migration vs application code" silent-failure class flagged in PITFALLS.md Pitfall 7. One source of truth is the right call.

### Finding 3: M010's `computeSubstrateHash` shape may not fit M011

**Where:** `src/memory/profiles/shared.ts:298-311`

M010's `computeSubstrateHash` consumes a `ProfileSubstrate` with three arrays: `pensieveEntries`, `episodicSummaries`, `decisions`. M011's `loadPsychologicalSubstrate` returns a discriminated union with `corpus` + `episodicSummaries` only — there is no `decisions` array (per `psychological-shared.ts:36-37`: "NO `decisions` table query — M011 substrate is corpus-only (D-20)").

**Two paths for the planner:**

**Path A (recommend):** Phase 38 declares a separate `computePsychologicalSubstrateHash` in `psychological-shared.ts` (or in the new generator/orchestrator) with the M011-appropriate input shape:
```typescript
function computePsychologicalSubstrateHash(
  corpus: (typeof pensieveEntries.$inferSelect)[],
  episodicSummaries: (typeof episodicSummaries.$inferSelect)[],
  schemaVersion: number,
): string {
  // mirror canonicalSubstrateJson from shared.ts:265-278 but without `decisionIds`
  // SHA-256 over canonical JSON
}
```

**Path B:** Reuse M010 `computeSubstrateHash` with `decisions: []` — works mechanically but couples M011 to M010's substrate shape and creates a violation of the D047 boundary (PSCH-10 audit could flag).

CONTEXT.md does not lock this — planner's call. **Path A keeps the boundary clean.**

### Finding 4: M011 substrate has no `entryCount` analogue

M010's threshold check at `src/memory/profiles/shared.ts:372-383` uses `entryCount` (Pensieve row count, gate at 10). M011's threshold is `wordCount < MIN_SPEECH_WORDS=5000` at `psychological-shared.ts:200-206`, which fires BEFORE substrate is returned (discriminated union with `belowThreshold: true`).

**Implication for the generator body:** the threshold-check step is structurally different. Mirror this shape:
```typescript
// Mirror src/memory/profiles/shared.ts:370-383 but with the discriminated union
if (substrate.belowThreshold) {
  logger.info(
    { profileType, wordCount: substrate.wordCount, neededWords: substrate.neededWords, threshold: MIN_SPEECH_WORDS },
    `chris.psychological.${profileType}.skipped_below_threshold`,
  );
  return { profileType, outcome: 'skipped_below_threshold', wordCount: substrate.wordCount, durationMs: Date.now() - startMs };
}
// Below here, TypeScript narrows substrate to the `belowThreshold: false` branch
// → substrate.corpus, substrate.episodicSummaries, substrate.wordCount, substrate.prevHistorySnapshot
```

The planner SHOULD make this narrowing explicit in the task description so generators don't fall back to a "loose `if/else`" check.

---

## Existing Code Inventory (file:line anchors for plan citations)

### File: `src/memory/profile-prompt.ts` (M010 — fork target for Plan 38-01)

**Verified shape (252 lines total):**

| Line(s) | Symbol | What it does | Phase 38 action |
|---------|--------|--------------|-----------------|
| 41 | `import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';` | Imports M006 constitutional preamble | **Mirror verbatim** in `psychological-profile-prompt.ts` |
| 51 | `export type ProfilePromptDimension = 'jurisdictional' \| 'capital' \| 'health' \| 'family';` | 4-way operational union | **Do NOT extend** — fork (D-03). Declare new `PsychologicalProfilePromptType = 'hexaco' \| 'schwartz'` (matches D-03 — attachment deferred) |
| 59 | `export type AssembledProfilePrompt = { system: string; user: string };` | Return shape | **Reuse type by import** OR redeclare; either works |
| 75-93 | `export type ProfileSubstrateView` | Structural type for prompt's substrate input | **NEW** psychological version — fields `corpus` + `episodicSummaries` + `wordCount` (mirror Phase 37 `PsychologicalSubstrate` above-threshold branch) |
| 107-110 | `export const DO_NOT_INFER_DIRECTIVE` | Anti-hallucination directive | **Import verbatim** (D-06 — single source of truth) |
| 124-141 | `const DIMENSION_DIRECTIVES: Record<ProfilePromptDimension, string>` | 4 dimension-specific directive blocks | **NEW** `PROFILE_TYPE_DIRECTIVES: Record<'hexaco' \| 'schwartz', string>` per D-10 (HEXACO cross-dim coherence; Schwartz circumplex framing; both include r ≈ .31–.41 ceiling language) |
| 175-223 | `export function assembleProfilePrompt(dimension, substrate, prevState, entryCount): AssembledProfilePrompt` | 8-section pure-function assembler | **Mirror** with substitutions: `dimension`→`profileType`, `entryCount`→`wordCount`. Section 4 (volume-weight ceiling) becomes word-count framing per D-08. Section 6 (dimension directive) becomes profile-type directive |
| 227-238 | `function buildRolePreamble(dimension)` | Role/task framing | **Adapt** for psychological-inference framing (different task, different discipline language) |
| 258-280 | `function buildVolumeWeightCeilingDirective(entryCount)` | M010-01 mitigation prompt | **Replace** with M011's word-count framing per D-08 (no host-side `data_consistency > 0.5` enforcement; the r ≈ .31–.41 ceiling is in the profile-type directive instead) |
| 294-303 | `function buildPreviousStateBlock(prevState)` | M010-03 anti-drift block | **Reuse** structurally with adjusted "update high-confidence dimension scores ONLY when substantial cross-month behavioral evidence justifies the change" language per D-09 |
| 305-349 | `function buildSubstrateBlock(substrate)` | Renders Pensieve/episodic/decisions | **Adapt** — render `corpus` + `episodicSummaries` + `wordCount` (no `decisions`); preamble mentions "X words of Greg's first-person Telegram speech from the previous calendar month" per D-08 |
| 362-377 | `function buildStructuredOutputDirective(dimension)` | Reminds Sonnet about field contract | **Adapt** — name schemas `HexacoProfileSchemaV4Sdk` / `SchwartzProfileSchemaV4Sdk`; required field `data_consistency` |

**Section ordering for `assemblePsychologicalProfilePrompt` (mirror M010's 8 sections; substitutions per D-03..D-10):**
1. `CONSTITUTIONAL_PREAMBLE.trimEnd()` (D-05)
2. Role preamble — psychological-trait-inference framing
3. `DO_NOT_INFER_DIRECTIVE` (D-06 — imported from M010)
4. `PSYCHOLOGICAL_HARD_RULE_EXTENSION` (D-07 — NEW inline constant in this file)
5. Word-count framing (D-08 — replaces M010's volume-weight ceiling)
6. Previous-state injection (D-09 — conditional on `prevState !== null`)
7. Profile-type directive (D-10 — HEXACO/Schwartz)
8. Substrate block (corpus + episodic + wordCount)
9. Structured-output directive (last; names schema, lists required `data_consistency`)

### File: `src/memory/profiles/jurisdictional.ts` (M010 — generator template for Plan 38-02)

**Verified shape (91 lines total — the minimal-dispatch pattern):**

| Line(s) | Symbol | Phase 38 action |
|---------|--------|-----------------|
| 23-35 | `import` block — schemas + Drizzle table + `runProfileGenerator` helper | Mirror with `psychological-schemas` imports + `profileHexaco` table + (new) `runPsychologicalProfileGenerator` helper |
| 41-54 | `function flattenJurisdictionalOutput(parsed): Record<string, unknown>` | **Adapt** — map snake_case Sonnet output (`honesty_humility, emotionality, ...`) → Drizzle camelCase (`honestyHumility, emotionality, ...`). HEXACO has 6 dims; Schwartz has 10. |
| 62-67 | `function extractJurisdictionalPrevState(row)` | **Probably NOT NEEDED** for M011 — D-19 says the prevState comes from `loadPsychologicalSubstrate.prevHistorySnapshot` (a `profile_history` row), not from reading the current `profile_hexaco` row. Planner verifies — if the orchestrator threads `prevHistorySnapshot` directly into the prompt, generators don't need this helper. |
| 69-77 | `const JURISDICTIONAL_PROFILE_CONFIG: ProfileGeneratorConfig<...>` | **Mirror** as `HEXACO_PROFILE_CONFIG: PsychologicalProfileGeneratorConfig<HexacoProfileData>` and `SCHWARTZ_PROFILE_CONFIG` |
| 84-88 | `export async function generateJurisdictionalProfile(deps): Promise<ProfileGenerationOutcome> { return runProfileGenerator(...); }` | **Mirror exactly** as `generateHexacoProfile` / `generateSchwartzProfile` if helper is extracted; otherwise inline the body |

### File: `src/memory/profiles/shared.ts` (M010 — generator helper template for Plan 38-02)

**Verified critical sections:**

| Line(s) | Symbol | Phase 38 action |
|---------|--------|-----------------|
| 113-118 | `export type ProfileSubstrate` | **DO NOT REUSE** — Phase 37 already declared `PsychologicalSubstrate<T>` discriminated union at `psychological-shared.ts:81-93`. Use that. |
| 140-144 | `export type ProfileGenerationOutcome` | **NEW** `PsychologicalProfileGenerationOutcome` discriminated union per D-14 — 3 outcomes (`updated` \| `skipped_below_threshold` \| `error`) NOT 4 (no `skipped_no_change` because no hash-skip per PGEN-06) |
| 161-179 | `export type ProfileGeneratorConfig<TData>` | **NEW** `PsychologicalProfileGeneratorConfig<TData>` — `profileType: 'hexaco' \| 'schwartz'`, `v3Schema`, `v4Schema`, `table: typeof profileHexaco \| typeof profileSchwartz`, `profileTableName: string`, `flattenSonnetOutput`. NO `extractPrevState` if Finding 3 (above) is correct that prevState comes from substrate not table |
| 265-278 | `function canonicalSubstrateJson` | **NEW** `canonicalPsychologicalSubstrateJson` — omit `decisionIds` (Finding 3); add `episodicDates` + `pensieveIds`. SHA-256 invocation identical |
| 298-311 | `export function computeSubstrateHash(substrate, prevStateMeta): string` | **NEW** sibling `computePsychologicalSubstrateHash(corpus, episodicSummaries, schemaVersion): string` (Finding 3 Path A) |
| 363-565 | `export async function runProfileGenerator<TData>(config, substrate): Promise<ProfileGenerationOutcome>` | **MIRROR with 4 specific changes (Plan 38-02):** (1) threshold check at lines 372-383 → discriminated-union narrow `if (substrate.belowThreshold)` per Finding 4; (2) **DELETE hash-skip branch at lines 399-409 — UNCONDITIONAL FIRE per PGEN-06** (still compute and store the hash); (3) lines 417-420 `.refine()` volume-weight ceiling — DROP per D-33; (4) lines 487-490 — Sonnet emits both `data_consistency` AND `overall_confidence` per Finding 1; host stores both verbatim into `overall_confidence` column |
| 457-480 | `const response = await anthropic.messages.parse({...})` | **MIRROR verbatim** — same SDK shape; same `cache_control: ephemeral`; same `output_config.format: zodOutputFormat(v4WithRefine)` (without the refine — just `zodOutputFormat(v4SdkSchema)`) |
| 495-501 | Write-before-upsert: `db.insert(profileHistory).values({profileTableName, profileId, snapshot: currentRow})` | **MIRROR verbatim** — substitute `profileTableName: 'profile_hexaco'` or `'profile_schwartz'`. Snapshot is the FULL `currentRow` jsonb-able shape per D-30. NB the polymorphic discriminator already accepts new values — see `src/db/schema.ts:752` |
| 514-539 | Upsert via `onConflictDoUpdate({target: config.table.name, ...})` | **MIRROR verbatim** — same jsonb-encoding-with-`sql\`...::jsonb\`` pattern from lines 514-522 (critical: Phase 37 tables also use `notNull().default(sql\`'null'::jsonb\`)` so the same encoding pattern applies — see `src/db/schema.ts:672-677`) |

### File: `src/memory/profile-updater.ts` (M010 — orchestrator template for Plan 38-03)

**Verified shape (142 lines total):**

| Line(s) | Symbol | Phase 38 action |
|---------|--------|-----------------|
| 46-52 | Imports (substrate + 4 generators + types) | Mirror with substrate loader (`loadPsychologicalSubstrate`) + 2 generators (`generateHexacoProfile`, `generateSchwartzProfile`) |
| 64-142 | `export async function updateAllOperationalProfiles(): Promise<void>` | **MIRROR** as `updateAllPsychologicalProfiles()` with 6 specific changes: (1) **insert D-18 unconditional-fire rationale comment at top of body** before the substrate load; (2) substrate is loaded TWICE per fire (per D-24 — one per profile type for the per-type `prevHistorySnapshot`); (3) `Promise.allSettled` array is length-2 not length-4 (only HEXACO + Schwartz; attachment EXCLUDED per D-23 + PGEN-04); (4) the discriminated outcome switch at lines 94-110 has 3 cases not 4 (no `skipped_no_change`); (5) aggregate log key is `chris.psychological.cron.complete`; (6) outer try/catch lowercase infra log is `psychological.profile.cron.error` (mirror line 139 convention) |
| 81-86 | `Promise.allSettled([generateJurisdictional(...), generateCapital(...), generateHealth(...), generateFamily(...)])` | **MIRROR** as `Promise.allSettled([generateHexacoProfile({substrate: hexacoSubstrate}), generateSchwartzProfile({substrate: schwartzSubstrate})])` — note per-profile-type substrate (D-24) |

### File: `src/cron-registration.ts` (Plan 38-03 — 4 modifications)

**Verified existing shape:**

| Line(s) | Phase 38 action |
|---------|-----------------|
| 22-30 | `CronRegistrationStatus` interface — **add** `psychologicalProfileUpdate: 'registered' \| 'failed';` field alongside `profileUpdate` (line 29). Mirror the existing JSDoc style at line 28 |
| 32-55 | `RegisterCronsDeps` interface — **add** `psychologicalProfileUpdaterCron: string` to `config` (mirror line 40); **add** `runPsychologicalProfileUpdate: () => Promise<void>` field (mirror line 52). Match the JSDoc style |
| 66-74 | `const status: CronRegistrationStatus` initialization — **add** `psychologicalProfileUpdate: 'failed'` to the initial state (mirror line 73) |
| 178-193 | M010 profile cron block — **add a fifth `cron.schedule` block BELOW this one** (after line 193). Structure: |

```typescript
// M011 Phase 38 PGEN-05 — 1st-of-month 09:00 Paris psychological profile updater.
// UNCONDITIONAL fire monthly per PGEN-06 (inverse of M010 hash-skip idempotency).
// CRON-01 try/catch belt-and-suspenders (mirror line 178-186 convention).
cron.schedule(
  deps.config.psychologicalProfileUpdaterCron,
  async () => {
    try {
      await deps.runPsychologicalProfileUpdate();
    } catch (err) {
      logger.error({ err }, 'psychological.profile.cron.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.psychologicalProfileUpdate = 'registered';
logger.info(
  { cron: deps.config.psychologicalProfileUpdaterCron, timezone: deps.config.proactiveTimezone },
  'psychological.profile.cron.scheduled',
);
```

### File: `src/config.ts` (Plan 38-03 — 1 line addition)

**Verified line 87 pattern:** `profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0'),`

**Phase 38 addition (mirror after line 87):**
```typescript
// M011 Phase 38 PGEN-05 — psychological profile updater cron.
// Default '0 9 1 * *' = 1st of month at 09:00 in config.proactiveTimezone.
// UNCONDITIONAL fire per PGEN-06 (inverse of M010 GEN-07 hash-skip idempotency).
// PGEN-05 D-28 fail-fast: invalid PSYCHOLOGICAL_PROFILE_UPDATER_CRON throws at
// module load (silent-bad-cron M008 EPI-04 incident class).
psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *'),
```

### File: `src/index.ts` (Plan 38-03 — 3 modifications)

**Verified existing shape:**

| Line | Phase 38 action |
|------|-----------------|
| 14 | Add import: `import { updateAllPsychologicalProfiles } from './memory/psychological-profile-updater.js';` (mirror line 14 — operational orchestrator) |
| 72 | Add `/health` field: `psychological_profile_cron_registered: effectiveCronStatus?.psychologicalProfileUpdate === 'registered',` — mirror line 72 exact shape. Verbatim snake_case key per PGEN-05 |
| 94-104 | `registerCrons({...})` deps — add `runPsychologicalProfileUpdate: () => updateAllPsychologicalProfiles(),` mirror of line 103 |

### File: `src/rituals/__tests__/cron-registration.test.ts` (Plan 38-03 — extension)

**Existing tests at lines 49-200 — Phase 38 extends with 4 new tests (mirror lines 135-200 — M010 cron tests):**

1. **"registers the psychological profile updater cron at 1st-of-month 09:00 Europe/Paris (PGEN-05)"** — assert `scheduleSpy.mock.calls.find(c => c[0] === '0 9 1 * *')` exists with `{timezone: 'Europe/Paris'}`; `status.psychologicalProfileUpdate === 'registered'`
2. **"runPsychologicalProfileUpdate dep is wired into the psych-cron handler"** — invoke the handler from `scheduleSpy.mock.calls.find(...)` and assert `runPsychologicalProfileUpdate.toHaveBeenCalledTimes(1)`
3. **"psych-cron handler isolates errors — throwing runPsychologicalProfileUpdate does NOT propagate; logs 'psychological.profile.cron.error'"** — CRON-01 belt-and-suspenders; mirror lines 177-203
4. **"M010 + M011 crons do not collide at the same minute over the next 12 months (D-27)"** — see §"Validation Architecture" cron-collision test design below

**`baseConfig` at lines 37-47 must gain `psychologicalProfileUpdaterCron: '0 9 1 * *'`.**

### File: `src/__tests__/config.test.ts` (Plan 38-03 — extension)

**Phase 38 adds 2 tests (mirror existing M010 `profileUpdaterCron` tests):**
1. Throws `Error: config: invalid PSYCHOLOGICAL_PROFILE_UPDATER_CRON expression "..."` when env var is set to an invalid expression
2. Defaults to `'0 9 1 * *'` when env var is unset

---

## Plan 38-01: Shared Prompt Builder — File Skeleton (mirrors `profile-prompt.ts`)

```typescript
// src/memory/psychological-profile-prompt.ts (NEW; Plan 38-01)
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';
import { DO_NOT_INFER_DIRECTIVE } from './profile-prompt.js';      // D-06 — one source of truth
import type { PsychologicalProfileType } from './profiles/psychological-shared.js';

// Plan 38-01 caveat: `attachment` is in the Phase 37 union but D-23 defers attachment
// generator to v2.6.1. We declare a NARROWER union for Phase 38:
export type PsychologicalProfilePromptType = 'hexaco' | 'schwartz';

export type AssembledPsychologicalProfilePrompt = { system: string; user: string };

// Pure structural slice — mirrors `ProfileSubstrateView` in profile-prompt.ts
// but with psychological-substrate fields per Phase 37's discriminated union.
export type PsychologicalProfileSubstrateView = {
  corpus: ReadonlyArray<{
    id: string;
    epistemicTag: string | null;
    content: string;
    createdAt: Date;
  }>;
  episodicSummaries: ReadonlyArray<{
    summaryDate: string;
    summary: string;
  }>;
  wordCount: number;
};

// D-07 — Hard Rule D027 extension, INLINE in this file (NOT in personality.ts).
// Phrasing locked per CONTEXT.md D-07. Phase 39 will re-export this for the
// surface-level injection (PSURF-02 reuses the same constant).
export const PSYCHOLOGICAL_HARD_RULE_EXTENSION = [
  '## Psychological Profile Framing (D027 extension — REQUIRED)',
  '',
  'These trait scores describe statistical tendencies inferred from speech patterns,',
  'NOT facts about who Greg is. You MUST NOT:',
  '- Use these scores to tell Greg he is "the kind of person who..."',
  '- Appeal to his trait scores as evidence that his current reasoning is correct',
  '- Construct advice that validates his existing position by citing his personality',
  'The Hard Rule (D027) applies here with additional force: psychological traits are',
  'not evidence. Evaluate every claim on its merits regardless of what the profile says.',
].join('\n');

// D-10 — per-profile-type directive blocks
const PROFILE_TYPE_DIRECTIVES: Record<PsychologicalProfilePromptType, string> = {
  hexaco: [
    '## Profile Focus — HEXACO Big-Six Personality',
    'For this profile, infer Greg\'s HEXACO Big-Six scores across all 6 dimensions',
    '(honesty-humility, emotionality, extraversion, agreeableness, conscientiousness,',
    'openness). The 6 HEXACO dimensions are one theoretical framework; coherent',
    'inference requires considering all 6 together, not independently. Speech-based',
    'personality inference accuracy bound is r ≈ .31–.41; confidence should reflect',
    'this ceiling, not project precision the substrate cannot support.',
  ].join('\n'),
  schwartz: [
    '## Profile Focus — Schwartz Universal Values',
    'For this profile, infer Greg\'s Schwartz value priorities across all 10 universal',
    'values (self-direction, stimulation, hedonism, achievement, power, security,',
    'conformity, tradition, benevolence, universalism). The 10 values are arranged',
    'in a circular motivational continuum; coherent inference acknowledges opposing-value',
    'tradeoffs (e.g. Self-Direction ↔ Conformity). Speech-based value inference',
    'accuracy bound is r ≈ .31–.41; confidence should reflect this ceiling.',
  ].join('\n'),
};

export function assemblePsychologicalProfilePrompt(
  profileType: PsychologicalProfilePromptType,
  substrate: PsychologicalProfileSubstrateView,
  prevState: unknown | null,
  wordCount: number,
): AssembledPsychologicalProfilePrompt {
  const sections: string[] = [];

  // 1. CONSTITUTIONAL_PREAMBLE (D-05; structural test asserts startsWith)
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — psychological-trait-inference framing
  sections.push(buildRolePreamble(profileType));

  // 3. DO_NOT_INFER_DIRECTIVE (D-06 — imported from M010, NOT redeclared)
  sections.push(DO_NOT_INFER_DIRECTIVE);

  // 4. Hard Rule D027 extension (D-07 — INLINE constant defined above)
  sections.push(PSYCHOLOGICAL_HARD_RULE_EXTENSION);

  // 5. Word-count framing (D-08; replaces M010 volume-weight ceiling)
  sections.push(buildWordCountFraming(wordCount));

  // 6. Previous-state injection (D-09 — conditional)
  if (prevState !== null) {
    sections.push(buildPreviousStateBlock(prevState));
  }

  // 7. Profile-type directive (D-10)
  sections.push(PROFILE_TYPE_DIRECTIVES[profileType]);

  // 8. Substrate block — corpus + episodic + wordCount
  sections.push(buildSubstrateBlock(substrate));

  // 9. Structured-output directive (last)
  sections.push(buildStructuredOutputDirective(profileType));

  return {
    system: sections.join('\n\n'),
    user: `Generate the ${profileType.toUpperCase()} psychological profile for Greg.`,
  };
}

// ... private section builders below (mirror profile-prompt.ts:227-377 shape)
```

**Structural test assertions (mirror `src/memory/__tests__/profile-prompt.test.ts`):**

For BOTH `hexaco` and `schwartz`:
- `system.startsWith('## Core Principles (Always Active)')` (D-05)
- `system.includes(DO_NOT_INFER_DIRECTIVE)` (D-06)
- `system.includes(PSYCHOLOGICAL_HARD_RULE_EXTENSION)` (D-07)
- `system.includes('## Psychological Profile Framing (D027 extension — REQUIRED)')`
- `system.includes('## Profile Focus — HEXACO')` for `hexaco`; `system.includes('## Profile Focus — Schwartz')` for `schwartz`
- `system.includes('r ≈ .31–.41')` (empirical-limits framing per D-10)
- `system.includes('data_consistency')` (host-emit contract per D-08)
- `prevState=null` → `!system.includes('## CURRENT PROFILE STATE')`
- `prevState!=null` → `system.includes('## CURRENT PROFILE STATE')` AND `system.includes(JSON.stringify(prevState, null, 2))`
- `user === 'Generate the HEXACO psychological profile for Greg.'` for hexaco; same with SCHWARTZ for schwartz

---

## Plan 38-02: Two Generators + 3-Cycle Integration Test

### Generator skeleton (mirror `jurisdictional.ts`)

```typescript
// src/memory/profiles/hexaco.ts (NEW; Plan 38-02)
import {
  HexacoProfileSchemaV3,
  HexacoProfileSchemaV4,
  type HexacoProfileData,
} from './psychological-schemas.js';
import { profileHexaco } from '../../db/schema.js';
import {
  runPsychologicalProfileGenerator,           // NEW — extracted helper if D-11 extraction taken
  type PsychologicalProfileGeneratorConfig,
  type PsychologicalProfileGenerationOutcome,
  type PsychologicalSubstrate,
} from './psychological-shared.js';

function flattenHexacoOutput(parsed: HexacoProfileData): Record<string, unknown> {
  return {
    honestyHumility: parsed.honesty_humility,
    emotionality: parsed.emotionality,
    extraversion: parsed.extraversion,
    agreeableness: parsed.agreeableness,
    conscientiousness: parsed.conscientiousness,
    openness: parsed.openness,
  };
}

const HEXACO_PROFILE_CONFIG: PsychologicalProfileGeneratorConfig<HexacoProfileData> = {
  profileType: 'hexaco',
  v3Schema: HexacoProfileSchemaV3,
  v4Schema: HexacoProfileSchemaV4,            // Plan 38-02 extends with data_consistency + overall_confidence per Finding 1
  table: profileHexaco,
  profileTableName: 'profile_hexaco',
  flattenSonnetOutput: flattenHexacoOutput,
};

export async function generateHexacoProfile(
  deps: { substrate: PsychologicalSubstrate<HexacoProfileData> },
): Promise<PsychologicalProfileGenerationOutcome> {
  return runPsychologicalProfileGenerator(HEXACO_PROFILE_CONFIG, deps.substrate);
}

export { HEXACO_PROFILE_CONFIG };
```

`src/memory/profiles/schwartz.ts` mirrors this with `flattenSchwartzOutput` mapping the 10 snake_case values to camelCase + `SCHWARTZ_PROFILE_CONFIG` using `SchwartzProfileSchemaV3/V4` + `profileSchwartz` table + `profileTableName: 'profile_schwartz'`.

### `runPsychologicalProfileGenerator` body (where to fork from M010's `runProfileGenerator`)

Reference: `src/memory/profiles/shared.ts:363-565`. Phase 38 changes:

**Step 1 — Threshold check (DIFFERENT shape per Finding 4):**
```typescript
if (substrate.belowThreshold) {                                       // ← discriminated union narrow
  logger.info(
    { profileType, wordCount: substrate.wordCount, neededWords: substrate.neededWords, threshold: MIN_SPEECH_WORDS },
    `chris.psychological.${profileType}.skipped_below_threshold`,
  );
  return { profileType, outcome: 'skipped_below_threshold', wordCount: substrate.wordCount, durationMs: Date.now() - startMs };
}
// Below this line, TypeScript narrows substrate to `{belowThreshold: false, corpus, episodicSummaries, wordCount, prevHistorySnapshot}`
```

**Step 2 — Read current row (mirror lines 386-391 verbatim, substituting `config.table`).**

**Step 3 — Compute substrate hash (mirror lines 393-394 with new `computePsychologicalSubstrateHash`).**

**Step 4 — DELETE the hash-skip branch entirely (lines 399-409 in M010 — UNCONDITIONAL FIRE per PGEN-06).** This is the **single most important divergence in Phase 38**.

**Step 5 — DELETE the `.refine()` closure overlay (lines 411-420 in M010 per D-33).** Use the v4-Sdk-extended schema directly (per Finding 1).

**Step 6 — Build prompt with `prevHistorySnapshot` (NOT `extractPrevState(currentRow)` — Finding 3):**
```typescript
const view: PsychologicalProfileSubstrateView = {
  corpus: substrate.corpus.map(e => ({...})),                // adapter to readonly structural shape
  episodicSummaries: substrate.episodicSummaries.map(s => ({...})),
  wordCount: substrate.wordCount,
};
const prompt = assemblePsychologicalProfilePrompt(
  config.profileType,
  view,
  substrate.prevHistorySnapshot,                              // ← from Phase 37 substrate loader; NOT from current row
  substrate.wordCount,
);
```

**Step 7 — Sonnet call (mirror `shared.ts:457-480` verbatim):**
```typescript
const response = await anthropic.messages.parse({
  model: SONNET_MODEL,
  max_tokens: 4000,                                           // larger than M010's 2000 — HEXACO has 6 dims + Schwartz 10 vs M010's 4-8 fields per dim
  system: [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }],
  messages: [{ role: 'user' as const, content: prompt.user }],
  output_config: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(config.v4SchemaSdk as unknown as any),   // Plan 38-02 attaches extended schema here
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error(`${config.profileType}.psychological.sonnet: parsed_output is null`);
}
```

**Step 8 — v3 re-validate (mirror `shared.ts:487` verbatim).**

**Step 9 — Write-before-upsert (mirror `shared.ts:495-501` verbatim — only the `profileTableName` literal changes).**

**Step 10 — Upsert (mirror `shared.ts:514-539` verbatim with column substitutions for HEXACO/Schwartz):**
```typescript
const upsertValues: Record<string, unknown> = {
  name: 'primary',
  schemaVersion: prevStateMeta.schema_version,
  substrateHash: computedHash,                                // recorded BUT not used for skip (PGEN-06)
  overallConfidence: sonnetOut.overall_confidence,            // host stores Sonnet-emitted value verbatim per D-08
  wordCount: substrate.wordCount,                             // updated each fire
  wordCountAtLastRun: substrate.wordCount,                    // PSCH-08 metadata column
  ...flatEncoded,
  lastUpdated: new Date(),
};
await db.insert(config.table).values(upsertValues as any).onConflictDoUpdate({...});
```

NOTE: M011 profile tables do NOT have a `data_consistency` column (verified `src/db/schema.ts:662-712`) — Sonnet's `data_consistency` field is consumed only by the prompt's audit semantics (Sonnet self-reports it; host can log it but does not persist it in v1 — `overall_confidence` is the persisted field per D-08).

**Step 11 — Log + return outcome (mirror lines 541-551 with `chris.psychological.${profileType}.updated`).**

### 3-cycle integration test skeleton (Plan 38-02; HARD CO-LOC)

File: `src/memory/__tests__/psychological-profile-updater.integration.test.ts`

Mirror structure of `src/memory/profiles/__tests__/generators.two-cycle.test.ts:209-380` (extension below).

**Docblock per D-35 — phrasing locked:**
```typescript
/**
 * CRITICAL: This test is the INVERSE of M010's PTEST-03 idempotency test.
 * M010 PTEST-03 asserts hash-skip behavior (cumulative 4 calls after Cycle 2
 * with identical substrate). M011 PMT-05 asserts UNCONDITIONAL FIRE (cumulative
 * 4 calls after Cycle 2 — same number but different semantics). If a future
 * refactor introduces hash-skip "for consistency with M010", this test fails.
 * Do NOT "fix" the test — the divergence is intentional per PGEN-06.
 */
```

**Mock setup (mirror lines 50-79 — same hoisted `mockAnthropicParse` + `mockLoggerInfo` pattern):**
```typescript
const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));
vi.mock('../../llm/client.js', async (importOriginal) => { ... });
vi.mock('../../utils/logger.js', () => ({ logger: {info: mockLoggerInfo, ...} }));
```

**Prime mocks (mirror lines 187-205 — route by prompt content):**
```typescript
function primeAllProfileTypesValid() {
  mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
    const systemText = req.system?.[0]?.text ?? '';
    if (systemText.includes('## Profile Focus — HEXACO')) {
      return Promise.resolve(validHexacoResponse());        // realistic 6-dim payload + overall_confidence: 0.6 + data_consistency: 0.5
    }
    if (systemText.includes('## Profile Focus — Schwartz')) {
      return Promise.resolve(validSchwartzResponse());      // realistic 10-value payload
    }
    throw new Error(`...`);
  });
}
```

**Cycle 1 (T=0, populated substrate):**
```typescript
// Seed 6000 words of telegram entries spread across the previous calendar month
// (e.g., now=2026-05-15 → window = 2026-04-01..2026-04-30, all source='telegram')
await seedTelegramCorpus({ words: 6000, days: 30, source: 'telegram' });
primeAllProfileTypesValid();
vi.setSystemTime(new Date('2026-05-01T09:00:00+02:00'));  // 1st of month, Paris

await updateAllPsychologicalProfiles();

expect(mockAnthropicParse).toHaveBeenCalledTimes(2);
const hexacoRow = (await db.select().from(profileHexaco).limit(1))[0];
const schwartzRow = (await db.select().from(profileSchwartz).limit(1))[0];
expect(hexacoRow.overallConfidence).toBeGreaterThan(0);
expect(schwartzRow.overallConfidence).toBeGreaterThan(0);
expect(hexacoRow.substrateHash).toMatch(/^[0-9a-f]{64}$/);
expect(schwartzRow.substrateHash).toMatch(/^[0-9a-f]{64}$/);
const historyAfterC1 = await db.select().from(profileHistory)
  .where(or(eq(profileHistory.profileTableName, 'profile_hexaco'), eq(profileHistory.profileTableName, 'profile_schwartz')));
expect(historyAfterC1).toHaveLength(2);
```

**Cycle 2 (T+1 month, IDENTICAL substrate — UNCONDITIONAL fire assertion):**
```typescript
// Do NOT mutate the corpus. Phase 37 substrate loader will see same corpus
// (the calendar-month boundary moves with `now`, but the seeded entries are
// in the previous month for THIS `now` too — see test fixture comment).
vi.setSystemTime(new Date('2026-06-01T09:00:00+02:00'));  // 1st of NEXT month

await updateAllPsychologicalProfiles();

// CRITICAL — INVERSE-OF-IDEMPOTENCY ASSERTION
expect(mockAnthropicParse).toHaveBeenCalledTimes(4);         // ← NOT 2 — UNCONDITIONAL FIRE per PGEN-06
const historyAfterC2 = await db.select().from(profileHistory)
  .where(or(eq(profileHistory.profileTableName, 'profile_hexaco'), eq(profileHistory.profileTableName, 'profile_schwartz')));
expect(historyAfterC2).toHaveLength(4);                       // 2 from C1 + 2 from C2
// hash should be the SAME as C1 (substrate identical) — but Sonnet was still called
expect(hexacoRow_afterC2.substrateHash).toBe(hexacoRow_afterC1.substrateHash);
```

⚠️ **CAVEAT on test fixture design:** Phase 37's `loadPsychologicalSubstrate` reads from the PREVIOUS calendar month. For the 3-cycle test to actually exercise "identical substrate" between cycles, the seeded entries must live in a window that the calendar-month boundary will continue to include across cycles — OR the test must reseed identical entries in each cycle's previous-month window. The planner should design fixtures around either (a) inserting the same corpus into different month windows for C1/C2/C3 OR (b) clarifying that "identical substrate" semantically means "Sonnet receives the same prompt" via a more flexible mock. **Recommend (a):** seed corpus into Apr 2026, advance time to May 1 (C1 reads April), seed identical corpus into May 2026, advance to June 1 (C2 reads May = identical hash), seed mutated corpus into June 2026, advance to July 1 (C3 reads June = different hash). This is the cleanest realization of "identical substrate" semantics.

**Cycle 3 (T+2 months, MUTATED substrate):**
```typescript
// Mutate by inserting NEW telegram entries into the relevant month
await db.insert(pensieveEntries).values([...5 new entries with new content...]);
vi.setSystemTime(new Date('2026-07-01T09:00:00+02:00'));

await updateAllPsychologicalProfiles();

expect(mockAnthropicParse).toHaveBeenCalledTimes(6);          // cumulative 6 calls
const historyAfterC3 = await db.select().from(profileHistory).where(...);
expect(historyAfterC3).toHaveLength(6);
expect(hexacoRow_afterC3.substrateHash).not.toBe(hexacoRow_afterC2.substrateHash);  // hash CHANGED (substrate mutated)
```

**Bonus assertion — `Promise.allSettled` isolation:** include a 4th `it()` block where one generator throws (e.g., HEXACO Sonnet mock rejects); assert Schwartz still completes successfully with `outcome: 'updated'` and HEXACO's outcome is `'error'` (per PGEN-04).

---

## Plan 38-03: Orchestrator + Cron + Config + /health

### Orchestrator skeleton (mirror `profile-updater.ts`)

```typescript
// src/memory/psychological-profile-updater.ts (NEW; Plan 38-03)
import { logger } from '../utils/logger.js';
import { loadPsychologicalSubstrate } from './profiles/psychological-shared.js';
import { generateHexacoProfile } from './profiles/hexaco.js';
import { generateSchwartzProfile } from './profiles/schwartz.js';
import type { PsychologicalProfileGenerationOutcome } from './profiles/psychological-shared.js';

export async function updateAllPsychologicalProfiles(): Promise<void> {
  // D-18 — UNCONDITIONAL-FIRE rationale comment (phrasing locked, planner may polish):
  //
  //   Divergence from M010 GEN-07 (operational profile-updater.ts): psychological
  //   profiles fire UNCONDITIONALLY on the monthly cron. A skipped month creates
  //   a permanent gap in the inter-period consistency time series; trait inference
  //   needs a data point every month. substrate_hash is recorded on each fire for
  //   audit-trail / forensic-replay only — NOT used for short-circuit.
  //
  const startMs = Date.now();
  try {
    // D-24: substrate loaded TWICE per fire (one per profile type) for the
    // per-profile-type prevHistorySnapshot. The corpus query is identical for
    // both types; postgres caches the second invocation.
    const now = new Date();
    const [hexacoSubstrate, schwartzSubstrate] = await Promise.all([
      loadPsychologicalSubstrate('hexaco', now),
      loadPsychologicalSubstrate('schwartz', now),
    ]);

    // Log start (mirror profile-updater.ts:70-77; pick the wordCount from either
    // — they're identical because the corpus query is identical)
    const startWordCount = hexacoSubstrate.belowThreshold ? hexacoSubstrate.wordCount : hexacoSubstrate.wordCount;
    logger.info(
      { wordCount: startWordCount, threshold: MIN_SPEECH_WORDS, belowThreshold: hexacoSubstrate.belowThreshold },
      'chris.psychological.cron.start',
    );

    // D-21: Promise.allSettled — per-generator error isolation.
    // Attachment NOT included per D-23 (deferred to v2.6.1 / ATT-POP-01).
    const results = await Promise.allSettled([
      generateHexacoProfile({ substrate: hexacoSubstrate }),
      generateSchwartzProfile({ substrate: schwartzSubstrate }),
    ]);

    // Discriminated outcome aggregation (mirror profile-updater.ts:93-121)
    // 3 outcome cases (no skipped_no_change because no hash-skip per PGEN-06)
    const counts = { updated: 0, belowThreshold: 0, error: 0 };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const o: PsychologicalProfileGenerationOutcome = r.value;
        switch (o.outcome) {
          case 'updated': counts.updated += 1; break;
          case 'skipped_below_threshold': counts.belowThreshold += 1; break;
          case 'error': counts.error += 1; break;
        }
      } else {
        logger.warn(
          { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
          'chris.psychological.profile_generation_failed',
        );
        counts.error += 1;
      }
    }

    logger.info(
      { counts, durationMs: Date.now() - startMs },
      'chris.psychological.cron.complete',
    );
  } catch (err) {
    // CRON-01 outer try/catch (mirror profile-updater.ts:128-141)
    logger.error(
      { err: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startMs },
      'psychological.profile.cron.error',
    );
  }
}
```

### Cron-collision unit test (D-27 — Plan 38-03 + cron-registration.test.ts extension)

Cite the existing `node-cron` API: `node-cron` exports `validate(expression): boolean` but does **NOT** expose a "next-fire date" helper directly. Two options for predicting next fires:

**Option A (recommend):** Use Luxon to enumerate the next 12 calendar-month firings of `'0 9 1 * *'` Europe/Paris and the next 12 Sunday-22:00 firings of `'0 22 * * 0'` Europe/Paris; assert no two fires fall in the same hour of the same day.

```typescript
// In src/rituals/__tests__/cron-registration.test.ts (extension)
import { DateTime } from 'luxon';

it('M010 + M011 crons do not collide at the same minute over the next 12 months (D-27)', () => {
  const start = DateTime.fromISO('2026-06-01T00:00:00', { zone: 'Europe/Paris' });

  // M011 monthly fires: 1st of each month at 09:00
  const m011Fires: DateTime[] = [];
  for (let i = 0; i < 12; i++) {
    m011Fires.push(start.plus({ months: i }).set({ hour: 9, minute: 0 }));
  }

  // M010 weekly fires: every Sunday at 22:00 over the same window
  const m010Fires: DateTime[] = [];
  let cursor = start.set({ weekday: 7, hour: 22, minute: 0 }); // first Sunday
  while (cursor < start.plus({ months: 12 })) {
    m010Fires.push(cursor);
    cursor = cursor.plus({ weeks: 1 });
  }

  // Assertion: no M011 fire is within the same hour as any M010 fire
  for (const m011 of m011Fires) {
    for (const m010 of m010Fires) {
      const diffMs = Math.abs(m011.toMillis() - m010.toMillis());
      const sameHour = diffMs < 60 * 60 * 1000;
      expect(sameHour, `M011 fire ${m011.toISO()} collides with M010 fire ${m010.toISO()}`).toBe(false);
    }
  }
});
```

The math is trivial: M011 fires at 09:00 on the 1st; M010 fires at 22:00 on Sundays. Even when the 1st is a Sunday, the fires are 13 hours apart. The test serves as a regression detector if either expression drifts.

**Option B (rejected):** Some libraries expose a `cron-parser` package that returns `next()` dates. **Not needed** — Luxon already in the project (`src/memory/profiles/psychological-shared.ts:46`). Zero new dependencies (per STACK.md). Don't add `cron-parser`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Word counting in substrate | Custom tokenizer / `messages.countTokens` | Phase 37 already shipped `psychological-shared.ts:124-126` `countWords(text)` private helper; the gate is in `loadPsychologicalSubstrate` BEFORE the substrate returns | Pitfall 2 — Russian token-inflation 1.5–2.5× would bias the floor against Cyrillic; whitespace is right |
| SHA-256 substrate hash | Custom hash | `node:crypto`'s `createHash('sha256')` — already in M010 `shared.ts:53,310` | Already proven; STACK.md confirms no new dependency |
| Substrate canonical JSON | Sorted-key stringify yourself | Mirror M010's `canonicalSubstrateJson` at `shared.ts:265-278` with M011-appropriate field set (no decisions) | Hand-rolled JSON ordering is bug-prone; this 14-line helper is the reference |
| Cron next-fire prediction | `cron-parser` package | Luxon `plus({ months: 1 })` / Luxon weekday arithmetic | STACK.md confirms zero new deps; Luxon already used |
| Calendar-month boundary | Date arithmetic with `* 1000 * 60 * 60 * 24 * 30` | Phase 37 already shipped `DateTime.fromJSDate(now, {zone: 'Europe/Paris'}).startOf('month').minus({ months: 1 })` at `psychological-shared.ts:166-168` — Phase 38 does NOT re-implement | DST-safety + month-length variance |
| Sonnet structured-output schema enforcement | Custom JSON schema generation | `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` — verbatim from M010 `shared.ts:58,478` | Phase 37 ships v4 schemas; Phase 38 attaches the SDK helper |
| 3-cycle test cleanup | `DELETE FROM ...` chains | M010 pattern at `generators.two-cycle.test.ts:100-108` — `TRUNCATE TABLE pensieve_entries CASCADE` + `db.delete(profileHistory)` | Canonical project pattern |
| Mock Anthropic in tests | `nock`/`msw` HTTP mock | `vi.hoisted` + `vi.mock('../../llm/client.js')` pattern — see `generators.two-cycle.test.ts:52-70` | Project convention; lets the mock route by inspecting the assembled prompt content |
| Fake timers in DB-backed tests | `vi.useFakeTimers` | Pass `now: Date` explicitly to substrate loader (`loadPsychologicalSubstrate(profileType, now)` already accepts) — same pattern as M010 `loadProfileSubstrate(now)` at `shared.ts:206` | `vi.useFakeTimers` clashes with `postgres` driver's internal `setTimeout/setInterval` — see comment in `generators.two-cycle.test.ts:14-19` |

**Key insight:** Every "build it myself" candidate in Phase 38 already has a verbatim precedent in M010 Phase 34 or Phase 37 deliverables. The only NEW code is the prompt content (D-07, D-08, D-09, D-10), the orchestrator's unconditional-fire shape (no hash-skip), and the schema extension for `data_consistency` + `overall_confidence` (Finding 1).

---

## Common Pitfalls (synthesized from `.planning/research/PITFALLS.md` + lessons from M010 shipping)

### Pitfall 1: Hash-skip branch reintroduced "for consistency with M010"

**What goes wrong:** A future refactor sees `computePsychologicalSubstrateHash` is called, the hash is stored, but never used for control flow, and "fixes" it by re-adding `if (currentRow.substrateHash === computedHash) return skip` — which silently breaks PGEN-06 and creates the same inter-period-gap bug PMT-05 is built to detect.

**Why it happens:** Pattern matching against M010 + assuming all "hash computation" implies "hash-skip semantics."

**How to avoid:**
1. The unconditional-fire rationale comment (D-18) at the TOP of `updateAllPsychologicalProfiles()` documents the divergence
2. The 3-cycle integration test (D-34/D-35) is the regression detector — Cycle 2's `expect(mockAnthropicParse).toHaveBeenCalledTimes(4)` (NOT 2) fails immediately if hash-skip is reintroduced
3. The test docblock (D-35) explicitly says "Do NOT 'fix' the test — the divergence is intentional per PGEN-06"

**Warning signs:** Generator body contains `if (currentRow && currentRow.substrateHash === computedHash)`. Generator returns outcome `'skipped_no_change'`. Cycle 2 of integration test shows only 2 calls.

### Pitfall 2: Schema gap silently caps `overall_confidence` at 0

**What goes wrong:** Plan 38-02 ships generators that consume the unmodified Phase 37 v4 schema (`HexacoProfileSchemaV4` at `psychological-schemas.ts:93-100`). The schema has no `overall_confidence` field, so Sonnet's structured output omits it. The generator writes `overallConfidence: sonnetOut.overall_confidence` → `undefined` → Postgres CHECK violation OR stored as default 0 → integration test fails on `expect(hexacoRow.overallConfidence).toBeGreaterThan(0)`.

**Why it happens:** Phase 37 ships v4 schemas for the row shape (per-dim); Phase 38 needs the v4 schema for the Sonnet OUTPUT shape (per-dim + top-level meta fields). These are DIFFERENT contracts. See Finding 1 above.

**How to avoid:** Plan 38-02 explicitly extends or constructs SDK-boundary v4 schemas with `data_consistency: zV4.number().min(0).max(1)` and `overall_confidence: zV4.number().min(0).max(1)` at the top level. The structural test for the prompt builder asserts the prompt includes the phrase `data_consistency` AND `overall_confidence` so Sonnet is told what to emit.

**Warning signs:** Integration test fails on `overallConfidence > 0`. Generator's v3 re-validate throws "expected number, got undefined" on `overall_confidence`. Cycle 1 history-row snapshot contains `overallConfidence: 0` (default).

### Pitfall 3: D047 boundary contamination (`psych-boundary-audit.test.ts` failure)

**What goes wrong:** Phase 37 shipped `psych-boundary-audit.test.ts` (PSCH-10) which fails the build if `\b(jurisdictional|capital|health|family)\b` appears in any `src/memory/**/psychological-*.ts` file. Phase 38 generators import from `profile-prompt.ts` (D-06 — `DO_NOT_INFER_DIRECTIVE`), but if a generator accidentally imports `assembleProfilePrompt` or `ProfilePromptDimension` or any of the per-dimension directive blocks, the audit fails.

**Why it happens:** Plan 38-01 imports `DO_NOT_INFER_DIRECTIVE` from `profile-prompt.ts` — Plan 38-02 generators may follow that import path and pull in too much.

**How to avoid:**
1. Plan 38-01 imports ONLY `DO_NOT_INFER_DIRECTIVE` from `profile-prompt.ts` — explicit named import (no `import *`)
2. Generators import ONLY from `psychological-shared.ts` + `psychological-schemas.ts` + their own profile-type schema
3. Run `bash scripts/test.sh src/memory/profiles/__tests__/psych-boundary-audit.test.ts` per task in CI

**Warning signs:** Audit test failure with message naming an operational token. Generator file containing the word `'jurisdictional'` even in a comment.

### Pitfall 4: Substrate loaded once when D-24 says twice

**What goes wrong:** Orchestrator calls `loadPsychologicalSubstrate('hexaco', now)` once and passes the result to BOTH generators. The HEXACO generator sees the correct `prevHistorySnapshot` (the last `profile_history` row with `profileTableName='profile_hexaco'`). The Schwartz generator ALSO sees the HEXACO snapshot — wrong source.

**Why it happens:** The corpus + episodic + wordCount fields are identical across profile types (same source filter, same calendar month). The "load once" optimization is tempting. D-24 explicitly defers this optimization.

**How to avoid:** Orchestrator must call `loadPsychologicalSubstrate` exactly TWICE — once per profile type — per D-24. The 3-cycle integration test could add an assertion to detect this: after Cycle 1, assert that the HEXACO row's history snapshot is non-null AND distinct in shape from the Schwartz history snapshot (they reference different `profile_history` rows by `profile_table_name`).

**Warning signs:** Orchestrator with one `await loadPsychologicalSubstrate(...)` call. Schwartz generator receiving a substrate where `prevHistorySnapshot` keys are HEXACO dimension names.

### Pitfall 5: Test fixture lives in a window that scrolls out

**What goes wrong:** Phase 37 substrate reads the PREVIOUS calendar month. A fixture seeded at `now-30d` for Cycle 1 will not be in the previous-month window for Cycle 2 at `now+30d` — Cycle 2 reads month `now-30d..now`, which is empty. Result: Cycle 2 returns `belowThreshold: true` → 0 Sonnet calls → assertion `expect(mockAnthropicParse).toHaveBeenCalledTimes(4)` fails (counts 2, not 4).

**How to avoid:** Per fixture-design recommendation in Plan 38-02 section above: re-seed identical corpus into the relevant previous-month window for each cycle, OR use `vi.setSystemTime` to anchor `now` in a fixed calendar position relative to the seeded corpus's `createdAt`. Recommend the former for the unconditional-fire test (cleaner semantics).

**Warning signs:** Cycle 2 assertion fails with `mockAnthropicParse called 2 times, expected 4`. Cycle 2 outcomes show `'skipped_below_threshold'` instead of `'updated'`.

### Pitfall 6: `/health` field name typo (`psychological_profile_cron` vs `psychological_profile_cron_registered`)

**What goes wrong:** REQUIREMENTS PGEN-05 specifies the field VERBATIM as `psychological_profile_cron_registered` (snake_case). A typo to `psychologicalProfileCronRegistered` (camelCase) OR `psych_profile_cron_registered` (abbreviated) silently breaks the contract — the operator (Greg) checks `/health` post-deploy and sees no field by that name → cannot confirm registration.

**How to avoid:** Plan 38-03 explicitly lists the field name VERBATIM in the task acceptance criteria. The cron-registration test asserts the JSON response shape directly.

**Warning signs:** Operator-side post-deploy check fails ("can't see the field"). Health-handler unit test absent.

### Pitfall 7: Sonnet 4.6 emits `last_updated` as ISO datetime when the v4 schema requires `string()` (not `string().datetime()`)

**What goes wrong:** Phase 37 v4 dim schema at `psychological-schemas.ts:56` is `last_updated: zV4.string()` (NOT `.datetime()` — Phase 37 deliberately relaxed to allow Sonnet output flexibility). The v3 schema at `psychological-schemas.ts:46` is `last_updated: z.string().datetime()` (stricter). If Sonnet emits a non-ISO string, v4 passes but v3 re-validate at `shared.ts:487` fails → outcome `'error'`.

**How to avoid:** Two paths: (a) make v4 stricter (`.datetime()`) and trust the SDK to coerce; (b) Plan 38-02 host-injects `last_updated: new Date().toISOString()` per dim AFTER the v4 parse but BEFORE the v3 re-validate. Recommend (b) since the v4 schema accepts any string, the host has the right Date at the moment the Sonnet response returns, and `(b)` matches the D-32 caveat "the planner verifies whether Phase 37's v4 schema currently requires `last_updated` from Sonnet or accepts host-injection."

**Warning signs:** Generator returns `outcome: 'error'` with message "Invalid datetime" referencing `last_updated`. v3 re-validate throws but v4 parse succeeded.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x (per project standard, verified via `src/memory/profiles/__tests__/*.test.ts`) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `bash scripts/test.sh <path-to-test-file>` (single test, ~10-30s) |
| Full suite command | `bash scripts/test.sh` (Docker Postgres on port 5433 + full vitest run) |
| Phase gate | Full Docker suite green (per CLAUDE.md memory "Always run full Docker tests") |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PGEN-01 | `assemblePsychologicalProfilePrompt` includes CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE + Hard Rule D027 extension for both profile types | structural (pure-function; no DB/mocks) | `bash scripts/test.sh src/memory/__tests__/psychological-profile-prompt.test.ts` | ❌ Plan 38-01 creates |
| PGEN-01 | Previous-state injection present when `prevHistorySnapshot != null`, absent when null | structural | same | ❌ Plan 38-01 |
| PGEN-01 | Per-profile-type directive present (HEXACO cross-dim coherence framing; Schwartz circumplex framing); r ≈ .31–.41 ceiling language | structural | same | ❌ Plan 38-01 |
| PGEN-02 | HEXACO generator: 1 Sonnet call for 6 dims; v4 parse → v3 re-validate; upsert + `profile_history` write; outcome shape | unit (mocked Sonnet) | `bash scripts/test.sh src/memory/profiles/__tests__/hexaco.test.ts` | ❌ Plan 38-02 |
| PGEN-03 | Schwartz generator: same shape with 10 values | unit | `bash scripts/test.sh src/memory/profiles/__tests__/schwartz.test.ts` | ❌ Plan 38-02 |
| PGEN-04 | Orchestrator: `Promise.allSettled` isolates HEXACO failure from Schwartz | integration (mocked Sonnet, one rejects) | `bash scripts/test.sh src/memory/__tests__/psychological-profile-updater.integration.test.ts` | ❌ Plan 38-02 (HARD CO-LOC) |
| PGEN-06 | 3-cycle unconditional fire: C1=2, C2=4 cumulative, C3=6 cumulative; substrate_hash recorded each cycle | integration (real Docker Postgres + mocked Sonnet) | same as PGEN-04 | ❌ Plan 38-02 (HARD CO-LOC) |
| PGEN-06 | `profile_history` has 2/4/6 rows after C1/C2/C3 (write-before-upsert on EVERY fire, not just on hash-change) | integration row-count assertion | same | ❌ Plan 38-02 |
| PGEN-07 | Prompt includes JSON-stringified `prevHistorySnapshot` under `## CURRENT PROFILE STATE` | structural (Plan 38-01 test) | `bash scripts/test.sh src/memory/__tests__/psychological-profile-prompt.test.ts` | ❌ Plan 38-01 |
| PGEN-05 | Cron registered at `'0 9 1 * *'` Europe/Paris; `status.psychologicalProfileUpdate === 'registered'` | unit (vi.mock node-cron, spy on schedule) | `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` | ✓ EXISTS — Plan 38-03 EXTENDS with 4 new test cases |
| PGEN-05 | `runPsychologicalProfileUpdate` dep wired into the psych-cron handler; throwing dep does NOT propagate; logs `'psychological.profile.cron.error'` | unit | same | ✓ EXISTS — extension |
| PGEN-05 | M010 + M011 crons do NOT collide at same hour over next 12 months | unit (Luxon enumeration) | same | ✓ EXISTS — extension |
| PGEN-05 | `/health` reports `psychological_profile_cron_registered: true` after registration | unit (`createApp` with injected cronStatus) | `bash scripts/test.sh src/__tests__/index.health.test.ts` OR extension to cron-registration.test.ts | ⚠ partial — `createApp` exists; new test or extension needed |
| PGEN-05 | Config fail-fast on invalid `PSYCHOLOGICAL_PROFILE_UPDATER_CRON` env | unit (env-var cache-bust pattern) | `bash scripts/test.sh src/__tests__/config.test.ts` | ✓ EXISTS — Plan 38-03 EXTENDS |
| PSCH-10 (regression) | `psych-boundary-audit.test.ts` passes — no operational tokens in `psychological-*.ts` files | structural (regex grep) | `bash scripts/test.sh src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | ✓ EXISTS — Plan 38 must keep green |

### Sampling Rate

- **Per task commit:** `bash scripts/test.sh <affected-test-file>` (~10–30s)
- **Per wave merge:** `bash scripts/test.sh src/memory/` + `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` + `bash scripts/test.sh src/__tests__/config.test.ts` (~60s)
- **Phase gate:** Full Docker suite green — per CLAUDE.md memory `bash scripts/test.sh` (current baseline 1412 passed + 53 skipped target)

### Wave 0 Gaps

- [ ] `src/memory/__tests__/psychological-profile-prompt.test.ts` — covers PGEN-01 (Plan 38-01)
- [ ] `src/memory/profiles/__tests__/hexaco.test.ts` — covers PGEN-02 (Plan 38-02)
- [ ] `src/memory/profiles/__tests__/schwartz.test.ts` — covers PGEN-03 (Plan 38-02)
- [ ] `src/memory/__tests__/psychological-profile-updater.integration.test.ts` — covers PGEN-04 + PGEN-06 + PGEN-07 (Plan 38-02; HARD CO-LOC)
- [ ] Extensions to `src/rituals/__tests__/cron-registration.test.ts` — 4 new tests (Plan 38-03)
- [ ] Extension to `src/__tests__/config.test.ts` — 2 new tests (Plan 38-03)
- [ ] No framework install needed (vitest already configured; psql Docker target already in `scripts/test.sh`)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/sdk` | Sonnet structured-output via `messages.parse + zodOutputFormat` | ✓ | 0.90.x | — |
| `drizzle-orm` | Postgres queries (upsert + `profile_history` insert + reading `profile_*` rows) | ✓ | 0.45.x | — |
| `zod` (v3) | v3 re-validate step at SDK boundary | ✓ | 3.24.x | — |
| `zod/v4` subpath | v4 schema for `zodOutputFormat` | ✓ | (same package) | — |
| `node:crypto` | SHA-256 substrate hash | ✓ (Node built-in) | Node 22 | — |
| `node-cron` | 5th cron registration | ✓ | 4.2.x | — |
| `luxon` | DST-safe calendar-month boundaries; cron-collision next-fire enumeration | ✓ | 3.7.x | — |
| Docker Postgres (port 5433) | Real-DB integration test for `updateAllPsychologicalProfiles` 3-cycle test | ✓ (via `scripts/test.sh`) | 16 | — |
| `vitest` 4.x | Test runner | ✓ | 4.x | — |

**Missing dependencies with no fallback:** None. Zero new deps required per STACK.md and CONTEXT.md `canonical_refs`.

**Missing dependencies with fallback:** None.

---

## Project Constraints (from CLAUDE.md)

Read directly from `/home/claude/chris/CLAUDE.md` and project memory at `feedback_always_run_docker_tests.md`:

- **Always run full Docker tests** — never skip integration tests; always start real Postgres. Phase 38 integration test (`psychological-profile-updater.integration.test.ts`) MUST run against real Docker Postgres, not mocked DB.
- **Test command convention:** `bash scripts/test.sh` for full suite; `bash scripts/test.sh <path>` for targeted run.
- **Package manager:** pnpm (verified via `pnpm-lock.yaml` and lack of `package-lock.json`).
- **Boundary audit invariants:** `psych-boundary-audit.test.ts` (PSCH-10) MUST stay green throughout Phase 38 — no operational tokens (`jurisdictional|capital|health|family`) may appear in any `psychological-*.ts` file (including comments).
- **Live tests gated behind `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...`** — Phase 38 does NOT use live tests (deferred to Phase 40 / PMT-06 per D045/D046).
- **Live server access:** SSH to Proxmox (192.168.1.50) is available; cron registration verification post-deploy will run there (operator concern, not test concern).

---

## Code Examples — Verified Patterns to Mirror

### Pattern 1: Pure-function prompt assembler (mirror)

**Source:** `src/memory/profile-prompt.ts:175-223` (Phase 34 — operational).

Phase 38 mirror is the file skeleton in §"Plan 38-01" above. The 9-section ordering, the `sections.join('\n\n')` join, and the `{system, user}` return shape are all verbatim from M010.

### Pattern 2: `messages.parse + zodOutputFormat` call site (mirror verbatim)

**Source:** `src/memory/profiles/shared.ts:457-480`.

```typescript
const response = await anthropic.messages.parse({
  model: SONNET_MODEL,
  max_tokens: 2000,          // Plan 38-02: bump to 4000 — HEXACO has 6 dims + 6 confidences + meta; Schwartz 10+10
  system: [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }],
  messages: [{ role: 'user' as const, content: prompt.user }],
  output_config: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(v4WithRefine as unknown as any),
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error(`${profileType}.psychological.sonnet: parsed_output is null`);
}
```

### Pattern 3: v3-after-v4 re-validation (mirror)

**Source:** `src/memory/profiles/shared.ts:487`.

```typescript
const sonnetOut = config.v3Schema.parse(response.parsed_output);
// Plan 38-02: optionally inject `last_updated: new Date().toISOString()` per dim BEFORE this line
// if the planner decides on host-injection per Pitfall 7
```

### Pattern 4: Write-before-upsert with `profile_history` (mirror)

**Source:** `src/memory/profiles/shared.ts:495-501`.

```typescript
if (currentRow && currentRow.id) {
  await db.insert(profileHistory).values({
    profileTableName: config.profileTableName,           // 'profile_hexaco' or 'profile_schwartz'
    profileId: currentRow.id as string,
    snapshot: currentRow as Record<string, unknown>,
  });
}
// CRITICAL — D-29 — this happens on EVERY fire in Phase 38, including when substrate hash matches prior
// (unlike M010 where history is only written on `'profile_updated'` outcome, not on `'profile_skipped_no_change'`).
// Because Phase 38 has NO `'skipped_no_change'` outcome (PGEN-06 unconditional fire), history is written every cycle.
```

### Pattern 5: jsonb upsert with `sql\`...::jsonb\`` encoding (mirror verbatim)

**Source:** `src/memory/profiles/shared.ts:514-539`.

The pattern handles the Phase 37 table convention `jsonb('column').notNull().default(sql\`'null'::jsonb\`)` at `src/db/schema.ts:672-677` — JS `null` becomes Postgres jsonb `'null'::jsonb` (NOT SQL NULL). Mirror verbatim; the column set differs (6 HEXACO / 10 Schwartz dims) but the encoding is identical.

### Pattern 6: 3-cycle integration test structure (mirror; INVERT Cycle 2 assertion)

**Source:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts:209-380`.

Phase 38 mirror is in §"Plan 38-02 — 3-cycle integration test skeleton" above. The only structural diff: Cycle 2's `expect(mockAnthropicParse).toHaveBeenCalledTimes(N)` is inverted — M010 expects N stays at 4 (skip); M011 expects N grows to 4 cumulative (2 from C1 + 2 from C2 — unconditional fire).

### Pattern 7: Cron registration block (mirror verbatim with renames)

**Source:** `src/cron-registration.ts:178-193` (M010 profile cron block).

Phase 38 adds a sibling block at the END of `registerCrons` body — exact shape in §"File: src/cron-registration.ts" above.

### Pattern 8: `validatedCron` config helper (use verbatim)

**Source:** `src/config.ts:20-26`.

```typescript
function validatedCron(envKey: string, fallback: string): string {
  const expr = process.env[envKey] || fallback;
  if (!validate(expr)) {
    throw new Error(`config: invalid ${envKey} expression "${expr}"`);
  }
  return expr;
}
```

Phase 38 uses this verbatim — adds one new field at `src/config.ts:88` (per D-28).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 4 generators in M010 (one per operational dimension) | 2 generators in M011 (one per psychological profile type, each emitting all dims in one call) | Phase 38 (M011 ship) | Lower wall-clock cost (~20s vs ~40s); preserves cross-dimension coherence for HEXACO and Schwartz |
| Hash-skip idempotency (M010 GEN-07) | Unconditional monthly fire (M011 PGEN-06) | Phase 38 | Skipped months break inter-period consistency time series; trait inference needs monthly data point |
| `entryCount` threshold (M010 — 10 entries, anywhere) | `wordCount` threshold (M011 — 5000 words, Greg's `source='telegram'` speech) | Phase 37 PSCH-08 (substrate) → Phase 38 consumes | Empirically grounded; Russian/French speech not biased against (whitespace not token) |
| 60-day rolling window (M010) | Calendar-month previous-month window (M011) | Phase 37 substrate loader | DST-safe; aligns with monthly fire cadence |
| `data_consistency` Sonnet emit + host `computeProfileConfidence(entryCount, data_consistency)` (M010) | Sonnet emits `data_consistency` AND `overall_confidence` directly; host stores both verbatim (M011) | Phase 38 PGEN-07 + D-08 | Word count is the volume signal; `data_consistency` is the consistency signal; combining is Sonnet's job at the empirical r ≈ .31–.41 ceiling |
| Sonday 22:00 weekly cron (M010) | 1st-of-month 09:00 monthly cron (M011) | Phase 38 PGEN-05 | Aligns trait inference cadence with empirical slow-trait nature; no collision with operational cron |

**Deprecated/outdated for Phase 38:**
- M010's `.refine()` volume-weight ceiling at `shared.ts:417-420` — explicitly NOT used in Phase 38 per D-33
- M010's per-dimension hash-skip branch at `shared.ts:399-409` — explicitly NOT used in Phase 38 per PGEN-06 / D-17
- M010's `extractPrevState(row)` reading the current profile row for prevState — Phase 38 reads `prevHistorySnapshot` from the substrate loader instead (Finding 3 above)
- M010's `decisions` array in `ProfileSubstrate` — not in M011 substrate per Phase 37 PSCH-07 (corpus-only)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| (none) | All factual claims in this research are `[VERIFIED: codebase grep/Read tool inspection]` against `/home/claude/chris/` as of 2026-05-14. No `[ASSUMED]` claims. | — | — |

**The table is intentionally empty.** Every claim cites a verified file:line anchor in this repository (Phase 37 deliverables shipped 2026-05-13 per STATE.md / memory; M010 deliverables shipped per `.planning/milestones/v2.5-phases/34-inference-engine/` exports). The CONTEXT.md decisions are the contract surface; this research's job is to verify they map cleanly to the codebase. They do, with the 4 critical findings flagged in §"Critical Findings" — each is a known-gap-to-resolve, not an assumed-fact.

---

## Open Questions

1. **Should the SDK-boundary v4 schema variants (`HexacoProfileSchemaV4Sdk`, `SchwartzProfileSchemaV4Sdk`) live in `psychological-schemas.ts` (Phase 37 file) or in the new Phase 38 generator/helper file?**
   - What we know: Phase 37 `psychological-schemas.ts` is the canonical schema source; modifying it touches Phase 37 deliverables.
   - What's unclear: Whether D047 audit + the "Phase 37 shipped these schemas" historical record argues for keeping `psychological-schemas.ts` unchanged.
   - Recommendation: **Add the `Sdk` variants in `psychological-schemas.ts`** (Plan 38-02 modifies that file) — it's the same module that exports the base schemas, and treating "what Sonnet emits" as a Phase 38 concern keeps the SDK-boundary variants co-located with the Zod definitions. The audit test does not care about file content unless it contains operational tokens.

2. **Does the orchestrator's "load substrate twice per fire" (D-24) need a guard against the second load returning DIFFERENT corpus from the first (e.g., a new telegram entry arriving between the two queries within the same second)?**
   - What we know: The substrate query uses `lte(pensieveEntries.createdAt, windowEnd)` where `windowEnd = endOfMonth(previousMonth)`. A new entry arriving NOW (in current month) is not in the previous month, so it's excluded. The window is in the past — the two loads should be identical.
   - What's unclear: Edge case where `now` straddles a calendar-month boundary at the millisecond level (e.g., `now = 2026-05-31T23:59:59.999Z` vs `2026-06-01T00:00:00.001Z`).
   - Recommendation: Compute `now` ONCE at the top of `updateAllPsychologicalProfiles()` and pass the same value to both `loadPsychologicalSubstrate` calls. Already shown in the orchestrator skeleton above.

3. **Should the planner add a `--describe.skipIf` gate on the 3-cycle integration test if Docker Postgres is not available?**
   - What we know: CLAUDE.md memory says "always run full Docker tests; never skip." Most project integration tests have no skip gate.
   - Recommendation: NO skip gate — same convention as M010's `generators.two-cycle.test.ts`. Test failures from "Docker not running" are operator-visible.

4. **Does the `psychological.profile.cron.error` log key collide with the existing `chris.psychological.<profileType>.error` per-generator log key?**
   - What we know: Per-generator logs are `chris.psychological.hexaco.error` and `chris.psychological.schwartz.error` (D-14). Orchestrator outer try/catch uses `psychological.profile.cron.error` (lowercase, no `chris.` prefix — mirror convention at `profile-updater.ts:139`).
   - Recommendation: These are different keys at different namespaces (per-generator vs infra). No collision. Confirmed by M010 precedent where `chris.profile.<outcome>` and `profile.cron.error` coexist.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `src/memory/profile-prompt.ts:1-377` — operational prompt-assembler exemplar (Phase 38 fork target)
- `src/memory/profile-updater.ts:1-142` — operational orchestrator exemplar
- `src/memory/profiles/shared.ts:1-575` — M010 generator helper + substrate hash + write-before-upsert pattern
- `src/memory/profiles/jurisdictional.ts:1-91` — per-profile-type generator minimal-dispatch exemplar (M010)
- `src/memory/profiles/__tests__/generators.two-cycle.test.ts:1-380` — 3-cycle integration test pattern (M010); Phase 38 inverts Cycle 2 assertion
- `src/memory/profiles/psychological-shared.ts:1-235` — Phase 37 substrate loader (Phase 38 consumer contract)
- `src/memory/profiles/psychological-schemas.ts:1-150` — Phase 37 Zod v3+v4 dual schemas (Phase 38 SDK-boundary input; **Finding 1 gap**)
- `src/memory/profiles.ts:50-415` — `getPsychologicalProfiles` reader + `PSYCHOLOGICAL_PROFILE_SCHEMAS` dispatcher; metadata-strip pattern
- `src/cron-registration.ts:1-197` — cron registration template (Phase 38 modifies)
- `src/config.ts:1-89` — `validatedCron` helper + existing profile cron field pattern
- `src/index.ts:1-152` — `/health` handler + `registerCrons({...})` deps wiring site
- `src/rituals/__tests__/cron-registration.test.ts:1-200` — cron registration unit test pattern (Phase 38 extends with 4 new tests)
- `src/db/schema.ts:662-759` — `profile_hexaco`, `profile_schwartz`, `profile_attachment` tables + `profile_history` polymorphic discriminator + index `profile_history_table_recorded_idx`
- `src/memory/confidence.ts:99-124` — `MIN_SPEECH_WORDS = 5000`, `isAboveWordThreshold` (Phase 37 deliverables)
- `.planning/phases/38-psychological-inference-engine/38-CONTEXT.md` — 36 locked decisions D-01..D-36
- `.planning/REQUIREMENTS.md:27-36` — PGEN-01..07 verbatim contract
- `.planning/ROADMAP.md` Phase 38 entry — full success criteria
- `.planning/research/SUMMARY.md` — consolidated M011 research; phase-ownership map
- `.planning/research/ARCHITECTURE.md` §§3, 5, 7, 8 — prompt assembler fork + orchestrator split + monthly cron registration
- `.planning/research/PITFALLS.md` — Pitfalls 1, 5, 6, 8 (D027 sycophancy / unconditional fire / monthly cron / Hard Rule extension)
- `.planning/milestones/v2.5-phases/34-inference-engine/34-CONTEXT.md` + `34-RESEARCH.md` + `34-01-PLAN.md` / `34-02-PLAN.md` / `34-03-PLAN.md` — direct analog (Phase 34 = M010 inference engine; Phase 38 mirrors structure with locked divergences)

### Secondary (MEDIUM confidence — cross-referenced)

- `node-cron` 4.2.x: `validate(expression)` API surface verified via `src/config.ts:2,22` import + usage; `next()` API not available (use Luxon for next-fire enumeration per `cron-collision.test.ts` design above)
- `luxon` 3.7.x DST-safe arithmetic — verified by Phase 37 use at `psychological-shared.ts:46,166-168`

### Tertiary (LOW confidence — none)

No tertiary findings. All claims were verifiable in this codebase or in CONTEXT.md.

---

## Metadata

**Confidence breakdown:**
- Plan-shape (3 plans, strict ordering): HIGH — direct mirror of Phase 34 which shipped clean
- File locations + signatures: HIGH — locked by CONTEXT.md D-03, D-04, D-11, D-12; verified against codebase paths
- Sonnet SDK call shape: HIGH — verbatim from M008/M009/M010 at multiple file:line anchors
- Schema gap (Finding 1): HIGH — verified by direct file read; CONTEXT.md D-32 already flagged "the planner verifies"
- Cron-collision test: HIGH — Luxon arithmetic is trivial; existing patterns at `src/rituals/__tests__/cron-registration.test.ts` extend cleanly
- 3-cycle integration test: HIGH structural, MEDIUM fixture-design — the assertion shape is locked, but the previous-month-window fixture design (Pitfall 5) is the planner's call (recommended approach above)

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days; stable infrastructure; no fast-moving SDK pieces)
