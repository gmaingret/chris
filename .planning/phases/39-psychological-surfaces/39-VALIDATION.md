---
phase: 39
slug: psychological-surfaces
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
updated: 2026-05-14
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 39-01-01 | 39-01 | 1 | PSURF-01 (partial) | T-39-01-V11-02 | `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` exported with REFLECT/PSYCHOLOGY → ['hexaco','schwartz']; COACH absent from key union; `ProfileRow<T>` extended with `wordCount?`/`wordCountAtLastRun?`; `PSYCHOLOGICAL_HARD_RULE_EXTENSION` imported (not redeclared) | unit + structural grep | `grep -c "export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP" src/memory/profiles.ts \| awk '$1==1 {print "OK"}'` AND `npx tsc --noEmit` | ✅ pre-existing file modified | ⬜ pending |
| 39-01-02 | 39-01 | 1 | PSURF-01 (shape tests) + PSURF-02 | T-39-01-V11-01 + T-39-01-V7-01 | `formatPsychologicalProfilesForPrompt` honors 4 empty-string gates (D-05.a/b/c/d); appends imported `PSYCHOLOGICAL_HARD_RULE_EXTENSION` at bottom (D-11); per-dim line format `'<DIM> <Trait>: X.X / 5.0 (confidence Y.Y — <qualifier>)'` with 3-tier qualifier (D-07); 13+ formatter unit tests + 5+ map-shape tests | unit | `npx vitest run src/memory/__tests__/profiles.test.ts --reporter=basic` | ✅ pre-existing file modified | ⬜ pending |
| 39-01-03 | 39-01 | 1 | PSURF-03 | T-39-01-V11-03 | `ChrisContextExtras.psychologicalProfiles?: string`; REFLECT + PSYCHOLOGY substitution body uses `[psychologicalProfiles, operationalProfiles, contextValue].filter(Boolean).join('\\n\\n')` (D-11); COACH case body unchanged; JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY silently drop; 9+ substitution-order tests | unit | `npx vitest run src/chris/__tests__/personality.test.ts --reporter=basic` | ✅ pre-existing file modified | ⬜ pending |
| 39-01-04 | 39-01 | 1 | PSURF-03 (handler wiring) + PSURF-05 (COACH-isolation half) | T-39-01-V11-02 | REFLECT + PSYCHOLOGY handlers wire `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt → buildSystemPrompt(..., { ..., psychologicalProfiles })` sequentially per D-13/D-16; coach.ts NOT modified; NEW `coach-psychological-isolation.test.ts` runs per-line regex sweep over PSYCH_VOCAB pattern; failure message references PITFALLS.md §1 + D027 | unit + structural regex sweep + integration | `npx vitest run src/chris/modes --reporter=basic` AND `bash scripts/test.sh` | ✅ created Wave 1 | ⬜ pending |
| 39-02-01 | 39-02 | 2 | PSURF-04 (MSG localization) | T-39-02-V7-02 | `MSG.psychologicalSections` added with hexaco/schwartz/attachment sub-trees + EN/FR/RU machine-translate-quality strings per D-20; `MSG.m011Placeholder` removed; imports extended for `getPsychologicalProfiles`, `PsychologicalProfileType`, `HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData` | structural grep + tsc | `grep -c "psychologicalSections" src/bot/handlers/profile.ts \| awk '$1>=1 {print "OK"}'` AND `npx tsc --noEmit` | ✅ pre-existing file modified | ⬜ pending |
| 39-02-02 | 39-02 | 2 | PSURF-05 (display formatter half) | T-39-02-V7-01 + T-39-02-V8-02 | `formatPsychologicalProfileForDisplay(profileType, profile, lang)` pure function implements D-19 4-branch state model (attachment-always-deferred / null+never-fired / insufficient-data / populated); Title-Case dim labels + 1-decimal score/confidence + D-07 qualifier; D-09 per-dim filter; reads `profile.wordCountAtLastRun` for N calculation | unit (driven by Task 39-02-03 golden test) | `grep -c "export function formatPsychologicalProfileForDisplay" src/bot/handlers/profile.ts \| awk '$1==1 {print "OK"}'` AND `npx tsc --noEmit` | ✅ pre-existing file modified | ⬜ pending |
| 39-02-03 | 39-02 | 2 | PSURF-04 (3-reply loop) + PSURF-05 (golden snapshot half) — HARD CO-LOC #M11-3 atomic | T-39-02-V7-01 + T-39-02-V7-03 + T-39-02-V8-02 | `handleProfileCommand` replaces line-627 `MSG.m011Placeholder` reply with sequential `for (const type of ['hexaco','schwartz','attachment'] as const)` loop emitting 3 new `ctx.reply(formatPsychologicalProfileForDisplay(...))` calls; NEW `profile-psychological.golden.test.ts` with ≥12 `toMatchInlineSnapshot` cases covering D-24 4 scenarios × FR/RU variants; D-09 per-dim filter explicit non-snapshot assertion `not.toContain('Stimulation:')` + `not.toContain('Hedonism:')` for mixed scenario; `vi.setSystemTime` only (D-02) | golden snapshot + handler integration | `npx vitest run src/bot/handlers/__tests__/profile-psychological.golden.test.ts --reporter=basic` AND `bash scripts/test.sh` | ✅ created Wave 2 | ⬜ pending |

---

## Wave 0 Requirements

All pre-existing files referenced by tasks are present (verified 2026-05-14):
- [x] `src/memory/profiles.ts` exists (Phase 37/38 deliverable — Plan 39-01 extends)
- [x] `src/memory/psychological-profile-prompt.ts` exists (Phase 38 deliverable — Plan 39-01 imports from)
- [x] `src/memory/profiles/psychological-schemas.ts` exists (Phase 37 deliverable — type imports)
- [x] `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` exists (Phase 37 PSCH-10 — structural mirror for new coach-isolation test)
- [x] `src/memory/__tests__/profiles.test.ts` exists (Phase 33/35 deliverable — Plan 39-01 extends)
- [x] `src/chris/personality.ts` exists (Phase 35 deliverable — Plan 39-01 extends)
- [x] `src/chris/__tests__/personality.test.ts` exists (Phase 35 deliverable — Plan 39-01 extends)
- [x] `src/chris/modes/reflect.ts` exists (Phase 35 deliverable — Plan 39-01 extends)
- [x] `src/chris/modes/psychology.ts` exists (Phase 35 deliverable — Plan 39-01 extends)
- [x] `src/chris/modes/coach.ts` exists (Phase 35 deliverable — Plan 39-01 NEGATIVE-INVARIANT target; NOT modified)
- [x] `src/bot/handlers/profile.ts` exists (Phase 35 deliverable — Plan 39-02 extends)
- [x] `src/bot/handlers/__tests__/profile.golden.test.ts` exists (Phase 35 SURF-04 — structural mirror for new psychological golden test)

Files CREATED by this phase:
- [ ] `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` (Plan 39-01 Task 4)
- [ ] `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` (Plan 39-02 Task 3)

No Wave 0 scaffold tasks needed — every test pattern referenced in `<verify>` blocks has a working analog in the codebase (Phase 37 psych-boundary-audit + Phase 35 profile.golden), and all source files being modified pre-exist from Phases 35/37/38.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First REFLECT/PSYCHOLOGY mode response post-2026-06-01 09:00 Paris cron fire | PSURF-02 | Real Sonnet output requires live cron fire + Greg's interaction | After 2026-06-01 09:00 Paris fire, send a REFLECT-trigger message to bot; verify response framing references psychological profile per Hard Rule extension WITHOUT sycophancy patterns ("given your openness...", "as someone with your conscientiousness..."). Phase 40 PMT-06 is the structured 3-of-3 live test for this. |
| `/profile` Telegram command UX after first cron fire | PSURF-04 | Greg's manual UAT on real Telegram client | Send `/profile` to bot; verify 7 reply messages arrive in order: jurisdictional → capital → health → family → HEXACO → Schwartz → Attachment; verify HEXACO + Schwartz show actual score lines OR "need N more words" countdown; verify Attachment ALWAYS shows "not yet active (D028)" regardless of state |
| FR + RU `/profile` rendering quality | PSURF-05 (D-20) | Translator review of machine-translate-quality strings | Switch session language to FR (or RU) via the existing language-set bot command; send `/profile`; verify all 7 replies render in selected language; flag any awkward phrasings for v2.6.1 polish pass (NOT a Phase 39 blocker — structure already locks the shape per D-25) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or W0 dependency
- [x] Sampling continuity OK
- [x] Wave 0 covers all MISSING references (none — every dependency pre-exists)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Planner-approved 2026-05-14. Ready for `/gsd-execute-phase 39`.
