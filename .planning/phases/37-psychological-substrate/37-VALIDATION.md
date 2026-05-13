---
phase: 37
slug: psychological-substrate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `bash scripts/test.sh --quick` (or `pnpm vitest run <pattern>` for targeted) |
| **Full suite command** | `bash scripts/test.sh` |
| **Estimated runtime** | ~60–120 seconds (full suite, real Docker postgres) |

---

## Sampling Rate

- **After every task commit:** Run targeted vitest pattern for the file just changed (e.g., `pnpm vitest run src/memory/profiles`)
- **After every plan wave:** Run `bash scripts/test.sh --quick` (includes migration apply + targeted suites)
- **Before `/gsd-verify-work`:** `bash scripts/test.sh` full suite must be green on fresh Docker postgres
- **Max feedback latency:** 30 seconds for targeted unit; 120 seconds for full suite

---

## Per-Task Verification Map

> Filled by planner — this draft seeds the structure. Planner replaces with concrete task IDs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 37-01-XX | 37-01 | 1 | PSCH-01 | — | Migration 0013 applies cleanly on fresh Docker postgres | integration | `bash scripts/test.sh` | ❌ W0 (migration not yet written) | ⬜ pending |
| 37-01-XX | 37-01 | 1 | PSCH-02 | — | Drizzle compile-time `.$type<HexacoDimension>` inference accepted | typecheck | `pnpm tsc --noEmit` | ❌ W0 | ⬜ pending |
| 37-01-XX | 37-01 | 1 | PSCH-03 | — | Schwartz 10 jsonb cols typed at compile time | typecheck | `pnpm tsc --noEmit` | ❌ W0 | ⬜ pending |
| 37-01-XX | 37-01 | 1 | PSCH-04 | — | profile_attachment includes relational_word_count + activated cols | integration | `bash scripts/test.sh` smoke gate | ❌ W0 | ⬜ pending |
| 37-01-XX | 37-01 | 1 | PSCH-05 | — | Cold-start seed rows present with `overall_confidence=0`, all dims NULL | integration | psql smoke check in `scripts/test.sh` | ❌ W0 | ⬜ pending |
| 37-01-XX | 37-01 | 1 | PSCH-06 | — | Zod v3+v4 dual schemas parse cold-start row + populated row | unit | `pnpm vitest run src/memory/profiles/__tests__/psychological-schemas` | ❌ W0 | ⬜ pending |
| 37-02-XX | 37-02 | 2 | PSCH-07 | — | loadPsychologicalSubstrate filters to `source='telegram'` + excludes RITUAL_RESPONSE | integration | `pnpm vitest run src/memory/profiles/__tests__/psychological-shared` (real DB) | ❌ W0 | ⬜ pending |
| 37-02-XX | 37-02 | 2 | PSCH-08 | — | belowThreshold returned when wordCount < 5000; no Sonnet call mocked | integration | `pnpm vitest run src/memory/profiles/__tests__/psychological-shared` | ❌ W0 | ⬜ pending |
| 37-02-XX | 37-02 | 2 | PSCH-09 | — | getPsychologicalProfiles returns null per profile on DB error; never throws | unit | `pnpm vitest run src/memory/__tests__/profiles` | ❌ W0 | ⬜ pending |
| 37-02-XX | 37-02 | 2 | PSCH-10 | — | psych-boundary-audit fails on operational vocab in psychological-*.ts (both directions) | unit | `pnpm vitest run src/memory/profiles/__tests__/psych-boundary-audit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Per `gsd-validate-phase` Nyquist convention. The planner must include these as setup tasks (W0) BEFORE green tests can pass.

- [ ] `src/db/migrations/0013_psychological_profiles.sql` — DDL + seed-row INSERTs (W0 for PSCH-01..05)
- [ ] `src/db/schema.ts` — profileHexaco, profileSchwartz, profileAttachment exports (W0 for PSCH-01..04)
- [ ] `src/db/migrations/meta/0013_snapshot.json` — regenerated via drizzle-kit (W0 for PSCH-01)
- [ ] `src/db/migrations/meta/_journal.json` — new idx 13 entry with monotonic `when` (W0 for PSCH-01)
- [ ] `src/memory/profiles/psychological-schemas.ts` — Zod v3+v4 dual schemas for HEXACO/Schwartz/Attachment (W0 for PSCH-06)
- [ ] `src/memory/confidence.ts` — extended with `MIN_SPEECH_WORDS = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`, `isAboveWordThreshold` (W0 for PSCH-08)
- [ ] `src/memory/profiles/psychological-shared.ts` — `loadPsychologicalSubstrate(profileType, now)` implementation (W0 for PSCH-07..08)
- [ ] `src/memory/profiles.ts` — extended with `PsychologicalProfileType`, `PSYCHOLOGICAL_PROFILE_SCHEMAS`, `getPsychologicalProfiles` (W0 for PSCH-09)
- [ ] `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` — regex sweep test file (W0 for PSCH-10)
- [ ] `scripts/test.sh` — append `psql ... < 0013_psychological_profiles.sql` line + extend smoke gate column-count assertion to 18 + 2 (W0 for PSCH-01)
- [ ] `scripts/regen-snapshots.sh` — bump `REGEN_PRODUCED_ACCEPTANCE` reference from 0012 → 0013 sentinels (W0 for PSCH-01)
- [ ] `src/memory/profiles/__tests__/psychological-shared.test.ts` — substrate loader tests (W0 for PSCH-07, PSCH-08)
- [ ] `src/memory/profiles/__tests__/psychological-schemas.test.ts` — Zod schema round-trip tests (W0 for PSCH-06)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None — all Phase 37 deliverables have automated verification | — | Substrate phase is purely persistence + read paths; no human-facing behavior in M011 until Phase 39 surfaces | — |

*All Phase 37 behaviors have automated verification (integration + unit + typecheck).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (migration SQL, schema.ts exports, psychological-schemas, psychological-shared, confidence extensions, reader API extensions, boundary-audit test)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (full suite); < 30s for targeted vitest pattern
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills concrete task IDs)

**Approval:** pending (planner must fill concrete task IDs in §Per-Task Verification Map before execute-phase)
