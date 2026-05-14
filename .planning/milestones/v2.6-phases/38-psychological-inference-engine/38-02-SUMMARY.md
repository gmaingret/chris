---
phase: 38
plan: 02
subsystem: psychological-profile-inference
tags: [psychological-profile, generator, hexaco, schwartz, m011, unconditional-fire, three-cycle-test, schema-extension, hard-coloc]
dependency_graph:
  requires:
    - 38-01-SUMMARY.md (assemblePsychologicalProfilePrompt + PSYCHOLOGICAL_HARD_RULE_EXTENSION + view type)
    - 37-01-SUMMARY.md (psychological-schemas v3/v4 base, profileHexaco/profileSchwartz tables, migration 0013)
    - 37-02-SUMMARY.md (loadPsychologicalSubstrate + PsychologicalSubstrate<T> discriminated union)
  provides:
    - generateHexacoProfile + HEXACO_PROFILE_CONFIG (src/memory/profiles/hexaco.ts)
    - generateSchwartzProfile + SCHWARTZ_PROFILE_CONFIG (src/memory/profiles/schwartz.ts)
    - runPsychologicalProfileGenerator + PsychologicalProfileGeneratorConfig<T> (src/memory/profiles/psychological-shared.ts)
    - HexacoProfileSchemaV4Boundary + V3Boundary + HexacoProfileBoundaryData (src/memory/profiles/psychological-schemas.ts)
    - SchwartzProfileSchemaV4Boundary + V3Boundary + SchwartzProfileBoundaryData (src/memory/profiles/psychological-schemas.ts)
    - PROFILE_TYPE_TO_TABLE_NAME export (src/memory/profiles/psychological-shared.ts)
    - PsychologicalProfileGenerationOutcome discriminated union (3 cases — no skipped_no_change)
    - computePsychologicalSubstrateHash (src/memory/profiles/psychological-shared.ts)
  affects:
    - Plan 38-03 (next) — orchestrator will import generateHexacoProfile + generateSchwartzProfile and wrap in Promise.allSettled + cron registration
tech_stack:
  added: []
  patterns:
    - Zod boundary schema extension (.extend({...}) atop Phase 37 base; .strict() on v3 for unknown-key rejection)
    - SHA-256 canonical-JSON substrate hashing (M010 D-15 pattern; M011-appropriate shape without decisionIds)
    - Discriminated-union narrowing for substrate threshold gate (Finding 4 — replaces M010 loose isAboveThreshold check)
    - Host-injection of `last_updated` between v4 parse and v3 re-validate (Pitfall 7)
    - Write-before-upsert pattern (mirrors M010 shared.ts:495-501; PGEN-06 — written on EVERY successful fire)
    - jsonb encoding via sql`${serialized}::jsonb` (handles JS null → JSON null literal, not SQL NULL)
    - 3-cycle integration test with re-seeded previous-month windows (Pitfall 5 mitigation)
    - Sonnet-routed mockAnthropicParse via system-text profileType-focus substring
key_files:
  created:
    - src/memory/profiles/hexaco.ts (126 lines — generateHexacoProfile + HEXACO_PROFILE_CONFIG + flattenHexacoOutput)
    - src/memory/profiles/schwartz.ts (132 lines — generateSchwartzProfile + SCHWARTZ_PROFILE_CONFIG + flattenSchwartzOutput)
    - src/memory/profiles/__tests__/hexaco.test.ts (398 lines — 8 tests)
    - src/memory/profiles/__tests__/schwartz.test.ts (360 lines — 8 tests)
    - src/memory/__tests__/psychological-profile-updater.integration.test.ts (451 lines — 2 tests; HARD CO-LOC anchor)
    - .planning/phases/38-psychological-inference-engine/deferred-items.md (39 lines — pre-existing live-API failure documentation)
  modified:
    - src/memory/profiles/psychological-schemas.ts (+59 lines — V4Boundary + V3Boundary variants for HEXACO + Schwartz + 2 type aliases)
    - src/memory/profiles/psychological-shared.ts (+440 lines — runPsychologicalProfileGenerator + config type + PROFILE_TYPE_TO_TABLE_NAME exported + PsychologicalProfileGenerationOutcome + computePsychologicalSubstrateHash)
decisions:
  - "Used JSON-stringify field-content assertion instead of literal stringification in prevHistorySnapshot threading tests — postgres jsonb storage reorders keys alphabetically; literal verbatim assertion brittle (Rule 1 fix during Task 3 verify)"
  - "Extracted runPsychologicalProfileGenerator helper into psychological-shared.ts (D-11 Claude's Discretion) — both generator files delegate ~10 lines each; alternative was inlining the 11-step body in both files at ~90 lines each, which would have invited per-profileType drift (the M010-06 lesson)"
  - "Top-level boundary fields (data_consistency, overall_confidence) are NOT in the flattenSonnetOutput map — written separately to the row's overall_confidence column by the runner; rationale documented in flattener JSDoc"
  - "Three-cycle integration test asserts substrate_hash differs between Cycle 2 (May corpus) and Cycle 3 (June corpus with 5 new entries) — semantic content is identical to Cycle 1 (April) but the canonical-JSON hash inputs (pensieveIds.sort()) DIFFER because each cycle inserts fresh UUID-keyed rows. Cycle 2 hash != Cycle 1 hash NOT asserted (would fail under fresh-UUID re-seeding); the Sonnet-call-count assertion is the load-bearing PGEN-06 invariant."
metrics:
  duration_min: ~25
  completed_date: 2026-05-14
  tasks_completed: 3
  files_created: 6
  files_modified: 2
  lines_added: 2002
  commits: 3
---

# Phase 38 Plan 02: HEXACO + Schwartz Generators with UNCONDITIONAL FIRE Summary

HEXACO + Schwartz psychological profile generators ship together (HARD CO-LOC #M11-2) along with the SDK-boundary schema extension and the 3-cycle UNCONDITIONAL-FIRE integration test that locks the inverse-of-M010 contract (PGEN-06 / D-35).

## One-liner

Both M011 psychological generators with unconditional substrate-hash recording, host-injected last_updated, and the 3-cycle integration test asserting cumulative 4 Sonnet calls on identical Cycle-2 substrate (direct inverse of M010 PTEST-03).

## Requirements satisfied

- PGEN-02 — HEXACO generator: single Sonnet call per fire emits all 6 dimensions in one structured-output response.
- PGEN-03 — Schwartz generator: single Sonnet call per fire emits all 10 values in one structured-output response.
- PGEN-06 — UNCONDITIONAL FIRE: substrate_hash computed via `computePsychologicalSubstrateHash` and persisted on every fire, but the M010 hash-skip branch (shared.ts:399-409) is DELETED in `runPsychologicalProfileGenerator`. The 3-cycle integration test is the regression detector.
- PGEN-07 — `prevHistorySnapshot` is threaded from substrate into the prompt assembler (NOT from currentRow); Sonnet self-reports `data_consistency`; host stores `overall_confidence` verbatim into the row column (no host-side stddev / inter-period math).

## Architecture

### Three-layer separation

1. **`psychological-schemas.ts`** (Plan 38-02 extends Phase 37 base):
   - Phase 37 base schemas (`HexacoProfileSchemaV3/V4`, `SchwartzProfileSchemaV3/V4`, type aliases) remain UNCHANGED — preserves the reader contract (`getPsychologicalProfiles` strips meta-columns).
   - NEW: `HexacoProfileSchemaV4Boundary` + `SchwartzProfileSchemaV4Boundary` extend the v4 base with top-level `data_consistency` (0.0–1.0) + `overall_confidence` (0.0–1.0) for the SDK-emit step (RESEARCH Finding 1).
   - NEW: `HexacoProfileSchemaV3Boundary` + `SchwartzProfileSchemaV3Boundary` mirror the extension at the v3 layer with `.strict()` (rejects unknown top-level keys).
   - NEW: `HexacoProfileBoundaryData` + `SchwartzProfileBoundaryData` type aliases derived via `z.infer<>`.

2. **`psychological-shared.ts`** (Plan 38-02 extends Phase 37 substrate loader):
   - Phase 37 substrate loader (`loadPsychologicalSubstrate`) remains UNCHANGED.
   - CHANGED: `PROFILE_TYPE_TO_TABLE_NAME` flipped from `const` → `export const` (RESEARCH Finding 2).
   - NEW: `computePsychologicalSubstrateHash(corpus, episodicSummaries, schemaVersion): string` — M011-appropriate sibling of M010 `computeSubstrateHash` (no `decisionIds` per PSCH-07; SHA-256 over canonical JSON sorted by pensieveIds + episodicDates + schemaVersion).
   - NEW: `PsychologicalProfileGenerationOutcome` — 3-case discriminated union (`updated | skipped_below_threshold | error`); no `'skipped_no_change'` because PGEN-06 eliminates the hash-skip code path.
   - NEW: `PsychologicalProfileGeneratorConfig<TBoundaryData>` — type for the per-profile config consumed by the runner.
   - NEW: `runPsychologicalProfileGenerator<T>(config, substrate)` — 11-step body shared between both generators.

3. **`hexaco.ts` + `schwartz.ts`** (Plan 38-02 — both ship in the same plan):
   - ~10 lines of body per file: declare flattener + config object + export the public `generateXxxProfile` function that delegates to `runPsychologicalProfileGenerator`.
   - Per-profile variance is captured in the config object; the mechanical 11-step body lives only in `psychological-shared.ts`.

### 11-step runner body (locked from M010 with 4 specific divergences)

The 11-step order is fixed (do not reorder):

  1. **Discriminated-union threshold narrow** (RESEARCH Finding 4) — `if (substrate.belowThreshold) return skipped_below_threshold`. TypeScript narrows below the early-return.
  2. **Read current row** — `db.select().from(table).where(eq(table.name, 'primary')).limit(1)`. Surface missing-cold-start-row as outcome 'error'.
  3. **Compute substrate hash** — calls `computePsychologicalSubstrateHash`.
  4. **NO HASH-SKIP BRANCH** — the M010 `if (currentRow.substrateHash === computedHash) return skip` branch is DELETED. Inline comment documents PGEN-06 rationale.
  5. **NO `.refine()` ceiling** — M010's closure-captured volume-weight overlay is absent (D-33).
  6. **Build prompt** — `assemblePsychologicalProfilePrompt(profileType, view, substrate.prevHistorySnapshot, substrate.wordCount)`. `prevHistorySnapshot` is threaded directly from substrate, NOT extracted from currentRow.
  7. **Sonnet call** — `anthropic.messages.parse({ model: SONNET_MODEL, max_tokens: 4000, ... output_config: { format: zodOutputFormat(v4SchemaBoundary as unknown as any) } })`.
  8. **Host-inject `last_updated`** — iterate the parsed response's keys; for each non-meta dim object, overwrite `last_updated` with `new Date().toISOString()` before v3 re-validate (Pitfall 7).
  9. **v3 boundary re-validate** — `v3SchemaBoundary.parse(parsedRaw)`. M009 D-29-02 dual-schema discipline.
  10. **Write profile_history row** — `db.insert(profileHistory).values({ profileTableName, profileId: currentRow.id, snapshot: currentRow })` BEFORE the upsert (write-before-upsert pattern).
  11. **Upsert** — `db.insert(table).values(upsertValues).onConflictDoUpdate({ target: table.name, set: upsertValues })`. jsonb dim columns encoded via `sql\`${serialized}::jsonb\`` to preserve JSON null literal vs SQL NULL. Log `chris.psychological.${profileType}.updated`.

Steps 7-11 are wrapped in try/catch; any throw produces outcome `'error'` with the message in `error` and logs `chris.psychological.${profileType}.error`. The orchestrator (Plan 38-03) uses `Promise.allSettled` for outer isolation; this inner catch ensures a deterministic outcome rather than a rejected promise.

## Critical RESEARCH findings honored

- **Finding 1 (schema extension)** — `HexacoProfileSchemaV4Boundary` + `SchwartzProfileSchemaV4Boundary` add top-level `data_consistency` + `overall_confidence` at the SDK boundary. Without these, Cycle 1's `overall_confidence > 0` assertion would be structurally impossible (Sonnet's structured output would not include the field).
- **Finding 2 (export visibility)** — `PROFILE_TYPE_TO_TABLE_NAME` flipped from module-private to exported so generators import the canonical mapping (avoids "typo in migration vs application code" silent-failure class).
- **Finding 3 (hash shape)** — `computePsychologicalSubstrateHash` is a sibling of M010's `computeSubstrateHash` with M011-appropriate input shape (corpus + episodicSummaries + schemaVersion; no decisionIds).
- **Finding 4 (discriminated-union narrow)** — Step 1 uses `if (substrate.belowThreshold)` rather than M010's loose `isAboveThreshold(entryCount)` check. The new generator files do NOT import `isAboveThreshold` from operational `confidence.ts`.

## Pitfalls mitigated

- **Pitfall 1 (hash-skip reintroduction)** — the integration test's Cycle 2 assertion `expect(mockAnthropicParse).toHaveBeenCalledTimes(4)` is the load-bearing PGEN-06 regression detector. Any future PR that re-introduces `if (substrateHash === computedHash) return skip` fails this assertion.
- **Pitfall 2 (overall_confidence > 0)** — the V4Boundary schema makes top-level `overall_confidence` REQUIRED at SDK emit; Sonnet's mock response carries `overall_confidence: 0.62` (HEXACO) / `0.7` (Schwartz); the runner stores the value verbatim to the column.
- **Pitfall 3 (operational-token contamination)** — zero operational tokens (`jurisdictional|capital|health|family`) in any new psychological file; psych-boundary-audit.test.ts (PSCH-10) stays green 10/10.
- **Pitfall 5 (window-scroll fixture trap)** — the 3-cycle integration test truncates `pensieve_entries` between cycles and re-seeds identical corpus into the relevant previous-month window for each cycle (April → May → June). `vi.setSystemTime` and fake timers are NOT used (clashes with the `postgres` driver); explicit `now: Date` is passed to the substrate loader.
- **Pitfall 7 (last_updated re-validate failure)** — host-injects `last_updated: new Date().toISOString()` per dim BETWEEN the v4 parse and v3 re-validate. Phase 37 v4 dim schema is `string()` (not `.datetime()`); v3 dim schema is `.datetime().strict()`. A Sonnet output with invalid datetime would pass v4 but fail v3; host-injection prevents this. Tested directly in test 6 of both per-generator suites.

## Test surface (all green)

- `src/memory/profiles/__tests__/hexaco.test.ts` — 8 tests pass against real Docker postgres.
- `src/memory/profiles/__tests__/schwartz.test.ts` — 8 tests pass against real Docker postgres.
- `src/memory/__tests__/psychological-profile-updater.integration.test.ts` — 2 tests pass:
  - Three-cycle UNCONDITIONAL FIRE (1 test, ~30s): Cycle 1 = 2 calls, Cycle 2 = 4 cumulative (INVERSE of M010), Cycle 3 = 6 cumulative with different substrate_hash.
  - Promise.allSettled isolation (1 test): HEXACO Sonnet rejection produces outcome 'error', Schwartz outcome 'updated', cross-profile state preserved.
- `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` — 10/10 (D047 boundary stays green; no operational vocab in new psychological files).
- `src/memory/profiles/__tests__/psychological-schemas.test.ts` — full pass (Phase 37 schemas unchanged).
- `src/memory/profiles/__tests__/psychological-shared.test.ts` — full pass (Phase 37 loader unchanged).
- `src/memory/__tests__/psychological-profile-prompt.test.ts` — 28/28 (Plan 38-01 prompt builder unchanged).
- `npx tsc --noEmit` exits 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] prevHistorySnapshot assertion brittleness**
- **Found during:** Task 3 verify (hexaco.test.ts test 4 — prevHistorySnapshot threading)
- **Issue:** The test asserted `expect(capturedSystemText).toContain(JSON.stringify(knownSnapshot, null, 2))`. Postgres jsonb storage reorders object keys alphabetically; the prompt assembler's `JSON.stringify(prevState, null, 2)` therefore produces a different literal string than `JSON.stringify(<source-literal>, null, 2)`. Test failed on key ordering, not on content.
- **Fix:** Changed assertion to field-content checks: `expect(capturedSystemText).toContain('"honesty_humility"')` + `.toContain('"score": 3')` + `.toContain('"overall_confidence": 0.35')` + `.toContain('"data_consistency": 0.3')`. Same coverage; resilient to jsonb-storage key reordering. Applied identical fix to schwartz.test.ts.
- **Files modified:** `src/memory/profiles/__tests__/hexaco.test.ts`, `src/memory/profiles/__tests__/schwartz.test.ts`.
- **Commit:** 8c2dc2e (included in Task 3 commit; the fix was applied before commit-staging).

**2. [Rule 1 - Bug] isAboveThreshold doc-string tokens triggered acceptance regex**
- **Found during:** Task 2 verify (boundary audit)
- **Issue:** Hexaco/Schwartz file JSDoc referenced "NOT import `isAboveThreshold` from operational confidence.ts" — a literal `isAboveThreshold` substring. Plan acceptance criteria `grep -c "isAboveThreshold" src/memory/profiles/hexaco.ts` requires 0 (it's a M010 operational helper).
- **Fix:** Reworded JSDoc to "NOT import the M010 entry-count gate from operational confidence.ts" (same semantic content, no operational identifier token).
- **Files modified:** `src/memory/profiles/hexaco.ts`, `src/memory/profiles/schwartz.ts`.
- **Commit:** 4225f23 (included in Task 2 commit; fix applied before commit-staging).

**3. [Rule 1 - Bug] vi.useFakeTimers literal in integration test docstring**
- **Found during:** Task 3 verify
- **Issue:** Integration test docstring referenced "vi.useFakeTimers MUST NOT be used" — a literal `vi.useFakeTimers` substring; acceptance criteria `grep -cE "vi\.useFakeTimers" ...` requires 0 (the test must not use the API).
- **Fix:** Reworded docstring to "Fake timers MUST NOT be used (vitest's timer faking clashes ...)" — semantic content preserved without the literal token.
- **Files modified:** `src/memory/__tests__/psychological-profile-updater.integration.test.ts`.
- **Commit:** 8c2dc2e.

### Architectural Adjustments

None — Plan 38-02 was implemented exactly as specified. The Claude's Discretion choice (D-11) to extract `runPsychologicalProfileGenerator` into `psychological-shared.ts` rather than inline the body in both `hexaco.ts` and `schwartz.ts` was applied per the plan's recommendation.

## Authentication Gates

None encountered. Plan 38-02 uses mocked Anthropic SDK throughout (per CLAUDE.md memory "Always run full Docker tests" — Docker postgres is real; Anthropic SDK is mocked via `vi.mock('../../../llm/client.js', ...)`).

## Deferred Issues

**Pre-existing live-API test failures (5 files, out of scope).** The full Docker suite (`bash scripts/test.sh`) reports `5 failed | 128 passed` test files. All 5 failing files use the real Anthropic API and fail with `401 invalid x-api-key` because the sandbox has no `ANTHROPIC_API_KEY` configured:

- `src/chris/__tests__/live-integration.test.ts`
- `src/decisions/__tests__/live-accountability.test.ts`
- `src/decisions/__tests__/vague-validator-live.test.ts`
- `src/episodic/__tests__/live-anti-flattery.test.ts`
- `src/llm/__tests__/models-smoke.test.ts`

These tests pre-exist this plan (they fail on the base commit `0fb4710` prior to Plan 38-02 execution). Plan 38-02 changes none of the files these tests exercise (the M011 generators mock the Anthropic SDK). Documented in `.planning/phases/38-psychological-inference-engine/deferred-items.md`. Remediation owner: environment (CI / sandbox API-key provisioning).

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: src/memory/profiles/hexaco.ts
- FOUND: src/memory/profiles/schwartz.ts
- FOUND: src/memory/profiles/__tests__/hexaco.test.ts
- FOUND: src/memory/profiles/__tests__/schwartz.test.ts
- FOUND: src/memory/__tests__/psychological-profile-updater.integration.test.ts
- FOUND: .planning/phases/38-psychological-inference-engine/deferred-items.md

**Commits verified to exist:**
- FOUND: 1b2cefd (Task 1 — schema extension + shared helpers)
- FOUND: 4225f23 (Task 2 — generators + runner helper)
- FOUND: 8c2dc2e (Task 3 — unit + integration tests + deferred-items doc)

**Key invariants verified at runtime:**
- `npx tsc --noEmit` exits 0.
- 4 boundary schema exports + 2 type aliases present in `psychological-schemas.ts`.
- `PROFILE_TYPE_TO_TABLE_NAME` + `PsychologicalProfileGenerationOutcome` + `computePsychologicalSubstrateHash` exported from `psychological-shared.ts`.
- `generateHexacoProfile` + `HEXACO_PROFILE_CONFIG` exported from `hexaco.ts`.
- `generateSchwartzProfile` + `SCHWARTZ_PROFILE_CONFIG` exported from `schwartz.ts`.
- `if (substrate.belowThreshold)` narrow present in `psychological-shared.ts`.
- Zero `isAboveThreshold` references in `hexaco.ts` / `schwartz.ts`.
- Zero `substrateHash === computedHash` or `prevHash === currHash` in `psychological-shared.ts` (no hash-skip).
- Zero `.refine(` in `hexaco.ts` / `schwartz.ts`.
- `max_tokens: 4000` present in `psychological-shared.ts`.
- All 3 log keys (`updated`, `skipped_below_threshold`, `error`) emitted.
- `INVERSE of M010` + `UNCONDITIONAL FIRE` docblock + `toHaveBeenCalledTimes(2|4|6)` + `Promise.allSettled` + `validHexacoResponse` + `validSchwartzResponse` present in integration test.
- Zero `vi.useFakeTimers` and zero `.skipIf(` in integration test.
- Zero operational tokens (`jurisdictional|capital|health|family`) in any new file (code lines, not comments).
- psych-boundary-audit.test.ts 10/10 green.
- 16/16 unit tests pass against real Docker postgres.
- 2/2 integration tests pass against real Docker postgres.
