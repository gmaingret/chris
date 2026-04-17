---
phase: 14
slug: capture-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth test architecture is in `14-RESEARCH.md` → "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | None at repo root — Vitest defaults + `scripts/test.sh` orchestration |
| **Quick run command** | `npm run test:unit -- <file>` (single-file, no Docker) |
| **Full suite command** | `npm test` (Docker Postgres + migrations 0000→0004 + full vitest) |
| **Estimated runtime** | ~120 seconds full suite; ~5s single-file |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- <task's test file>` (quick, no Docker)
- **After every plan wave:** Run `npm test` (full Docker suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds (single-file); 120 seconds (full)

---

## Per-Task Verification Map

*Populated by gsd-planner from RESEARCH.md's requirements → test map. Every task SHOULD cite one of the test files listed below, or an existing test file being extended.*

| Plan | Wave | Requirement | Test File | Test Type | Automated Command |
|------|------|-------------|-----------|-----------|-------------------|
| triggers | 1 | CAP-01 | `src/decisions/__tests__/triggers.test.ts` | unit | `npm run test:unit -- src/decisions/__tests__/triggers.test.ts` |
| capture | 1 | CAP-02, CAP-03, CAP-04, LIFE-05 | `src/decisions/__tests__/capture.test.ts` | integration (mocked Haiku) | `npm run test:unit -- src/decisions/__tests__/capture.test.ts` |
| resolve-by | 1 | CAP-05 | `src/decisions/__tests__/resolve-by.test.ts` | integration | `npm run test:unit -- src/decisions/__tests__/resolve-by.test.ts` |
| vague-validator | 1 | CAP-05 (pushback) | `src/decisions/__tests__/vague-validator.test.ts` | integration | `npm run test:unit -- src/decisions/__tests__/vague-validator.test.ts` |
| suppressions | 1 | CAP-06 | `src/decisions/__tests__/suppressions.test.ts` | integration | `npm run test:unit -- src/decisions/__tests__/suppressions.test.ts` |
| engine-capture | 2 | SWEEP-03 | `src/decisions/__tests__/engine-capture.test.ts` | integration | `npm run test:unit -- src/decisions/__tests__/engine-capture.test.ts` |
| schema-migration | 1 | CAP-06 (DDL) | (migration 0004 via `npm test`) | integration (full) | `npm test` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All test files below are NEW — Wave 0 of every plan MUST include creating the test stub before the implementation task:

- [ ] `src/decisions/__tests__/triggers.test.ts` — CAP-01 stubs
- [ ] `src/decisions/__tests__/capture.test.ts` — CAP-02/03/04/LIFE-05 stubs
- [ ] `src/decisions/__tests__/resolve-by.test.ts` — CAP-05 stubs
- [ ] `src/decisions/__tests__/vague-validator.test.ts` — CAP-05 pushback stubs
- [ ] `src/decisions/__tests__/suppressions.test.ts` — CAP-06 stubs
- [ ] `src/decisions/__tests__/engine-capture.test.ts` — SWEEP-03 stubs
- [ ] Migration `drizzle/0004_<name>.sql` (via `npx drizzle-kit generate`) + `scripts/test.sh` MIGRATION_4_SQL line

Framework already installed (Vitest 4.1.2 in `package.json`). Docker Postgres harness already wired via `scripts/test.sh`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Discord capture conversation in EN/FR/RU feels natural (not interrogatory) | CAP-02 subjective quality | LLM prose quality is not grep-verifiable | Greg runs bot locally, types a structural decision in each language, walks through 5-slot capture, confirms the flow reads as conversational — not robotic. |
| Abort phrase catches Greg's actual phrasings | CAP-03 | Coverage of real human phrasings beyond the canonical list | Greg tries `"forget it"`, `"laisse tomber"`, `"забей"` mid-capture; confirms clean exit without residual state. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (6 new test files + migration)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (single-file) / < 120s (full)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
