# Phase 34: Inference Engine — Discussion Log

**Mode:** `/gsd-discuss-phase 34 --auto` (single-pass autonomous)
**Date:** 2026-05-12
**Decisions reference:** `34-CONTEXT.md`

This is the audit trail for the auto-mode discussion. Each gray area was identified by analyzing ROADMAP.md Phase 34 entry + REQUIREMENTS.md GEN-01..07 + `.planning/research/SUMMARY.md` + `33-CONTEXT.md`. Per `--auto` mode rules, the orchestrator picked the recommended option (first/marked-recommended) without invoking AskUserQuestion. All selections are logged here and again inline in `34-CONTEXT.md` `<decisions>`.

## Gray areas auto-selected

| # | Gray area | Recommended option | Source |
|---|-----------|-------------------|--------|
| 1 | Plan split structure | 3 plans (34-01/02/03) matching REQUIREMENTS traceability | REQUIREMENTS.md:86-92 |
| 2 | Plan ordering | Strict: 34-01 → 34-02 → 34-03 | HARD CO-LOC #M10-2 + import graph |
| 3 | Shared prompt builder API | Single `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` | M009 weekly-review-prompt precedent + HARD CO-LOC #M10-2 |
| 4 | Confidence origin (Sonnet vs host) | Hybrid: Sonnet → `data_consistency`, host → `confidence` | Research SUMMARY.md:243 conflict resolution |
| 5 | Volume-weight ceiling enforcement | Zod v4 `.refine()` at SDK boundary | M010-01 |
| 6 | Pensieve domain-filter (OQ-1) | Tag-only (FACT/RELATIONSHIP/INTENTION/EXPERIENCE), no keyword | OQ-1 recommended starting point |
| 7 | Substrate-loader call cardinality | Once per fire (shared across 4 dimensions) | OQ-1 + simplicity bias |
| 8 | Substrate-hash composition | SHA-256 of canonical JSON: pensieveIds + episodicDates + decisionIds + schemaVersion | M010-09 + M010-11 interplay |
| 9 | Substrate-hash comparison scope | Per-dimension, not global | `Promise.allSettled` error-isolation parity |
| 10 | Threshold check ordering | Before substrate-hash (cheaper short-circuit) | Resource frugality |
| 11 | Threshold input | `pensieveEntries.length` (not aggregate) | M010 spec intent |
| 12 | Execution model | `Promise.allSettled` | Research SUMMARY.md:241 conflict resolution |
| 13 | In-fire retry strategy | None — next week's cron is the retry | M008/M009 precedent |
| 14 | Orchestrator return | Void / fire-and-forget; logs only | `src/episodic/cron.ts` precedent |
| 15 | Cron timing | Sunday 22:00 Paris (`'0 22 * * 0'`) | M010-04 + ROADMAP success criterion 5 |
| 16 | Cron config knob name | `profileUpdaterCron` (per REQUIREMENTS GEN-01) | REQUIREMENTS GEN-01 verbatim |
| 17 | CronRegistrationStatus field name | `profileUpdate: 'registered' \| 'failed'` | Matches existing union shape |
| 18 | `/health` field name | `profile_cron_registered: boolean` | REQUIREMENTS GEN-01 verbatim |
| 19 | profile_history write-vs-skip | Write only on actual change (skip on hash match) | M010-09 + state-change semantics |
| 20 | profile_history snapshot shape | Full row including metadata | Phase 33 D-17 already designed for this |
| 21 | Sonnet model | `SONNET_MODEL` (config.sonnetModel) | M009 weekly-review precedent |
| 22 | M010-02 mitigation level (v1) | Directive-only (`DO_NOT_INFER_DIRECTIVE`); sources arrays → v2.5.1 | Output-token frugality + Phase 36 measures residual |
| 23 | Stage-2 Haiku judge | None in v1 | Same rationale as #22 |
| 24 | Log key for threshold case | `'chris.profile.threshold.below_minimum'` (verbatim) | REQUIREMENTS GEN-06 verbatim |
| 25 | Substrate window length | 60 days (rolling) | M009 precedent |
| 26 | Live Sonnet test in Phase 34 | None — Phase 36 PTEST-05 only | D-30-03 cost discipline |

## Areas left to Claude's discretion (planner / executor)

These are explicitly NOT locked here and are documented in `34-CONTEXT.md` `<decisions>` → "Claude's Discretion":

- Whether to extract `runProfileGenerator(config, deps)` helper if the four generator bodies are >80% mechanically identical (recommendation: extract).
- Exact substrate window length if 60 days proves too narrow during planning (default: 60, may bump to 90).
- Canonical-JSON helper choice (reuse internal utility / import `fast-json-stable-stringify` / hand-roll).
- Exact `dimensionSpecificDirective` content per profile (draft in Plan 34-01, lock as HARD CO-LOC inside dimension config objects).

## Deferred ideas (out of Phase 34 scope)

Logged in `34-CONTEXT.md` `<deferred>` section:

- Per-field `sources: uuid[]` arrays (v2.5.1 contingent on Phase 36 anti-hallucination test)
- Per-dimension substrate views (v2.5.1 contingent on Phase 36 fixture contamination test)
- Optional Haiku post-check after Sonnet output (v2.5.1)
- SATURATION constant tuning (post-ship, OQ-5)
- Per-field confidence (DIFF-7, M013)
- `/profile` Telegram command + mode-handler injection (Phase 35)
- `m010-30days` + `m010-5days` primed fixtures + live 3-of-3 test (Phase 36)

## Process notes

- `--auto` mode: single-pass cap respected. No re-reading of generated CONTEXT.md to find "gaps".
- No external research call needed: SUMMARY.md + 33-CONTEXT.md already lock all decisions; OQ-1 + OQ-2 left for planner confirmation per research flag instructions in SUMMARY.md:226-234.
- No live LLM calls during discussion.
- No file edits to source code during discussion (pure context-gathering).

