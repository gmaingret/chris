---
phase: 37-psychological-substrate
plan: 02
subsystem: memory

tags: [drizzle, postgres, zod, luxon, m011, psychological-profiles, substrate-loader, never-throw-reader, boundary-audit]

# Dependency graph
requires:
  - phase: 37-psychological-substrate
    provides: Plan 37-01 — 3 pgTable exports (profileHexaco, profileSchwartz, profileAttachment), Zod v3+v4 dual schemas + types in psychological-schemas.ts, migration 0013 applied with cold-start seed rows, test.sh smoke gates
  - phase: 33-profile-substrate
    provides: M010 operational reader pattern (getOperationalProfiles, readOneProfile, stripMetadataColumns) — append-only mirrored for M011 with 5 locked divergences
provides:
  - MIN_SPEECH_WORDS, RELATIONAL_WORD_COUNT_THRESHOLD, isAboveWordThreshold helpers in src/memory/confidence.ts (append-only, M010 helpers untouched)
  - loadPsychologicalSubstrate<T>(profileType, now) substrate loader in src/memory/profiles/psychological-shared.ts with discriminated-union return; SQL source filter (Pitfall 3); Luxon calendar-month Europe/Paris boundary; inline whitespace word counting (Pitfall 2)
  - getPsychologicalProfiles() never-throw reader + 3-layer Zod v3 parse defense in src/memory/profiles.ts (chris.psychological.profile.read.* distinct namespace); PsychologicalProfileType re-export for stable import path
  - psych-boundary-audit.test.ts two-directional D047 regex sweep (10 it cases, <1s runtime); self-allowlisted by absence
  - psychological-schemas.test.ts (35 unit tests, microseconds; v3 happy/boundary/.strict + v4 lockstep across 3 profile types)
  - psychological-shared.test.ts (11 real-DB integration tests; source filter, below/above-threshold, Russian word counting, calendar-month boundary, prevHistorySnapshot)
  - psychological-profiles.test.ts (9 real-DB + mocked-DB integration tests; happy path + 3-layer parse defense + never-throws contract)
affects: [Phase 38 psychological inference engine, Phase 39 surfaces, Phase 40 milestone tests]

# Tech tracking
tech-stack:
  added: []  # zero new npm dependencies; luxon already in package.json per Plan 37-01
  patterns:
    - "Discriminated-union substrate return — { belowThreshold: true } vs { belowThreshold: false } forces TypeScript narrowing before corpus access; below-threshold short-circuits before second query"
    - "SQL-level source/tag filter (NOT JS post-filter) — eq(source, 'telegram') + or(isNull, ne(RITUAL_RESPONSE)) at the Drizzle WHERE clause; Pitfall 3 mitigation"
    - "Luxon Europe/Paris calendar-month boundary — DateTime.fromJSDate(now, { zone: 'Europe/Paris' }).startOf('month').minus({ months: 1 }) — DST-safe; matches Phase 38 '1st of month 09:00 Paris' cron semantics"
    - "Inline whitespace word counter (NOT token counter) — text.trim().split(/\\s+/).filter(s => s.length > 0).length per entry, summed; Pitfall 2 mitigation against Cyrillic token-inflation bias"
    - "3-layer Zod v3 parse defense with distinct namespace chris.psychological.profile.read.{schema_mismatch | parse_failed | unknown_error}; per-profile null on any layer; never-throw aggregate via Promise.all"
    - "Two-directional vocabulary regex audit — operational tokens forbidden in 2 psych source files; psych tokens forbidden in 8 operational source files; profiles.ts (the orchestration hub) omitted from both arrays per D-21; audit file self-allowlisted by absence per D-34"

key-files:
  created:
    - "src/memory/profiles/psychological-shared.ts — loadPsychologicalSubstrate + PsychologicalProfileType + PsychologicalSubstrate<T> + private countWords helper (235 lines)"
    - "src/memory/profiles/__tests__/psych-boundary-audit.test.ts — D047 two-directional regex sweep, 10 it cases (129 lines)"
    - "src/memory/profiles/__tests__/psychological-schemas.test.ts — 35 unit tests (cold-start, populated, boundary, .strict, v4-lockstep) across 3 profile types (351 lines)"
    - "src/memory/profiles/__tests__/psychological-shared.test.ts — 11 real-DB integration tests (source filter, below/above-threshold, Russian, calendar-month, prevHistorySnapshot, soft-delete) (405 lines)"
    - "src/memory/profiles/__tests__/psychological-profiles.test.ts — 9 mixed real-DB + mocked-DB tests (happy + 3-layer parse defense + never-throws contract) (269 lines)"
  modified:
    - "src/memory/confidence.ts — append-only addition of MIN_SPEECH_WORDS=5000, RELATIONAL_WORD_COUNT_THRESHOLD=2000, isAboveWordThreshold(); M010 helpers untouched (+60 lines)"
    - "src/memory/profiles.ts — append-only addition after getOperationalProfiles (~line 199) of imports (3 pgTables + 3 schemas + 3 types), PsychologicalProfileType re-export, PsychologicalProfiles interface, PSYCHOLOGICAL_PROFILE_SCHEMAS dispatcher, stripPsychologicalMetadataColumns (11 cols), readOnePsychologicalProfile<T>, getPsychologicalProfiles(); M010 reader path completely untouched (+216 lines)"
    - ".planning/phases/37-psychological-substrate/deferred-items.md — appended Plan 37-02 confirmation of pre-existing live-API failures (no Plan 37-02 regression)"

key-decisions:
  - "Strict-less-than 5000-word gate (wordCount < MIN_SPEECH_WORDS) so wordCount === 5000 is above-threshold — matches isAboveWordThreshold's >= semantics; M009 lt→lte lesson"
  - "Below-threshold branch short-circuits BEFORE getEpisodicSummariesRange + profile_history queries — saves two queries on the common cold-start path"
  - "Russian token-inflation test fixture (\"слово \".repeat(4500)) added to lock in the whitespace-based counter; would cross 5000-word gate under token-based counting and is the canonical Pitfall 2 regression test"
  - "Calendar-month boundary timestamps in psychological-shared.test.ts use exact UTC instants derived from Luxon analysis (2026-04-30T22:00:00Z = May 1 00:00 Paris CEST) so the test asserts boundary inclusion deterministically without relying on test-time Luxon computation"
  - "Plan-checker invariant compliance: zero import of isAboveThreshold in psychological-shared.ts; SQL-level RITUAL_RESPONSE exclusion via or(isNull, ne()); never-throw 3-layer defense with the exact chris.psychological.profile.read.* event names"

patterns-established:
  - "Append-only profiles.ts edits — operational reader path stays the canonical type for the 8+ existing call sites per D-21; psychological reader is a SEPARATE function with its own per-profile null contract"
  - "Per-profile parse-defense isolation — Promise.all over 3 readOnePsychologicalProfile calls + per-profile try/catch ensures one profile's parse failure does not cascade to others (validated by Task 7 Layer 1 + Layer 2 tests)"
  - "Audit-by-absence self-allowlist — the boundary audit test file is omitted from its own input arrays; it intentionally contains both vocabularies (regex literals + file-list literals) and would otherwise self-flag (D-34)"

requirements-completed: [PSCH-07, PSCH-08, PSCH-09, PSCH-10]

# Metrics
duration: ~25min
completed: 2026-05-13
---

# Phase 37 Plan 02: Psychological Profile Substrate Loader + Reader + Boundary Audit Summary

**loadPsychologicalSubstrate (PSCH-07/08), getPsychologicalProfiles (PSCH-09), and psych-boundary-audit (PSCH-10) shipped on top of Plan 37-01's persistence layer; M011 substrate is now fully readable with never-throw + 3-layer Zod parse defense + SQL-level source filter + Luxon calendar-month boundary + 4 mitigated pitfalls.**

## Performance

- **Duration:** ~25 min (start 2026-05-13T19:22Z; completed 2026-05-13T19:47Z)
- **Tasks:** 7 (all `type="auto"`, no checkpoints)
- **Files modified:** 7 (5 created + 2 modified) + deferred-items.md appended
- **Commits:** 7 task commits + 1 docs commit

## Accomplishments

- **Phase 38 unblocked:** every interface the inference engine needs is now importable —
  `loadPsychologicalSubstrate` (substrate window + word-gate), `getPsychologicalProfiles`
  (prior-state reader), `MIN_SPEECH_WORDS` / `isAboveWordThreshold` (gate constants),
  `PsychologicalProfileType` (canonical union, re-exported from profiles.ts for stable path).
- **All 4 mitigated Pitfalls verified end-to-end:**
  - **Pitfall 2** (sparse-data overconfidence / gate composition): no `isAboveThreshold` import in psychological-shared.ts; Russian 4500-word fixture stays below threshold under whitespace-count (would cross under token-count).
  - **Pitfall 3** (speech-source contamination): SQL-level `eq(source, 'telegram')` + `or(isNull, ne(RITUAL_RESPONSE))`; integration test inserts gmail + RITUAL_RESPONSE rows at 6000 words each and asserts they are absent from corpus.
  - **Pitfall 4** (psychological vs operational boundary): two-directional regex sweep audit; 10 it cases passing; 0 violations across psych source files and 8 operational source files.
  - **Pitfall 7** (stripMetadata coverage): 11-column strip helper enumerated; attachment-only columns harmlessly absent on hexaco/schwartz; verified by Task 7 happy-path test parsing all 3 profile types successfully.
- **65/65 new tests passing on real Docker postgres** (full `bash scripts/test.sh` integration with migration 0013 smoke gates green):
  - psych-boundary-audit: 10/10
  - psychological-schemas: 35/35
  - psychological-shared: 11/11
  - psychological-profiles: 9/9
- **`npx tsc --noEmit` exits 0** for the full project.
- **Zero new npm dependencies** — luxon already available from Plan 37-01.

## Task Commits

1. **Task 1: Extend confidence.ts** — `10441ea` (feat)
2. **Task 2: Create psychological-shared.ts** — `00686a8` (feat)
3. **Task 3: Extend profiles.ts** — `501c8dd` (feat)
4. **Task 4: psych-boundary-audit.test.ts** — `f1ad744` (test)
5. **Task 5: psychological-schemas.test.ts** — `1ce1ef4` (test)
6. **Task 6: psychological-shared.test.ts** — `c4a0b0b` (test)
7. **Task 7: psychological-profiles.test.ts** — `d123d56` (test)

**Plan metadata commit** will be created after this SUMMARY.md is added.

## Files Created/Modified

### Created (5)

- **`src/memory/profiles/psychological-shared.ts`** — Substrate loader. Exports
  `PsychologicalProfileType` (`'hexaco' | 'schwartz' | 'attachment'`),
  `PsychologicalSubstrate<T>` (discriminated union), and
  `loadPsychologicalSubstrate<T>(profileType, now)`. Private `countWords` helper
  (whitespace split) and `PROFILE_TYPE_TO_TABLE_NAME` lookup. Imports
  `MIN_SPEECH_WORDS` from confidence.ts only — NO `isAboveThreshold` import.
  Calendar-month boundary via Luxon Europe/Paris. SQL source filter +
  RITUAL_RESPONSE exclusion at Drizzle WHERE clause.
- **`src/memory/profiles/__tests__/psych-boundary-audit.test.ts`** — D047
  two-directional regex sweep audit. `OPERATIONAL_VOCAB =
  /\b(jurisdictional|capital|health|family)\b/` forbidden in 2 psych files;
  `PSYCHOLOGICAL_VOCAB = /\b(hexaco|schwartz|attachment)\b/` forbidden in 8
  operational files. PROJECT_ROOT depth=4. profiles.ts intentionally omitted
  from both arrays (D-21); test file self-allowlisted by absence (D-34).
- **`src/memory/profiles/__tests__/psychological-schemas.test.ts`** — Unit
  tests for Zod v3+v4 dual schemas; 35 it cases covering cold-start
  (all-dim-null), populated, score boundary (1.0/5.0 OK, 0.5/5.5 reject),
  confidence boundary (0.0/1.0 OK, -0.1/1.1 reject), `.strict()` unknown-key
  rejection, v3/v4 lockstep parity. `makeDimensionFixture` helper.
- **`src/memory/profiles/__tests__/psychological-shared.test.ts`** — Real-DB
  integration tests for `loadPsychologicalSubstrate`; 7 describe blocks
  covering source filter (Pitfall 3), below/above-threshold branches, word-count
  accuracy (EN + Russian — Pitfall 2), calendar-month boundary (Luxon
  Europe/Paris DST-safe), prevHistorySnapshot lookup with profile_table_name
  narrowing, soft-deleted entries excluded. `cleanupTables` TRUNCATEs
  `pensieve_entries`, `episodic_summaries`, AND `profile_history`.
- **`src/memory/profiles/__tests__/psychological-profiles.test.ts`** — Mixed
  unit + real-DB integration tests for `getPsychologicalProfiles`; 5 describe
  blocks covering cold-start happy path (migration 0013 seed rows;
  last_updated coalesces to epoch per D-22), Layer 1 schema_mismatch
  (schema_version=999 → null + warn; siblings still parse), Layer 2
  parse_failed (corrupted jsonb → null + warn; siblings still parse), Layer 3
  unknown_error (`vi.spyOn(db, 'select')` throws → all 3 null + 3 warns),
  never-throws contract (cold-start + empty-tables).

### Modified (2)

- **`src/memory/confidence.ts`** — Append-only. New exports at end of file:
  `MIN_SPEECH_WORDS = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`,
  `isAboveWordThreshold(wordCount): boolean`. M010 helpers
  (`MIN_ENTRIES_THRESHOLD`, `SATURATION`, `computeProfileConfidence`,
  `isAboveThreshold`) unchanged. No `WORD_SATURATION` constant — explicitly
  deferred to Phase 38 per D-30.
- **`src/memory/profiles.ts`** — Append-only after `getOperationalProfiles`
  (~line 199). New imports: `profileHexaco/profileSchwartz/profileAttachment`
  from db/schema; 3 schemas + 3 types from `profiles/psychological-schemas`;
  `PsychologicalProfileType` re-export from `profiles/psychological-shared`.
  New code (in order): `PsychologicalProfiles` interface,
  `PSYCHOLOGICAL_PROFILE_SCHEMAS` module-private dispatcher,
  `stripPsychologicalMetadataColumns` module-private 11-column strip
  (id, name, schemaVersion, substrateHash, overallConfidence, wordCount,
  wordCountAtLastRun, lastUpdated, createdAt, relationalWordCount, activated),
  `readOnePsychologicalProfile<T>` module-private with 3-layer Zod defense
  + distinct log namespace, exported `getPsychologicalProfiles()`. M010
  reader path (`readOneProfile`, `stripMetadataColumns`, `PROFILE_SCHEMAS`,
  `getOperationalProfiles`, `formatProfilesForPrompt`) all untouched.

## Decisions Made

1. **Strict-less-than 5000-word gate.** `if (wordCount < MIN_SPEECH_WORDS)` so
   `wordCount === 5000` falls into the above-threshold branch — matches
   `isAboveWordThreshold`'s `>=` semantics. M009 lt→lte second-fire-bug
   lesson; tested explicitly in psychological-shared.test.ts.
2. **Below-threshold short-circuit before second query.** The below-threshold
   branch returns immediately, skipping `getEpisodicSummariesRange` and the
   `profile_history` SELECT. Saves two queries on the common cold-start path.
3. **Russian token-inflation fixture as Pitfall 2 regression test.** Inserts
   `"слово ".repeat(4500)` and asserts `wordCount === 4500` AND
   `belowThreshold === true`. Under token-based counting (cl100k_base) this
   would be ~10,000 tokens and incorrectly cross the gate; the whitespace
   counter keeps Cyrillic substrates on equal footing with Latin substrates.
4. **Calendar-month boundary fixtures use pre-computed UTC instants.** Rather
   than have the test do its own Luxon math (which would reproduce the
   production logic's potential bugs), test fixtures use literal UTC
   timestamps verified out-of-band against Luxon's `startOf('month',
   'Europe/Paris')` to anchor inclusion semantics deterministically.
5. **Plan-checker invariant compliance verified.** All 7 invariants from
   prompt context hold:
   - No `isAboveThreshold` import in psychological-shared.ts
   - SQL-level `or(isNull, ne(RITUAL_RESPONSE))` at Drizzle layer
   - Discriminated-union return shape with explicit narrowing branches
   - `getPsychologicalProfiles` never-throw + 3-layer Zod defense + 3 distinct
     log event names under `chris.psychological.profile.read.*` namespace
   - Two-directional `psych-boundary-audit.test.ts` with `\b` regex and
     self-allowlist by absence
   - Inline `text.trim().split(/\s+/).filter(s => s.length > 0).length`
     word counting (NOT token-based)
   - Luxon `DateTime.fromJSDate(now, { zone: 'Europe/Paris' }).startOf('month').minus({ months: 1 })`

## Deviations from Plan

**Minor documentation-wording adjustments only — no behavioral or structural deviations.**

### Documentation-only adjustments

**1. [Rule 1 - Bug] Soften forbidden-token mentions in docstrings to satisfy literal verify regex**
- **Found during:** Task 2 verification
- **Issue:** The plan's automated verify pattern
  `grep -v "^//" | grep -v "^\*" | grep -c "isAboveThreshold\|countTokens\|computeSubstrateHash"`
  was strict-line-anchored on `^*` and would not strip block-comment
  continuation lines (those start with ` * ` — leading space-star-space),
  so explanatory docstring mentions of "we do NOT import isAboveThreshold"
  triggered a false-positive non-zero count.
- **Fix:** Rewrote docstring prose to use semantic descriptions ("the M010
  entry-count gate helper", "token-based counting") rather than the literal
  tokens, while preserving the explanatory intent. No code change — the
  semantic invariant (no import, no call) was already correct; this is a
  documentation wording adjustment so the literal verify regex passes
  cleanly. Same approach applied to `psych-boundary-audit.test.ts` for
  the `profiles.ts` and self-test-file path mentions.
- **Files modified:** `src/memory/profiles/psychological-shared.ts`,
  `src/memory/profiles/__tests__/psych-boundary-audit.test.ts`
- **Verification:** Plan's exact verify commands now return 0 / 0 / 0; the
  semantic invariants (no import, no call) verified independently via
  `grep -E "^import\b"` and `grep -E "isAboveThreshold\("` (both clean).
- **Committed in:** part of Tasks 2 (00686a8) + 4 (f1ad744)

## Authentication Gates

None — no Anthropic API or external service calls were exercised during this
plan. All tests run against local Docker postgres only.

## Known Stubs

None. Every export shipped this plan has a real implementation; no
placeholder values, no "coming soon" notes, no empty-state shortcuts.

## Threat Flags

None — no new security-relevant surface introduced. All new code is
read-side (no INSERT/UPDATE except in test fixtures). Threat model in
plan frontmatter accurately enumerates surface; this plan's artifacts
match its `threat_model` table without additions.

## Deferred Issues

**Pre-existing live-API test failures** (29 tests across 5 files, all
matching `live-*.test.ts` pattern). These tests require a real
`ANTHROPIC_API_KEY` and fail with 401 in the sandbox environment. The 29
failures pre-exist Plan 37-02 — Plan 37-01's SUMMARY also documented them.
None of the failing tests import from `src/memory/confidence.ts`,
`src/memory/profiles.ts`, or any new Plan 37-02 file (verified via
`grep -nE "memory/confidence|memory/profiles" <failing-file>`).

See `.planning/phases/37-psychological-substrate/deferred-items.md` for
the full out-of-scope log.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`); plan-level TDD gates do not
apply. Per-task TDD discipline was not requested by any task (`tdd="false"`
on all 7 tasks).

## Test Run Output Snippets

### Targeted 4-file integration run (final verification)

```
🐘 Starting test postgres...
... (all 11 substrate gates green including migration 0013 verifications) ...
🧪 Running tests...
 RUN  v4.1.2 /home/claude/chris/.claude/worktrees/agent-a9ce12e5e5d654247

 Test Files  4 passed (4)
      Tests  65 passed (65)
   Start at  19:31:53
   Duration  1.66s (transform 139ms, setup 0ms, import 1.02s, tests 252ms, environment 0ms)

🧹 Stopping test postgres...
```

### Distinct log event names verified via grep

```
$ grep -c "chris\.psychological\.profile\.read\.\(schema_mismatch\|parse_failed\|unknown_error\)" \
    src/memory/profiles.ts
6
```

Three event names × two occurrences each (logger.warn call + JSDoc/comment
reference) = 6, as expected.

### Boundary-audit coverage matrix

| Direction | Vocab regex | Files audited | Hits | Status |
|---|---|---|---|---|
| psych → ops | `\b(jurisdictional\|capital\|health\|family)\b` | 2 psych source files | 0 | ✓ |
| ops → psych | `\b(hexaco\|schwartz\|attachment)\b` | 8 operational source files | 0 | ✓ |

10 `it` cases, all green; runtime <1s.

## Phase 37 Close-Out

**All 10 PSCH requirements complete.** Plan 37-01 shipped PSCH-01..06
(persistence + dual Zod schemas + smoke gates). Plan 37-02 shipped
PSCH-07..10 (substrate loader, word-count gate, never-throw reader, boundary
audit). Phase 38 (psychological inference engine) is unblocked — every
interface it depends on is importable:

- `import { loadPsychologicalSubstrate } from '../memory/profiles/psychological-shared.js';`
- `import { getPsychologicalProfiles } from '../memory/profiles.js';`
- `import { MIN_SPEECH_WORDS, isAboveWordThreshold } from '../memory/confidence.js';`
- `import type { PsychologicalProfileType } from '../memory/profiles.js';`

**Pitfall mitigation summary:**

| Pitfall | Mitigation | Verifying test |
|---|---|---|
| 2 (sparse-data overconfidence; gate composition) | No `isAboveThreshold` import in psychological-shared.ts; whitespace word counting | psychological-shared.test.ts "Russian 4500-word row → wordCount 4500, belowThreshold:true" |
| 3 (speech-source contamination) | SQL `eq(source, 'telegram')` + `or(isNull, ne(RITUAL_RESPONSE))` at Drizzle layer | psychological-shared.test.ts "returns only telegram + non-RITUAL_RESPONSE rows" |
| 4 (psych/ops vocabulary boundary) | Two-directional regex audit; 10 it cases | psych-boundary-audit.test.ts (10 cases) |
| 6 (audit false-positive on docstrings) | Locked vocab list narrow enough to avoid coincidence; remediation = rename docstring word, not relax regex | psych-boundary-audit.test.ts header docstring |
| 7 (stripMetadata column gap) | 11-column enumeration; attachment-only columns harmlessly absent on hexaco/schwartz | psychological-profiles.test.ts "happy path returns 3 non-null profiles" |

## Self-Check: PASSED

- `src/memory/confidence.ts` — FOUND (+60 lines)
- `src/memory/profiles.ts` — FOUND (+216 lines)
- `src/memory/profiles/psychological-shared.ts` — FOUND (created)
- `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` — FOUND (created)
- `src/memory/profiles/__tests__/psychological-schemas.test.ts` — FOUND (created)
- `src/memory/profiles/__tests__/psychological-shared.test.ts` — FOUND (created)
- `src/memory/profiles/__tests__/psychological-profiles.test.ts` — FOUND (created)
- Commit `10441ea` — FOUND
- Commit `00686a8` — FOUND
- Commit `501c8dd` — FOUND
- Commit `f1ad744` — FOUND
- Commit `1ce1ef4` — FOUND
- Commit `c4a0b0b` — FOUND
- Commit `d123d56` — FOUND
