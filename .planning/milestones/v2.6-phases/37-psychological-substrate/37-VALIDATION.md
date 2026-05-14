---
phase: 37
slug: psychological-substrate
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-13
updated: 2026-05-13
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <pattern>` for targeted unit; full suite via `bash scripts/test.sh` |
| **Full suite command** | `bash scripts/test.sh` (real Docker postgres + all migrations 0000–0013 + full vitest suite) |
| **Estimated runtime** | ~60–120 seconds (full suite); ~5–10 seconds (targeted unit, no DB) |

---

## Sampling Rate

- **After every task commit:** Run targeted vitest pattern for the file just changed (e.g., `npx vitest run src/memory/profiles/__tests__/psychological-schemas.test.ts`) — ~5–10 seconds, no DB.
- **After every plan wave:** Run `bash scripts/test.sh` (includes migration apply + smoke gates + targeted suites against Docker postgres) — ~2–3 minutes.
- **Before `/gsd-verify-work`:** `bash scripts/test.sh` full suite must be green on fresh Docker postgres.
- **Max feedback latency:** 30 seconds for targeted unit; 120 seconds for full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 37-01 | 1 | PSCH-06 | T-37-04 | Zod v3+v4 dual schemas for HEXACO/Schwartz/Attachment parse cold-start NULL + populated fixtures | unit + typecheck | `npx tsc --noEmit` + (Task 5 of 37-02 tests this) | ❌ W0 (psychological-schemas.ts not yet written) | ⬜ pending |
| 37-01-02 | 37-01 | 1 | PSCH-02, PSCH-03, PSCH-04 | T-37-07 | Drizzle compile-time `.$type<HexacoProfileData[dim]>` inference accepted; 3 pgTable exports + nullable jsonb cols | typecheck | `npx tsc --noEmit` | ❌ W0 (schema.ts not yet edited) | ⬜ pending |
| 37-01-03 | 37-01 | 1 | PSCH-01, PSCH-05 | T-37-01, T-37-05, T-37-06, T-37-08 | Migration 0013 SQL applies cleanly; 3 tables + 3 seed rows + Never-Retrofit Checklist | integration | `bash scripts/test.sh` (Phase 37 smoke gate) | ❌ W0 (SQL file not yet written) | ⬜ pending |
| 37-01-04 | 37-01 | 1 | PSCH-01 | T-37-02 | regen-snapshots.sh 0013→0014 sentinel bumps preserve committed 0013_snapshot.json | shell | `bash -n scripts/regen-snapshots.sh` + `bash scripts/regen-snapshots.sh` prints "No schema changes" | ❌ W0 | ⬜ pending |
| 37-01-05 | 37-01 | 1 | PSCH-01 | T-37-03 | _journal.json idx-13 entry has monotonic `when` > 1778482284254 | shell | `npx tsx scripts/validate-journal-monotonic.ts` | ❌ W0 (journal not yet appended) | ⬜ pending |
| 37-01-06 | 37-01 | 1 | PSCH-01, PSCH-02, PSCH-03, PSCH-04, PSCH-05 | T-37-08 | test.sh smoke gate asserts 3 tables + 3 seed rows + 18 Never-Retrofit cols + 2 attachment-only cols | integration | `bash scripts/test.sh` (Phase 37 smoke gate) | ❌ W0 (test.sh not yet extended) | ⬜ pending |
| 37-02-01 | 37-02 | 2 | PSCH-08 | T-37-13 | confidence.ts appended with MIN_SPEECH_WORDS=5000 + RELATIONAL_WORD_COUNT_THRESHOLD=2000 + isAboveWordThreshold using >=; M010 helpers untouched | typecheck + grep | `npx tsc --noEmit` + grep assertions | ❌ W0 (confidence.ts not yet appended) | ⬜ pending |
| 37-02-02 | 37-02 | 2 | PSCH-07, PSCH-08 | T-37-10, T-37-13 | loadPsychologicalSubstrate with source filter (telegram only, RITUAL_RESPONSE excluded), Luxon calendar-month boundary, 5000-word gate, discriminated-union return; no isAboveThreshold composition | typecheck | `npx tsc --noEmit` (tested by 37-02-06) | ❌ W0 (psychological-shared.ts not yet written) | ⬜ pending |
| 37-02-03 | 37-02 | 2 | PSCH-09 | T-37-09, T-37-14, T-37-15 | getPsychologicalProfiles never-throw + 3-layer Zod v3 parse defense + distinct log event namespace; existing M010 reader untouched | typecheck | `npx tsc --noEmit` (tested by 37-02-07) | ❌ W0 (profiles.ts not yet appended) | ⬜ pending |
| 37-02-04 | 37-02 | 2 | PSCH-10 | T-37-11, T-37-16 | psych-boundary-audit two-directional regex sweep; 10 file checks (2+8); self-allowlisted by absence from own arrays | unit | `npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | ❌ W0 (audit test not yet written) | ⬜ pending |
| 37-02-05 | 37-02 | 2 | PSCH-06 | T-37-04 | Zod v3+v4 schemas parse cold-start NULL + populated + boundary + .strict() + v3/v4 lockstep | unit | `npx vitest run src/memory/profiles/__tests__/psychological-schemas.test.ts` | ❌ W0 | ⬜ pending |
| 37-02-06 | 37-02 | 2 | PSCH-07, PSCH-08 | T-37-10, T-37-12, T-37-13 | Real-DB integration: source filter correctness, RITUAL_RESPONSE exclusion, 4800/5200-word branches, RU word-count accuracy, calendar-month boundary, prevHistorySnapshot lookup | integration | `bash scripts/test.sh` (psychological-shared.test.ts) | ❌ W0 | ⬜ pending |
| 37-02-07 | 37-02 | 2 | PSCH-09 | T-37-09, T-37-14, T-37-15 | Real-DB happy path (cold-start parse success) + 3-layer parse defense (mismatch/parse_failed/unknown_error mocked) + per-profile isolation + never-throw | integration + unit | `bash scripts/test.sh` (psychological-profiles.test.ts) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Per `gsd-validate-phase` Nyquist convention. The planner has included these as setup tasks (W0) BEFORE green tests can pass. All Wave 0 items have corresponding tasks in Plan 37-01 or Plan 37-02.

- [ ] `src/memory/profiles/psychological-schemas.ts` — Zod v3+v4 dual schemas (Plan 37-01 Task 1)
- [ ] `src/db/schema.ts` — profileHexaco, profileSchwartz, profileAttachment exports (Plan 37-01 Task 2)
- [ ] `src/db/migrations/0013_psychological_profiles.sql` — DDL + seed-row INSERTs (Plan 37-01 Task 3)
- [ ] `scripts/regen-snapshots.sh` — MIGRATION_13 var + 0013→0014 sentinel bumps (Plan 37-01 Task 4)
- [ ] `src/db/migrations/meta/0013_snapshot.json` — regenerated via drizzle-kit (Plan 37-01 Task 5)
- [ ] `src/db/migrations/meta/_journal.json` — new idx 13 entry with monotonic `when` (Plan 37-01 Task 5)
- [ ] `scripts/test.sh` — append `psql ... < 0013_psychological_profiles.sql` line + extend smoke gate column-count assertion to 18 + attachment-specific 2 (Plan 37-01 Task 6)
- [ ] `src/memory/confidence.ts` — extended with MIN_SPEECH_WORDS = 5000, RELATIONAL_WORD_COUNT_THRESHOLD = 2000, isAboveWordThreshold (Plan 37-02 Task 1)
- [ ] `src/memory/profiles/psychological-shared.ts` — `loadPsychologicalSubstrate(profileType, now)` implementation (Plan 37-02 Task 2)
- [ ] `src/memory/profiles.ts` — extended with `PsychologicalProfileType`, `PSYCHOLOGICAL_PROFILE_SCHEMAS`, `stripPsychologicalMetadataColumns`, `readOnePsychologicalProfile`, `getPsychologicalProfiles` (Plan 37-02 Task 3)
- [ ] `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` — regex sweep test (Plan 37-02 Task 4)
- [ ] `src/memory/profiles/__tests__/psychological-schemas.test.ts` — Zod schema round-trip tests (Plan 37-02 Task 5)
- [ ] `src/memory/profiles/__tests__/psychological-shared.test.ts` — substrate loader integration tests (Plan 37-02 Task 6)
- [ ] `src/memory/profiles/__tests__/psychological-profiles.test.ts` — never-throw reader tests (Plan 37-02 Task 7)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None — all Phase 37 deliverables have automated verification | — | Substrate phase is purely persistence + read paths; no human-facing behavior in M011 until Phase 39 surfaces | — |

*All Phase 37 behaviors have automated verification (integration + unit + typecheck).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies listed
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (migration SQL, schema.ts exports, psychological-schemas, psychological-shared, confidence extensions, reader API extensions, boundary-audit test, integration tests)
- [x] No watch-mode flags
- [x] Feedback latency < 120s (full suite); < 30s for targeted vitest pattern
- [x] `nyquist_compliant: true` set in frontmatter (planner has filled concrete task IDs)

**Approval:** APPROVED — planner has filled concrete task IDs in §Per-Task Verification Map. Each PSCH requirement maps to at least one task with an `<automated>` verify command. Wave 0 dependencies are satisfied by tasks within the same plan (no cross-phase blocking).
