---
phase: 39-psychological-surfaces
plan: 02
subsystem: bot

tags: [telegram, /profile, m011, psychological-profiles, hexaco, schwartz, attachment, golden-snapshot, localization]

# Dependency graph
requires:
  - phase: 37-psychological-substrate
    provides: getPsychologicalProfiles reader; PsychologicalProfiles interface; HexacoProfileData/SchwartzProfileData/AttachmentProfileData types
  - phase: 39-psychological-surfaces
    provides: Plan 39-01 — ProfileRow<T> extended with wordCount?/wordCountAtLastRun?; PSYCHOLOGICAL_PROFILE_INJECTION_MAP shipped
  - phase: 35-surfaces
    provides: /profile command + formatProfileForDisplay operational analog pattern
provides:
  - formatPsychologicalProfileForDisplay(profileType, profile, lang) pure function in src/bot/handlers/profile.ts (4-branch D-19 state model)
  - /profile command extended with 3-reply for-of loop (HEXACO + Schwartz + Attachment) replacing MSG.m011Placeholder at line 627
  - MSG.psychologicalSections with hexaco/schwartz/attachment sub-trees × EN/FR/RU machine-translate-quality strings (D-20)
  - profile-psychological.golden.test.ts inline-snapshot test (15 snapshots: 4 scenarios × FR/RU language variants)
affects: [Phase 40 milestone tests (PMT-04, PMT-05, PMT-06 surfaces); Greg's manual UAT after first 2026-06-01 cron fire]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "HARD CO-LOC #M11-3 — formatPsychologicalProfileForDisplay + golden snapshot ship in same plan (REQUIREMENTS PSURF-05 verbatim)"
    - "4-branch D-19 state model — attachment-always-deferred / null+never-fired / insufficient-data / populated"
    - "MSG.psychologicalSections sibling structure to existing operational MSG keys; machine-translate-quality FR/RU strings preserve structural snapshot stability"
    - "Plain-text only — no parse_mode (D027 mitigation surface preserved; consistent with M010 operational replies)"

key-files:
  modified:
    - "src/bot/handlers/profile.ts (Task 1 commit 09b032c + Task 2 commit 7bec4b5 + Task 3 commit e1b5275 — added imports, MSG.psychologicalSections, formatPsychologicalProfileForDisplay, replaced MSG.m011Placeholder at line 627 with 3-reply for-of loop)"
    - "src/bot/handlers/__tests__/profile.test.ts (Task 3 commit e1b5275 — mock setup extended with getPsychologicalProfiles; 4 assertions updated from 5-reply to 7-reply behavior)"
  created:
    - "src/bot/handlers/__tests__/profile-psychological.golden.test.ts (Task 3 commit e1b5275 — vitest inline-snapshot test with 15 snapshots covering 4 D-24 scenarios × FR/RU variants)"

# Requirement traceability
requirements_addressed:
  PSURF-04: "/profile command extended with HEXACO + Schwartz + Attachment sections via formatPsychologicalProfileForDisplay; insufficient-data branch displays 'need N more words' (N = max(0, 5000 - wordCountAtLastRun ?? 0)); Attachment section displays 'not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)' in M011 regardless of activated flag"
  PSURF-05: "formatPsychologicalProfileForDisplay pure function + golden inline-snapshot test ship in HARD CO-LOC #M11-3 atomic plan; 4 scenarios × FR/RU variants snapshot 15 outputs total"

# Decision compliance
context_decisions_addressed:
  - D-17 (replace MSG.m011Placeholder at line 627 with 3 new ctx.reply calls)
  - D-18 (display-side reader uses getPsychologicalProfiles; never-throw)
  - D-19 (4-branch state model — attachment / never-fired / insufficient / populated)
  - D-20 (FR/RU machine-translate-quality strings; NOT English placeholders)
  - D-21 (formatPsychologicalProfileForDisplay signature exact; pure function; composable)
  - D-22 (HARD CO-LOC #M11-3 — formatter + golden snapshot in same plan)
  - D-23 (golden snapshot file location; vitest inline-snapshot pattern; MOCK_PSYCH inline fixtures)
  - D-24 (4 fixture scenarios — populated / all-insufficient / mixed / FR+RU slots)
  - D-25 (FR + RU explicit snapshot variants for scenarios 1-3; mixed scenario non-snapshot D-09 per-dim filter assertions)

# Verification
verification:
  tsc: "npx tsc --noEmit exits 0 (verified at Task 3 completion)"
  unit:
    - "src/bot/handlers/__tests__/profile-psychological.golden.test.ts: 15/15 snapshots (via bash scripts/test.sh — requires env vars from .env)"
    - "src/bot/handlers/__tests__/profile.test.ts: 8/8 (4 existing + 4 updated)"
  boundary_audit: "src/memory/profiles/__tests__/psych-boundary-audit.test.ts still passes 10/10 (Phase 37 invariant preserved)"

# Deviations
deviations:
  - rule: "Rule 1 (auto-fix; no user permission needed)"
    description: "Wave-2 executor agent hit Anthropic API rate limit between Task 2 commit (7bec4b5) and Task 3 commit. Tasks 1+2 had already shipped in the worktree (commits 09b032c, 7bec4b5); Task 3's working-tree modifications + golden test file were uncommitted at agent failure. Orchestrator completed Task 3 inline (TypeScript verify clean; 4 stale profile.test.ts assertions updated from 5-reply to 7-reply expectations; getPsychologicalProfiles mock extended; golden test verified 15/15 via bash scripts/test.sh) and committed as commit e1b5275."
    impact: "Zero functional impact — Task 3 completed by orchestrator using same plan + same invariants. All HARD CO-LOC #M11-3 atomicity preserved (formatter Task 2 + golden snapshot Task 3 land in same plan, same merge boundary)."

# Out of scope
out_of_scope:
  - "Real FR/RU translation polish (v2.6.1 or M014 — current strings are machine-translate-quality per D-20)"
  - "Schwartz circumplex-ordered display (CIRC-01 — v2.6.1 / M014)"
  - "HEXACO × Schwartz cross-validation display (CROSS-VAL-01 — v2.6.1)"
  - "Attachment activation orchestration (D028 / ATT-POP-01 — v2.6.1 / M013); current behavior locked to 'not yet active' regardless of activated flag"
  - "Trait change-detection alerts on /profile (CONS-02 — v2.6.1)"
  - "Narrative summary of psychological profile (M014 only per ANTI-features)"

# Next steps
next_steps:
  - "Orchestrator merges worktree branch into main; runs roadmap.update-plan-progress for 39-02; commits tracking update"
  - "Phase 39 verifier confirms 5/5 ROADMAP success criteria + HARD CO-LOC #M11-3 atomicity"
  - "Phase 40 (Milestone Tests) — final M011 phase: synthetic fixtures + sparse/populated integration tests + 3-cycle unconditional-fire fixture test (Phase 38 had contract-level coverage; Phase 40 adds fixture-level) + live 3-of-3 milestone gate (operator-invoked, dual-gated)"
---

# Phase 39 Plan 02 — Display-side Surface Summary

## What shipped

**Plan 39-02 ships the display-side surface for M011 psychological profiles in one atomic plan per HARD CO-LOC #M11-3.** The `/profile` Telegram command — previously closed with the `MSG.m011Placeholder` line at `src/bot/handlers/profile.ts:627` — now emits 3 additional `ctx.reply` calls rendering HEXACO, Schwartz, and Attachment profile sections via a new `formatPsychologicalProfileForDisplay(profileType, profile, lang)` pure function. The 4-branch state model (attachment-always-deferred / null+never-fired / insufficient-data / populated) gracefully handles every combination of substrate state without ever exposing internal field names or third-person sycophancy patterns.

The golden inline-snapshot test in `profile-psychological.golden.test.ts` captures 15 outputs covering 4 scenarios (all-populated / all-insufficient / mixed / FR+RU slots) × language variants, locking the rendering contract. Any future change to the format must explicitly update the snapshots and review the diff for D027-leakage classes (third-person framing, internal field names, parse_mode characters).

## Why it matters

This plan completes the Phase 39 (Psychological Surfaces) milestone: psychological profile data now flows end-to-end from Phase 37's substrate through Phase 38's monthly cron inference into both REFLECT/PSYCHOLOGY mode system prompts (Plan 39-01) AND the user-facing `/profile` Telegram command (this plan). The localized FR + RU section titles + insufficient-data messages preserve Greg's multilingual UAT capability after the first 2026-06-01 cron fire.

## What's next

Phase 40 (Milestone Tests) is the final M011 phase: synthetic fixture generation (`--psych-profile-bias` flag) + sparse/populated real-DB integration tests + the live 3-of-3 anti-hallucination milestone gate (operator-invoked, dual-gated `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`).
