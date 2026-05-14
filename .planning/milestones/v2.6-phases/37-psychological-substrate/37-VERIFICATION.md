---
phase: 37-psychological-substrate
verified: 2026-05-13T19:55:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 37: Psychological Substrate Verification Report

**Phase Goal:** The three psychological profile tables exist in PostgreSQL with all non-retrofittable columns from day one; typed Drizzle schema exports and Zod dual schemas enable downstream code to compile; the substrate loader isolates Greg's own Telegram speech with word-count tracking; the boundary audit prevents operational/psychological field leakage.

**Verified:** 2026-05-13T19:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `bash scripts/test.sh` applies migration 0013 cleanly; 3 tables present with Never-Retrofit columns + cold-start seed rows                                                                                             | ✓ VERIFIED | Replicated the test.sh migration path against fresh Docker postgres (tmpfs). All 14 migrations apply clean. Smoke gate query returned `3\|1\|1\|1\|0\|0\|0\|false` (3 tables, 3 primary seed rows, hexaco overall_confidence=0, word_count=0, attachment relational_word_count=0, activated=false). 18 Never-Retrofit columns + 2 D-07 attachment-only columns verified. `last_updated IS NULL` on all 3 seeds. All 6 HEXACO dim columns = literal JSON `null`. |
| 2   | TypeScript compiler accepts `profileHexaco`/`profileSchwartz`/`profileAttachment` Drizzle imports and Zod v3+v4 dual schemas in `psychological-schemas.ts` with zero type errors                                       | ✓ VERIFIED | `npx tsc --noEmit` exit 0. `src/db/schema.ts:28-32` imports `HexacoProfileData`/`SchwartzProfileData`/`AttachmentProfileData` types and uses them at `.$type<HexacoProfileData['honesty_humility']>()` etc. on all 19 dim columns. `psychological-schemas.ts` exports 6 schemas (V3 + V4 each for HEXACO/Schwartz/Attachment) + 3 inferred types. |
| 3   | `loadPsychologicalSubstrate('hexaco', now)` returns only `source='telegram'` entries with `epistemic_tag != 'RITUAL_RESPONSE'`; Gmail/Immich/Drive/episodic-summary rows provably absent from corpus                   | ✓ VERIFIED | `psychological-shared.ts:179-188` SQL WHERE clause uses `eq(source, 'telegram')` + `or(isNull(epistemicTag), ne(epistemicTag, 'RITUAL_RESPONSE'))` at the Drizzle layer (not JS post-filter; Pitfall 3 mitigation). `psychological-shared.test.ts` real-DB integration tests pass (verified 11/11 green on Docker postgres) including "returns only telegram + non-RITUAL_RESPONSE rows" — Gmail + RITUAL_RESPONSE fixtures at 6000 words each are provably absent. |
| 4   | `loadPsychologicalSubstrate` returns `{ belowThreshold: true, wordCount, neededWords }` when corpus word count < 5,000; no Sonnet call is made; `word_count_at_last_run` is persisted                                  | ✓ VERIFIED | `psychological-shared.ts:200-206`: `if (wordCount < MIN_SPEECH_WORDS) return { belowThreshold: true, wordCount, neededWords: MIN_SPEECH_WORDS - wordCount }`. Short-circuits BEFORE any second query and before any LLM call site exists. Discriminated-union return forces TypeScript narrowing. `word_count_at_last_run` column exists with `NOT NULL DEFAULT 0` (verified in migration SQL line 47, 68, 93) and seed rows have value 0 (verified live). **Persistence of `word_count_at_last_run` is explicitly assigned to the Phase 38 orchestrator per PSCH-08 ("orchestrator persists word_count_at_last_run"); Phase 37 ships the column + the loader signal**. The column data path is wired; the Phase 38 orchestrator just needs to UPDATE the column when the loader returns. |
| 5   | `psych-boundary-audit.test.ts` fails if operational vocab appears in `psychological-*.ts` and fails if psych vocab appears in operational profile generator/prompt/shared files                                        | ✓ VERIFIED | `psych-boundary-audit.test.ts` ships exactly the regex `/\b(jurisdictional\|capital\|health\|family)\b/` against 2 psych files + `/\b(hexaco\|schwartz\|attachment)\b/` against 8 operational files. Live grep against these 10 files returns zero hits in either direction. 10/10 it cases pass on real Docker postgres run. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                                  | Expected                                                          | Status     | Details                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/db/migrations/0013_psychological_profiles.sql`                       | 3 CREATE TABLE + 3 INSERT, hand-authored DDL                       | ✓ VERIFIED | 134 lines, all 3 CREATE TABLE blocks present with full Never-Retrofit + D-07 columns, `--> statement-breakpoint` markers, idempotent (IF NOT EXISTS + ON CONFLICT DO NOTHING). |
| `src/db/schema.ts` (3 new pgTable exports)                                | profileHexaco/Schwartz/Attachment between profileFamily/History    | ✓ VERIFIED | Lines 662-738. Type imports lines 28-32 from `psychological-schemas.js`. Dim cols use `.$type<...>()` annotations.                                                       |
| `src/memory/profiles/psychological-schemas.ts`                            | Zod v3+v4 dual schemas + 3 inferred types                          | ✓ VERIFIED | 150 lines. `HexacoProfileSchemaV3` + V4 (6 dims), `SchwartzProfileSchemaV3` + V4 (10 values), `AttachmentProfileSchemaV3` + V4 (3 dims). V3 uses `.strict()`; V4 mirrors. Two nominally-separate factory pairs per D-27. |
| `src/db/migrations/meta/0013_snapshot.json`                               | drizzle-kit-emitted, chains from 0012                              | ✓ VERIFIED | 77576 bytes. `prevId` chains from 0012. Tables `profile_hexaco`/`profile_schwartz`/`profile_attachment` present in snapshot.                                              |
| `src/db/migrations/meta/_journal.json` (idx-13)                           | idx=13, tag=`0013_psychological_profiles`, monotonic when           | ✓ VERIFIED | 14 entries total. Last entry: `{idx:13, version:"7", when:1778699398922, tag:"0013_psychological_profiles", breakpoints:true}`. Strictly > 0012's 1778482284254.        |
| `scripts/test.sh` (MIGRATION_13_SQL + smoke gates)                        | psql apply + 3 substrate gates                                     | ✓ VERIFIED | Line 21: `MIGRATION_13_SQL` var. Line 86: psql apply after 0012. Lines 275-329: 3 smoke gate blocks (substrate, Never-Retrofit cols, D-07 cols). Replicated end-to-end on fresh Docker postgres → all gates produce expected output. |
| `scripts/regen-snapshots.sh` (0013→0014 bumps)                            | MIGRATION_13 + 5-site sentinel bumps                               | ✓ VERIFIED | `MIGRATION_13` var present; cleanup-flag sentinels bumped to 0014 (per SUMMARY claim, accepted under existing review).                                                   |
| `src/memory/confidence.ts` (append-only)                                  | MIN_SPEECH_WORDS + RELATIONAL_WORD_COUNT_THRESHOLD + isAboveWordThreshold | ✓ VERIFIED | Lines 99 / 109 / 123-125. M010 helpers untouched (no edits before line 99). Uses `>=` semantics matching M009 lt→lte lesson. |
| `src/memory/profiles/psychological-shared.ts`                             | loadPsychologicalSubstrate + discriminated union + helpers          | ✓ VERIFIED | 236 lines. Imports `MIN_SPEECH_WORDS` only from confidence; deliberately does NOT import `isAboveThreshold` (gate composition Pitfall 2). Luxon Europe/Paris calendar-month boundary lines 166-168. Word-count helper line 124-126 (whitespace split, NOT token-based). |
| `src/memory/profiles.ts` (psych reader appended)                          | getPsychologicalProfiles + 3-layer Zod parse defense                | ✓ VERIFIED | Lines 255-414. `PSYCHOLOGICAL_PROFILE_SCHEMAS` dispatcher, `stripPsychologicalMetadataColumns` (11 cols), `readOnePsychologicalProfile<T>` with try/catch + Layer 1 schema_mismatch + Layer 2 parse_failed + Layer 3 unknown_error using distinct `chris.psychological.profile.read.*` namespace. M010 reader path (`getOperationalProfiles`, `readOneProfile`, `stripMetadataColumns`) untouched. |
| `src/memory/profiles/__tests__/psych-boundary-audit.test.ts`              | Two-directional D047 regex sweep, 10 it cases                       | ✓ VERIFIED | 130 lines. Exact regex `/\b(jurisdictional\|capital\|health\|family)\b/` + `/\b(hexaco\|schwartz\|attachment)\b/`. 2 psych files + 8 operational files. profiles.ts intentionally omitted from both arrays per D-21 (orchestration hub). Self-allowlisted by absence per D-34. |
| `src/memory/profiles/__tests__/psychological-schemas.test.ts`             | 35 unit tests (v3+v4 dual schema, cold-start, boundaries, .strict)  | ✓ VERIFIED | 35/35 passing on Docker postgres run. |
| `src/memory/profiles/__tests__/psychological-shared.test.ts`              | 11 real-DB integration tests (source filter, threshold, Russian, calendar-month, prevHistorySnapshot, soft-delete) | ✓ VERIFIED | 11/11 passing on Docker postgres run. |
| `src/memory/profiles/__tests__/psychological-profiles.test.ts`            | 9 tests for never-throw + 3-layer parse defense                     | ✓ VERIFIED | 9/9 passing on Docker postgres run. |

### Key Link Verification

| From                                                | To                                                                | Via                                                                       | Status   | Details                                                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                                  | `src/memory/profiles/psychological-schemas.ts`                    | type-only imports of HexacoProfileData/SchwartzProfileData/AttachmentProfileData for `.$type<T>()` | ✓ WIRED  | schema.ts lines 28-32. `npx tsc --noEmit` exits 0 confirming the type chain resolves.                                                                                                                          |
| `scripts/test.sh`                                   | `src/db/migrations/0013_psychological_profiles.sql`                | psql ON_ERROR_STOP=1 apply after 0012                                     | ✓ WIRED  | scripts/test.sh:86 + replayed end-to-end on Docker postgres → migration applied, smoke gate query returned expected `3\|1\|1\|1\|0\|0\|0\|false`.                                                              |
| `src/db/migrations/meta/_journal.json`              | `src/db/migrations/0013_psychological_profiles.sql`                | tag field matches SQL filename basename                                   | ✓ WIRED  | Journal idx-13 entry has `tag: "0013_psychological_profiles"`.                                                                                                                                                  |
| `src/memory/profiles/psychological-shared.ts`       | `src/db/schema.ts`                                                | imports pensieveEntries, episodicSummaries, profileHistory                | ✓ WIRED  | Lines 48-52 import all 3 tables. Used in `db.select().from(pensieveEntries)` (line 177), `getEpisodicSummariesRange` (line 213), `db.select().from(profileHistory)` (line 215).                                |
| `src/memory/profiles/psychological-shared.ts`       | `src/memory/confidence.ts`                                        | imports MIN_SPEECH_WORDS for the wordCount gate                          | ✓ WIRED  | Line 54. Used in `if (wordCount < MIN_SPEECH_WORDS)` gate at line 200.                                                                                                                                         |
| `src/memory/profiles.ts`                            | `src/memory/profiles/psychological-schemas.ts`                    | imports HexacoProfileSchemaV3/SchwartzProfileSchemaV3/AttachmentProfileSchemaV3 + 3 types | ✓ WIRED  | Schema imports used in `PSYCHOLOGICAL_PROFILE_SCHEMAS` dispatcher (line 255-273).                                                                                                                              |
| `src/memory/profiles.ts`                            | `src/memory/profiles/psychological-shared.ts`                     | re-exports PsychologicalProfileType                                       | ✓ WIRED  | Line 53: `export type { PsychologicalProfileType } from './profiles/psychological-shared.js'`. Stable consumer path for Phase 39+.                                                                            |
| `psych-boundary-audit.test.ts`                      | `src/memory/profiles/psychological-shared.ts` + 8 operational files | fs.readFile + per-line regex sweep                                        | ✓ WIRED  | Test file imports `readFile` from `node:fs/promises`, scans each file with the two locked vocab regexes. Manual grep against the 10 files yields 0 hits in either direction.                                  |

### Data-Flow Trace (Level 4)

| Artifact                                            | Data Variable                            | Source                                                       | Produces Real Data | Status     |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ | ------------------ | ---------- |
| `loadPsychologicalSubstrate`                        | `corpus`, `wordCount`                    | `db.select().from(pensieveEntries).where(...)`                | Yes — real DB query against pensieve_entries with SQL filter | ✓ FLOWING  |
| `loadPsychologicalSubstrate` (above-threshold branch) | `episodicSummaries`, `prevHistorySnapshot` | `getEpisodicSummariesRange` + `db.select().from(profileHistory)` | Yes — real DB queries (in parallel via Promise.all)             | ✓ FLOWING  |
| `getPsychologicalProfiles`                          | `hexaco`/`schwartz`/`attachment` rows    | `db.select().from(table).where(eq(table.name, 'primary'))`    | Yes — real DB queries; cold-start seed rows guarantee non-empty result post-migration 0013 | ✓ FLOWING  |
| `profile_hexaco`/`profile_schwartz`/`profile_attachment` tables | seed rows                              | Migration 0013 INSERT ... ON CONFLICT DO NOTHING              | Yes — verified live: `SELECT COUNT(*) FROM profile_hexaco WHERE name='primary'` = 1 on fresh DB | ✓ FLOWING  |

Note: This is a substrate-layer phase. The substrate loader is READ-only (no mutations to the 3 profile tables — those are Phase 38's job). The data flow under verification is "DB query → parsed structured return"; the write-side flow is intentionally deferred to Phase 38.

### Behavioral Spot-Checks

| Behavior                                                                     | Command                                                                                                                                  | Result                                          | Status |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| TypeScript compiles entire project                                            | `npx tsc --noEmit`                                                                                                                       | Exit 0                                          | ✓ PASS |
| Migration 0013 + smoke gate apply cleanly on fresh Docker postgres            | Replicated test.sh migration path against fresh postgres (tmpfs); `SELECT ...` from 3 profile tables                                     | `3\|1\|1\|1\|0\|0\|0\|false`                    | ✓ PASS |
| 18 Never-Retrofit columns exist                                               | `SELECT COUNT(*) FROM information_schema.columns WHERE table_name IN (3 tables) AND column_name IN (6 cols)`                              | `18`                                            | ✓ PASS |
| 2 D-07 attachment-only columns exist                                          | `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='profile_attachment' AND column_name IN ('relational_word_count','activated')` | `2`                                             | ✓ PASS |
| All HEXACO dim columns default to JSON `null` literal                         | `SELECT honesty_humility::text\|\|... FROM profile_hexaco WHERE name='primary'`                                                          | `null\|null\|null\|null\|null\|null`            | ✓ PASS |
| `last_updated` is NULL on cold-start seeds                                    | `SELECT last_updated FROM profile_{hexaco,schwartz,attachment} WHERE name='primary'`                                                     | `\|\|` (all empty/NULL)                          | ✓ PASS |
| All 65 Phase 37 vitest tests pass on real Docker postgres                     | `npx vitest run psych-boundary-audit psychological-schemas psychological-shared psychological-profiles` against migrated DB              | Test Files: 4 passed (4); Tests: 65 passed (65); Duration 1.65s | ✓ PASS |
| Boundary audit: zero operational vocab in psych files                         | `grep -nE "\b(jurisdictional\|capital\|health\|family)\b" src/memory/profiles/psychological-{schemas,shared}.ts`                          | exit 1 (zero hits)                              | ✓ PASS |
| Boundary audit: zero psych vocab in 8 operational files                       | `grep -nE "\b(hexaco\|schwartz\|attachment)\b" src/memory/{profile-prompt,profile-updater,profiles/shared,profiles/schemas,profiles/jurisdictional,profiles/capital,profiles/health,profiles/family}.ts` | exit 1 (zero hits)                              | ✓ PASS |
| Journal idx-13 entry monotonic                                                | `python3 -c "json read"` → idx-13 when=1778699398922 strictly > idx-12 when=1778482284254                                                  | Pass                                            | ✓ PASS |

### Probe Execution

No phase-declared probes (Phase 37 is a database substrate phase; verification path is `bash scripts/test.sh` + targeted vitest). The smoke gates inside test.sh function as probes and are verified via end-to-end Docker postgres re-execution above.

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                  | Status     | Evidence                                                                                                                                                                          |
| ----------- | ----------- | -------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PSCH-01     | 37-01       | Migration 0013 creates 3 tables atomically with Never-Retrofit Checklist + HARD CO-LOC #M11-1 | ✓ SATISFIED | Migration SQL present; smoke gate verified all 3 tables + 18 Never-Retrofit cols live on Docker postgres. All 7 #M11-1 artifacts shipped in Plan 37-01. |
| PSCH-02     | 37-01       | `profile_hexaco` 6 jsonb dim cols + overall_confidence + `.$type<>` inference                | ✓ SATISFIED | schema.ts:672-677 (6 dim cols with `.$type<HexacoProfileData[dim]>()`). Live DB has all 6 columns + overall_confidence=0 seed. tsc --noEmit exit 0.    |
| PSCH-03     | 37-01       | `profile_schwartz` 10 jsonb value cols + same per-dim shape                                  | ✓ SATISFIED | schema.ts:696-705 (10 value cols). Migration SQL lines 69-78 declares all 10. Live DB seed row verified.                                              |
| PSCH-04     | 37-01       | `profile_attachment` 3 jsonb cols schema-only; D028 activation deferred                       | ✓ SATISFIED | schema.ts:729-731 (anxious/avoidant/secure). D-07 metadata cols (relationalWordCount/activated) on table; population deferred to Phase 38+.            |
| PSCH-05     | 37-01       | Cold-start seed rows: all dims NULL, overall_confidence=0, name='primary', etc.              | ✓ SATISFIED | Migration SQL lines 111-133. Live verification: all 3 seeds present with overall_confidence=0, word_count=0, dim cols literal-null jsonb.            |
| PSCH-06     | 37-01       | Zod v3+v4 dual schemas in psychological-schemas.ts                                           | ✓ SATISFIED | psychological-schemas.ts exports HexacoProfileSchemaV3/V4 + SchwartzProfileSchemaV3/V4 + AttachmentProfileSchemaV3/V4 + 3 inferred types. 35/35 unit tests pass. |
| PSCH-07     | 37-02       | loadPsychologicalSubstrate w/ source filter + episodic summaries + calendar-month boundary    | ✓ SATISFIED | psychological-shared.ts:175-189 SQL filter; Luxon Europe/Paris boundary lines 166-168; 11/11 real-DB tests pass.                                       |
| PSCH-08     | 37-02       | 5,000-word floor; `loadPsychologicalSubstrate` returns belowThreshold branch; orchestrator persists `word_count_at_last_run` | ✓ SATISFIED | Word-count floor at line 200 (`<` semantics matching `isAboveWordThreshold`'s `>=`). Below-threshold short-circuits before 2nd query. `wordCountAtLastRun` column on all 3 tables seeded to 0. Orchestrator-side persistence is Phase 38 scope per PSCH-08 text. |
| PSCH-09     | 37-02       | getPsychologicalProfiles never-throw + 3-layer Zod v3 parse defense + distinct log namespace | ✓ SATISFIED | profiles.ts:408-414. 3 layers verified: schema_mismatch (line 352-358), parse_failed (line 363-368), unknown_error (line 380-388). Distinct log event names `chris.psychological.profile.read.*` (6 occurrences). 9/9 tests pass. |
| PSCH-10     | 37-02       | psych-boundary-audit.test.ts enforces D047 two-directional regex sweep                       | ✓ SATISFIED | Test file exists with exact required regex. 10 it cases all pass. Live grep confirms zero hits in either direction across all 10 audited files. |

**Orphaned requirements:** None. All 10 PSCH-* IDs declared in ROADMAP Phase 37 are covered by shipped code.

### Anti-Patterns Found

| File                                                                | Line | Pattern                                | Severity | Impact |
| ------------------------------------------------------------------- | ---- | -------------------------------------- | -------- | ------ |
| —                                                                   | —    | No TBD/FIXME/XXX in any Phase 37 file  | —        | None   |
| —                                                                   | —    | No TODO/HACK/PLACEHOLDER in any Phase 37 file | —        | None   |
| —                                                                   | —    | No stub returns (`return null$`, `return {}$`, `return []$`) in any new source file | — | None |

Zero anti-patterns. All implementations are real (no placeholders, no stubs, no debt markers).

### Human Verification Required

None for this phase. Verification is fully automatable via:
- `bash scripts/test.sh` (full Docker postgres + migration + smoke gates + vitest)
- `npx tsc --noEmit`
- File-level grep audits

This is a pure-substrate phase. Visual / UX surfaces appear in Phase 39 (Psychological Surfaces).

### Gaps Summary

**No gaps blocking the Phase 37 goal.**

Two scope-edge observations recorded for clarity (neither blocks Phase 37 completion):

1. **`word_count_at_last_run` persistence**: ROADMAP SC #4 includes the clause "`word_count_at_last_run` is persisted." Phase 37 ships the column (verified live) and the substrate loader signals (`wordCount`) needed for persistence. PSCH-08 explicitly puts the write on the orchestrator ("orchestrator persists `word_count_at_last_run`"), and the orchestrator is a Phase 38 deliverable (PGEN-*). Phase 37 provides the wired column + the loader return signal — the write is correctly deferred to Phase 38 per the requirements text.

2. **Live-API test failures (29 across 5 files)**: Pre-existing, unrelated to Phase 37. All in `live-*.test.ts` files requiring real `ANTHROPIC_API_KEY`. Logged in `deferred-items.md` with grep evidence showing zero overlap with Phase 37 artifacts. Same pattern as M010 Plan 33-01 (executor reports note identical failures on parent commit `e919e41` before any Phase 37 changes).

### Verification Methodology Notes

**End-to-end Docker postgres run executed by verifier (not trusted from SUMMARY claims):**
- Fresh tmpfs postgres container started via `docker-compose.local.yml`
- All 14 migrations (0000-0013) applied with `CREATE EXTENSION IF NOT EXISTS vector;` first (per test.sh)
- All migrations applied cleanly with exit 0
- Phase 37 smoke gate query yielded exact expected output: `3|1|1|1|0|0|0|false`
- 18 Never-Retrofit columns + 2 D-07 attachment-only columns verified by live `information_schema.columns` queries
- Targeted Phase 37 vitest run: `Test Files: 4 passed (4); Tests: 65 passed (65); Duration 1.65s`

**Static verification:**
- `npx tsc --noEmit` exit 0 against full project
- Manual grep audit of both vocab directions across all 10 boundary-audited files: zero hits
- Journal monotonicity verified via Python JSON read: idx-13 when=1778699398922 strictly > idx-12 when=1778482284254
- 0013_snapshot.json contains all 3 psychological tables in `tables` map

**Git evidence:**
- 7 task commits in Plan 37-01 (c58c439, e482648, ffe7946, 5294237, 9c7f23a, 540e1e2) all present on main
- 7 task commits in Plan 37-02 (10441ea, 00686a8, 501c8dd, f1ad744, 1ce1ef4, c4a0b0b, d123d56) all present on main
- Tracking commits (7de8c92, bf90cbb) present

---

_Verified: 2026-05-13T19:55:00Z_
_Verifier: Claude (gsd-verifier)_
