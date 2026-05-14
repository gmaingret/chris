---
phase: 39
slug: psychological-surfaces
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <pattern>` for targeted unit + golden; `bash scripts/test.sh` for full DB |
| **Full suite command** | `bash scripts/test.sh` |
| **Estimated runtime** | ~60–120s full; ~5–10s targeted unit |

---

## Sampling Rate

- **After every task commit:** targeted vitest pattern; ~5–30s
- **After every plan wave:** `bash scripts/test.sh`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 30s targeted; 120s full

---

## Per-Task Verification Map

> Filled by planner with concrete task IDs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 39-01-XX | 39-01 | 1 | PSURF-01 | — | `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` exported; REFLECT/PSYCHOLOGY → ['hexaco','schwartz']; COACH absent | unit | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ W0 | ⬜ pending |
| 39-01-XX | 39-01 | 1 | PSURF-02 | — | `formatPsychologicalProfilesForPrompt` returns "" for empty/below-threshold; populated returns block with imported `PSYCHOLOGICAL_HARD_RULE_EXTENSION` footer | unit | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ W0 | ⬜ pending |
| 39-01-XX | 39-01 | 1 | PSURF-03 | — | `ChrisContextExtras` extended with `psychologicalProfiles?: string`; REFLECT + PSYCHOLOGY handlers wire reader → formatter → buildSystemPrompt; JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY silently drop | unit + handler integration | `npx vitest run src/chris` | ❌ W0 | ⬜ pending |
| 39-01-XX | 39-01 | 1 | PSURF-05 | — | COACH handler unmodified; negative-invariant test `coach-psychological-isolation.test.ts` asserts zero psych vocabulary in coach.ts | unit | `npx vitest run src/chris/modes/__tests__/coach-psychological-isolation.test.ts` | ❌ W0 | ⬜ pending |
| 39-02-XX | 39-02 | 2 | PSURF-04 | — | `/profile` extended: 3 new replies (HEXACO + Schwartz + Attachment) replace `MSG.m011Placeholder` at line 627; insufficient-data branch shows "need N more words" with N = max(0, 5000 - word_count); Attachment shows "not yet active (D028)" | unit + handler integration | `npx vitest run src/bot/handlers` | ❌ W0 | ⬜ pending |
| 39-02-XX | 39-02 | 2 | PSURF-05 | — | `formatPsychologicalProfileForDisplay` pure function + golden inline-snapshot test covers 4 scenarios (all-populated / all-insufficient / mixed / FR+RU slots) | unit | `npx vitest run src/bot/handlers/__tests__/profile-psychological.golden.test.ts` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/memory/profiles.ts` extended with `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt` (Plan 39-01)
- [ ] `src/chris/personality.ts` `ChrisContextExtras` extended with `psychologicalProfiles?: string` + substitution body extended to prepend above operationalProfiles (Plan 39-01)
- [ ] `src/chris/modes/reflect.ts`, `src/chris/modes/psychology.ts` extended with reader + formatter wiring (Plan 39-01)
- [ ] `src/chris/modes/coach.ts` NOT MODIFIED (negative-invariant target — Plan 39-01)
- [ ] `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` NEW (Plan 39-01)
- [ ] `src/memory/__tests__/profiles.test.ts` extended with formatter tests (Plan 39-01)
- [ ] `src/chris/__tests__/personality.test.ts` extended with substitution-order test (Plan 39-01)
- [ ] `src/bot/handlers/profile.ts` extended with `formatPsychologicalProfileForDisplay` + 3 new replies replacing line 627 (Plan 39-02)
- [ ] `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` NEW (Plan 39-02)
- [ ] `src/memory/profiles.ts` `ProfileRow<T>` extended with optional `wordCount?: number` + `wordCountAtLastRun?: number` (RESEARCH Open Q1; Plan 39-01)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First REFLECT mode response post-2026-06-01 cron fire | PSURF-02 | Real Sonnet output requires live cron fire + Greg's interaction | After 2026-06-01 09:00 Paris fire, send REFLECT-trigger message to bot; verify response framing references psychological profile per Hard Rule extension without sycophancy patterns |
| `/profile` Telegram command UX after first fire | PSURF-04 | Greg's manual UAT on real Telegram client | Send `/profile` to bot; verify 7 reply messages (4 operational + 3 psychological); verify HEXACO + Schwartz show actual scores or "need N more words"; verify Attachment shows "not yet active (D028)" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or W0 dependency
- [ ] Sampling continuity OK
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — planner fills concrete task IDs.
