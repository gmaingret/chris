---
phase: 37-psychological-substrate
reviewed_at: 2026-05-14
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/db/migrations/0013_psychological_profiles.sql
  - src/db/migrations/meta/_journal.json
  - src/db/schema.ts
  - src/memory/confidence.ts
  - src/memory/profiles.ts
  - src/memory/profiles/psychological-schemas.ts
  - src/memory/profiles/psychological-shared.ts
  - src/memory/profiles/__tests__/psych-boundary-audit.test.ts
findings:
  blocker: 0
  warning: 5
  total: 5
blocker_count: 0
warning_count: 5
status: issues_found
---

# Phase 37: Psychological Substrate — Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 37 ships the M011 psychological-substrate persistence layer (migration 0013 with 3 profile tables, Zod v3+v4 dual schemas, never-throw reader, substrate loader, boundary audit). Adversarial review found **0 blockers** but **5 warnings**, mostly around scope creep into Phase 38 code, in-file dim score/confidence range enforcement at the DB layer (only top-level `overall_confidence` has a CHECK), and a redundant import re-export in `profiles.ts`.

**D027 Hard Rule guards:** Phase 37 itself ships no write surface that mutates psych-profile rows — the only writer added is the migration's seed INSERT (`overall_confidence=0`, all dims `'null'::jsonb`, `activated=false`). D027 defense is deferred to Phase 39 (`PSYCH_INJECTION_HEADER` + `PSYCHOLOGICAL_HARD_RULE_EXTENSION`) and to Phase 38 generator surfaces. No Phase-37 surface gap found.

**D028 attachment-activation guard:** `relational_word_count int DEFAULT 0` and `activated boolean DEFAULT false` columns ship in migration 0013 (correct), and `RELATIONAL_WORD_COUNT_THRESHOLD = 2000` lives in `confidence.ts`. The actual sweep that flips `activated` is **explicitly deferred** to v2.6.1 per CONTEXT.md D-14 + Deferred Items — no Phase-37 enforcement gap.

**Migration safety:** `CREATE TABLE IF NOT EXISTS` + `ON CONFLICT (name) DO NOTHING` make 0013 idempotent. CHECK constraint on `overall_confidence ∈ [0,1]` is correct. Cold-start seed values match spec verbatim. Journal entry `when=1778699398922` is strictly monotonic after 0012's `1778482284254`.

**FR/RU implications:** Display labels (`HEXACO_DIM_LABELS`, `SCHWARTZ_DIM_LABELS`) are hard-coded English; this is a Phase 39 (formatter) concern, not Phase 37. Word-counting is whitespace-based (Pitfall 2 mitigation), which is correctly locale-agnostic for EN/FR/RU.

## Warnings

### WR-01: No DB-level CHECK constraints on per-dim score/confidence bounds

- **File:** `src/db/migrations/0013_psychological_profiles.sql:48-53, 69-78, 96-98` and `src/db/schema.ts:672-677, 696-705, 729-731`
- **Issue:** The migration enforces `overall_confidence` ∈ [0,1] via a CHECK constraint (good), but the per-dim jsonb columns (`honesty_humility`, `self_direction`, `anxious`, etc.) have NO database-level CHECK constraints to enforce `score ∈ [1,5]` and `confidence ∈ [0,1]`. The Zod v3 schemas enforce these at read boundary, but a future direct UPDATE (or a non-Zod-validated writer) could insert out-of-range values. The Zod read-defense would only surface this as a `parse_failed` null-return, silently dropping the row from prompt injection rather than failing loud.
- **Impact:** Defense-in-depth gap. The per-dim ranges are part of the Never-Retrofit Checklist intent (D-06 + D042) but were not encoded as CHECK constraints. PostgreSQL supports `CHECK ((score::numeric BETWEEN 1 AND 5) AND (confidence::numeric BETWEEN 0 AND 1))` on jsonb path expressions.
- **Fix:** Either (a) accept Zod-only validation as the contract surface and document explicitly that DB-level dim bounds are intentionally not enforced (preferred — keeps schema migration cheap and matches "Zod is the read-time contract" pattern), or (b) add jsonb-path CHECK constraints in a follow-up migration. If (a), add a comment block at the top of `0013_psychological_profiles.sql` stating "per-dim score/confidence ranges are enforced by `psychological-schemas.ts` Zod v3 schemas at the read boundary; DB layer enforces only top-level `overall_confidence`."

### WR-02: psychological-shared.ts has accumulated Phase 38 generator code, exceeding the Phase 37 substrate-only scope

- **File:** `src/memory/profiles/psychological-shared.ts:106-669`
- **Issue:** CONTEXT.md specifies Phase 37 ships **only** `loadPsychologicalSubstrate` + `PsychologicalProfileType` + private `countWords` (~150 lines per Plan-01 SUMMARY: "psychological-shared.ts — loadPsychologicalSubstrate + PsychologicalProfileType + PsychologicalSubstrate<T> + private countWords helper (235 lines)"). The current file is **669 lines** and contains the full Phase 38 generator (`runPsychologicalProfileGenerator`, `computePsychologicalSubstrateHash`, `PsychologicalProfileGenerationOutcome`, `PROFILE_TYPE_TO_TABLE_NAME`, anthropic SDK imports, `assemblePsychologicalProfilePrompt` import). These were added in commits `1b2cefd` and `4225f23` (Phase 38-02). The substrate-only file at Phase 37 close should be ~250 lines.
- **Impact:** Phase-boundary drift; the Phase 37 close-out claim "Plan 37-02 ships PSCH-07..10" is now mixed with Phase 38 deliverables in the same file. A regression in Phase 38 generator code can no longer be reverted without touching the substrate loader. Also: `psychological-shared.ts` now imports `@anthropic-ai/sdk/helpers/zod` and `../../llm/client.js` at module load — any consumer of `loadPsychologicalSubstrate` pulls these in transitively.
- **Fix:** Move the Phase 38 generator code (`runPsychologicalProfileGenerator`, `computePsychologicalSubstrateHash`, `PsychologicalProfileGeneratorConfig`, `PsychologicalProfileGenerationOutcome`, `PROFILE_TYPE_TO_TABLE_NAME`) to a sibling file like `src/memory/profiles/psychological-generator.ts`. Phase 37's `psychological-shared.ts` keeps only the substrate loader + types. (Lower-cost alternative: leave as-is but update CONTEXT.md / Phase 37 SUMMARY to reflect the actual scope.)

### WR-03: Boundary audit regex pattern carries unnecessary `g`-flag risk via call site choice

- **File:** `src/memory/profiles/__tests__/psych-boundary-audit.test.ts:61-62, 73-74`
- **Issue:** `OPERATIONAL_VOCAB` and `PSYCHOLOGICAL_VOCAB` are declared without `g` flag (correct), so `pattern.test(line)` has no `lastIndex` carryover. The inline comment "Build a fresh regex per call to avoid global-flag lastIndex carryover" (line 61) is **misleading** — no fresh regex is built; the same module-level regex is reused. The defense the comment describes does not exist; it relies on the non-`g` flag of the declared regex, which is fragile to a future "let's make this matchAll" refactor.
- **Impact:** Quality/maintainability. A future contributor reading the comment may assume `g`-flag safety is enforced by some mechanism that isn't there, then add a `g` flag thinking it's safe.
- **Fix:** Either (a) remove the misleading comment and replace with a precise one ("regex is non-global so test() is stateless across calls"), or (b) actually clone the regex per call: `new RegExp(pattern.source, pattern.flags).test(line)`. Option (a) is cheaper.

### WR-04: Duplicate `PsychologicalProfileType` declaration via re-export AND type-only import

- **File:** `src/memory/profiles.ts:59-60`
- **Issue:**
  ```typescript
  export type { PsychologicalProfileType } from './profiles/psychological-shared.js';
  import type { PsychologicalProfileType } from './profiles/psychological-shared.js';
  ```
  The same type is both re-exported AND re-imported on adjacent lines. The re-export is intentional (D-21 stable import path for downstream consumers), but the second `import type` line is redundant: TypeScript could use the re-exported name as a local binding via `import type { PsychologicalProfileType } from './profiles/psychological-shared.js';` alone, then the re-export would happen via `export type { PsychologicalProfileType };`. As written, the two-line pattern works but signals to a reader that something subtle is going on when nothing is.
- **Impact:** Minor; potential confusion for the next maintainer. No runtime cost (types erase).
- **Fix:** Collapse to:
  ```typescript
  import type { PsychologicalProfileType } from './profiles/psychological-shared.js';
  export type { PsychologicalProfileType };
  ```

### WR-05: `PsychologicalSubstrate<T>` discriminated union — `neededWords` is computed but never validated > 0

- **File:** `src/memory/profiles/psychological-shared.ts:284-290`
- **Issue:** `neededWords: MIN_SPEECH_WORDS - wordCount` is computed only inside the `if (wordCount < MIN_SPEECH_WORDS)` branch, so it is always strictly positive at production sites. However, the type signature documents `belowThreshold: true` with `neededWords: number` — a future refactor that moves the computation outside the branch (or a malformed mock in a test) could produce `neededWords <= 0` while the consumer (Phase 39 `/profile` "need N more words" display) expects a positive number. Adding either a runtime assertion or a more precise `neededWords` type (e.g., a branded positive-number type) would close this.
- **Impact:** Defensive concern; no current bug. The "need N more words" display would render "need 0 more words" or "need -50 more words" if invariant breaks — confusing UX but not a security/data issue.
- **Fix:** Add a `// invariant: neededWords > 0 by construction` comment, OR add a runtime guard: `if (wordCount >= MIN_SPEECH_WORDS) throw new Error('belowThreshold branch entered with above-threshold wordCount');` — though the latter contradicts the never-throw contract. Comment is fine; the load-bearing test (`psychological-shared.test.ts` "Russian 4500-word row") already pins one positive-neededWords case.

---

## Notes on D027 / D028 Guard Coverage

**D027 (Hard Rule trait → coaching-conclusion sycophancy):**
- Phase 37 ships zero write surfaces that mutate psych-profile rows. Only writer = migration 0013 seed INSERT with `overall_confidence=0` (correct cold-start).
- Phase 38's `runPsychologicalProfileGenerator` (which leaked into this file — see WR-02) does write profile rows, but enforcement of the prompt-level Hard Rule extension is in `assemblePsychologicalProfilePrompt` (Phase 38) and `formatPsychologicalProfilesForPrompt` (Phase 39, present in `profiles.ts:782-815`).
- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (profiles.ts:123-128) correctly excludes COACH mode. The negative-invariant test `coach-psychological-isolation.test.ts` is referenced but not in scope of this review.
- **No Phase-37 D027 gap found.**

**D028 (Attachment activation gate, ≥2,000 relational words / 60 days):**
- Columns ship: `relational_word_count int DEFAULT 0`, `activated boolean DEFAULT false` (correct seed).
- Threshold constant `RELATIONAL_WORD_COUNT_THRESHOLD = 2000` exported from confidence.ts (correct).
- The actual sweep is **explicitly deferred to v2.6.1** per CONTEXT.md D-14 + Deferred Items §"profile_attachment population logic"; not in Phase 37 scope.
- Cold-start seed has `relational_word_count=0` and `activated=false` — the sweep cannot accidentally fire on cold-start data.
- **No Phase-37 D028 gap found.**

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
