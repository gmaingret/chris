---
phase: 29
slug: weekly-review
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-26
updated: 2026-04-26
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Source: `29-RESEARCH.md` §12 Test Infrastructure + §13 Top 5 risks + §14 HARD CO-LOC enforcement.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (existing) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/rituals/__tests__/weekly-review*` |
| **Full suite command** | `bash scripts/test.sh` (Docker postgres + full vitest) |
| **Estimated runtime** | quick ~8s; full ~120s (Docker spin-up dominated; +Sonnet/Haiku mocked → no live API cost in default suite) |
| **Live test command** (Phase 30 only) | `ANTHROPIC_API_KEY=... npx vitest run src/rituals/__tests__/live-weekly-review.test.ts` |

> **Env-level constraint:** vitest-4 fork-IPC hang under HuggingFace EACCES — `scripts/test.sh` already excludes 5 specific files. Plan 29-04 ships `live-weekly-review.test.ts` with `skipIf(!process.env.ANTHROPIC_API_KEY)` so it doesn't run in default suite. Phase 30 adds it to the excluded-suite list (becomes 6-file).

> **Test type carve-out** (per phase brief explicit instruction):
> - **Unit tests for Zod refine** — mock-based, fast (Plan 29-02; `weekly-review.test.ts`).
> - **Integration test for Haiku judge** — real API, slower; gated against real Anthropic key (Plan 29-02 OR Plan 29-04 — planner discretion; recommend Plan 29-04 alongside the live anti-flattery test, both gated on `ANTHROPIC_API_KEY`).
> - **Live anti-flattery test** — 3-of-3 against real Sonnet, scans for 17 forbidden markers (Plan 29-04 ships scaffolding; Phase 30 owns live execution per HARD CO-LOC #6).

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/rituals/__tests__/weekly-review*` (quick)
- **After every plan wave:** Run `bash scripts/test.sh` (full)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Before live test execution (Phase 30):** Set `ANTHROPIC_API_KEY` env var; run `npx vitest run src/rituals/__tests__/live-weekly-review.test.ts`
- **Max feedback latency:** ~8s for quick; ~120s for full

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-01-T1 | 01 | 1 | WEEK-04 | — | `WEEKLY_REVIEW_HEADER` constant exported with exact D031 text | unit | `npx vitest run src/rituals/__tests__/weekly-review-prompt.test.ts -t 'D031 header'` | ❌ W0 | ⬜ pending |
| 29-01-T2 | 01 | 1 | WEEK-02 | Pitfall 17 | `assembleWeeklyReviewPrompt` output STARTS with `'## Core Principles (Always Active)'` (CONSTITUTIONAL_PREAMBLE first line) | unit + grep guard | `npx vitest run src/rituals/__tests__/weekly-review-prompt.test.ts -t 'CONSTITUTIONAL_PREAMBLE'` AND `! grep -L 'CONSTITUTIONAL_PREAMBLE' src/rituals/weekly-review-prompt.ts` | ❌ W0 | ⬜ pending |
| 29-01-T3 | 01 | 1 | WEEK-07 | Pitfall 18 | Prompt contains `'PATTERNS across the week'` directive | unit (substring assertion) | `npx vitest run src/rituals/__tests__/weekly-review-prompt.test.ts -t 'pattern-only'` | ❌ W0 | ⬜ pending |
| 29-01-T4 | 01 | 1 | WEEK-09 | — | `shouldIncludeWellbeing` returns false when ANY dim stddev < 0.4 OR snapshots count < 4 | unit (mocked snapshots) | `npx vitest run src/rituals/__tests__/weekly-review-sources.test.ts -t 'wellbeing variance gate'` | ❌ W0 | ⬜ pending |
| 29-01-T5 | 01 | 1 | WEEK-01 (substrate side) | — | `loadWeeklyReviewContext(start, end)` calls `getEpisodicSummariesRange(start, end)` + decisions query + wellbeing query in parallel | integration (real DB, fixture data) | `bash scripts/test.sh` then `npx vitest run src/rituals/__tests__/weekly-review-sources.test.ts` | ❌ W0 | ⬜ pending |
| 29-02-T1 | 02 | 2 | WEEK-03 | — | Sonnet call uses `messages.parse` + `zodOutputFormat(WeeklyReviewSchemaV4)` with v3/v4 dual schema | unit (mocked anthropic) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'Sonnet call shape'` | ❌ W0 | ⬜ pending |
| 29-02-T2 | 02 | 2 | WEEK-05 (Stage-1) | Pitfall 14 | Stage-1 Zod refine rejects `?` count != 1 OR multi-interrogative-leading-word per EN/FR/RU | unit (mock-based, fast) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'Stage-1 refine'` | ❌ W0 | ⬜ pending |
| 29-02-T3 | 02 | 2 | WEEK-05 (Stage-2) | Pitfall 14 | Stage-2 Haiku judge invoked only after Stage-1 pass; rejects `question_count > 1` | unit (mocked anthropic Haiku) + integration test against real Haiku (gated) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'Stage-2 judge'` AND `ANTHROPIC_API_KEY=... npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'Stage-2 live'` | ❌ W0 | ⬜ pending |
| 29-02-T4 | 02 | 2 | WEEK-06 | Pitfall 15 | Retry cap = 2 (initial + 2 = 3 max attempts); after cap, templated fallback fires + `chris.weekly-review.fallback-fired` log | unit (mocked enforce-fail thrice) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'retry cap fallback'` | ❌ W0 | ⬜ pending |
| 29-02-T5 | 02 | 2 | WEEK-03 (date-grounding) | Pitfall 16 | Haiku date-grounding post-check rejects observations referencing dates outside 7-day window; counts against same retry cap | unit (mocked Haiku) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'date-grounding'` | ❌ W0 | ⬜ pending |
| 29-02-T6 | 02 | 2 | WEEK-04 | — | `fireWeeklyReview` sends Telegram message with `'Observation (interpretation, not fact):\n\n${observation}\n\n${question}'` shape | unit (mocked bot) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'D031 header rendering'` | ❌ W0 | ⬜ pending |
| 29-02-T7 | 02 | 2 | WEEK-08 | — | After `fireWeeklyReview()`, `SELECT * FROM pensieve_entries WHERE metadata->>'kind' = 'weekly_review'` returns exactly 1 row with `epistemic_tag = 'RITUAL_RESPONSE'` | integration (real DB) | `npx vitest run src/rituals/__tests__/weekly-review.test.ts -t 'Pensieve persist'` | ❌ W0 | ⬜ pending |
| 29-03-T1 | 03 | 3 | WEEK-01 (fire-side dispatch) | — | `dispatchRitualHandler` switch case `'weekly_review'` routes to `fireWeeklyReview` | unit (extend existing scheduler.test.ts) | `npx vitest run src/rituals/__tests__/scheduler.test.ts -t 'weekly_review dispatch'` | ⚠ existing file (extend) | ⬜ pending |
| 29-03-T2 | 03 | 3 | WEEK-01 (seed migration) | — | Migration 0009 INSERTs `weekly_review` row with `type='weekly'`, `next_run_at` = next Sunday 20:00 Paris, valid `RitualConfig` jsonb | integration (Docker postgres) | `bash scripts/test.sh` (psql line confirms 1-row seed presence) | ❌ W0 | ⬜ pending |
| 29-04-T1 | 04 | 4 | TEST-31 (Phase 30) | Pitfall 17 + 26 | Live anti-flattery test FILE exists with `skipIf(!ANTHROPIC_API_KEY)` + adversarial fixture + 17 forbidden-marker scan + 3-of-3 atomic loop | unit (file-existence check) + skipIf gating works correctly | `test -f src/rituals/__tests__/live-weekly-review.test.ts && grep -q 'PHASE-30: enable in TEST-31' src/rituals/__tests__/live-weekly-review.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/rituals/__tests__/weekly-review-prompt.test.ts` — stubs for WEEK-02 (CONSTITUTIONAL_PREAMBLE), WEEK-04 (header constant), WEEK-07 (pattern-only directive), WEEK-09 partial (variance threshold validation)
- [ ] `src/rituals/__tests__/weekly-review-sources.test.ts` — stubs for WEEK-01 substrate (range fetch + decisions query + wellbeing query), WEEK-09 (variance computation)
- [ ] `src/rituals/__tests__/weekly-review.test.ts` — stubs for WEEK-03 (Sonnet call), WEEK-05 (Stage-1 + Stage-2), WEEK-06 (retry cap + fallback), WEEK-04 (header rendering), WEEK-08 (Pensieve persist)
- [ ] `src/rituals/__tests__/live-weekly-review.test.ts` — stub for Phase 30 TEST-31 (3-of-3 atomic, gated `skipIf`)
- [ ] `src/rituals/__tests__/scheduler.test.ts` — extension stub for WEEK-01 fire-side dispatch case

> Wave 0 stubs MUST exist before each plan starts implementation work. Plan 29-01's stubs are fastest (no LLM mocks needed).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First Sunday after deploy: Greg receives ONE Telegram message at ~20:00 Paris with `Observation (interpretation, not fact):` header + observation + single Socratic question | WEEK-01..09 all-up integration | End-to-end live behavior; cron fires at 21:00 Paris on Sunday after seed migration applied; visible only via real Telegram client | After Wave 4 + Phase 30 ships: deploy to Proxmox; on next Sunday, observe Telegram inbox at 20:00-21:00 Paris; confirm message shape + content + single-question shape; 3-week observation period for empirical drift check |
| Templated fallback exercised in production | WEEK-06 | Live behavior; expected to fire rarely (~1-5% of weeks per Pitfall 14 estimates); only visible via log scrape | After Wave 4 + 4 weeks of real deploy: scrape logs for `chris.weekly-review.fallback-fired`; expected count: 0-2 across 4 weeks |
| Date-grounding post-check actually rejects out-of-window observations | WEEK-03 (date-grounding) | Live behavior; assumes Sonnet generates a stale-date reference at least once in early weeks of operation | After Wave 4 + 8 weeks of real deploy: scrape logs for `chris.weekly-review.date-grounding.rejected`; if count = 0 across 8 weeks, the post-check is either trivially passing OR Sonnet is well-grounded — both acceptable; if count > 4 in 8 weeks, the prompt-level date directive may be insufficient |
| Wellbeing variance gate omits wellbeing block in low-variance weeks | WEEK-09 | Live behavior; depends on Greg's actual wellbeing data variance over real weeks | After Phase 27 ships + 4 weeks of wellbeing data: pick a week where stddev across all 3 dims is known to be < 0.4; verify the weekly observation does NOT mention wellbeing |

---

## Risk Coverage Matrix

| Risk | Mitigation | Plan | Test Type |
|------|-----------|------|-----------|
| Pitfall 14 — Single-question check brittle (HIGH) | Stage-1 Zod refine (`?` count + interrogative-leading-word EN/FR/RU) + Stage-2 Haiku judge | 29-02 | unit (mocked Sonnet) + integration (real Haiku gated) + live (Phase 30) |
| Pitfall 15 — Multi-question regen loop blocks weekly review (HIGH) | Retry cap = 2 + templated fallback + `chris.weekly-review.fallback-fired` log | 29-02 | unit (mocked enforce-fail thrice) |
| Pitfall 16 — Stale dates in observation (HIGH) | Strict 7-day window via `getEpisodicSummariesRange` + Haiku date-grounding post-check | 29-01 + 29-02 | integration (real DB range fetch) + unit (mocked Haiku) |
| Pitfall 17 — Sycophantic weekly observations (HIGH) | Explicit `CONSTITUTIONAL_PREAMBLE` injection in `assembleWeeklyReviewPrompt` + boundary-audit grep + live anti-flattery 3-of-3 | 29-01 + 29-04 (scaffold) + Phase 30 (live) | unit (substring assertion + grep) + live (Phase 30) |
| Pitfall 18 — Re-surface individual decisions (MEDIUM) | Pattern-only directive in prompt (`'PATTERNS across the week'`); manual eyeballing of generated observations during Phase 30 verify-work | 29-01 | unit (substring assertion) + manual review |
| Pitfall 26 — Live test as own plan (HIGH) | Plan 29-04 ships scaffold with `skipIf`; Phase 30 owns live execution per HARD CO-LOC #6 | 29-04 + Phase 30 | unit (file existence + skipIf gating) + live (Phase 30) |

---

## HARD CO-LOCATION enforcement gates

| Constraint | Verification |
|------------|--------------|
| **#2** — Stage-1 + Stage-2 + observation generator in same plan | `git diff origin/main..HEAD` for Plan 29-02 commit must include ALL of: `src/rituals/weekly-review.ts` AND Stage-1 Zod refine code AND Stage-2 Haiku judge code AND retry loop. Plan-checker (gsd-plan-checker) verifies. |
| **#3** — CONSTITUTIONAL_PREAMBLE injection co-located with observation generator | `git diff` for Plan 29-01 commit must include `import { CONSTITUTIONAL_PREAMBLE }` in `weekly-review-prompt.ts`. Plan 29-02's `weekly-review.ts` must consume the assembled prompt. Plan-checker verifies the cross-file consumer link. |
| **#6** — Live weekly-review test as own plan | Plan 29-04 commit must contain ONLY the live-test file (+ adversarial fixture + forbidden-marker list). Plan 29-04 commit must NOT touch `src/rituals/weekly-review.ts` or other implementation files. |

---

*Phase 29 validation strategy ready. 14 verification tasks, all mapped to specific test type + automated command.*
