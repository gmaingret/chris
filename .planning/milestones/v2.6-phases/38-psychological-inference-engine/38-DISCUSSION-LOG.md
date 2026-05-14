# Phase 38: Psychological Inference Engine — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 38-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 38-psychological-inference-engine
**Mode:** `--auto` (autonomous; recommended-default selected for every gray area)
**Areas discussed:** Plan split, prompt builder fork vs extend, Hard Rule extension placement, batching (per-dim vs per-profile-type), unconditional fire vs hash-skip, orchestrator concurrency, substrate-load count per fire, cron timing + collision check, Zod `.refine()` ceiling, integration test scope

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans (mirror Phase 34: prompt → generators → orchestrator) | Proven structure from M010; HARD CO-LOC #M11-2 fits the 38-01 / 38-02 split cleanly | ✓ |
| 2 plans (combine prompt + generators) | Smaller surface; HARD CO-LOC enforced internally to one plan | |
| 4 plans (prompt, hexaco, schwartz, orchestrator) | Maximal isolation; HEXACO and Schwartz parallelizable | |

**Selected:** 3 plans (Phase 34 mirror).
**Rationale:** Phase 34's three-plan split shipped clean; PGEN-01..07 maps cleanly across the three plans; HARD CO-LOC #M11-2 (REQUIREMENTS verbatim) needs the prompt builder to ship BEFORE either generator — Plan 38-01 → 38-02 → 38-03 enforces this order. 4 plans rejected: HEXACO + Schwartz generators are mechanically identical (per-profile-type config object only) — splitting them adds plan overhead without parallelism benefit.

---

## Prompt builder — fork vs extend

| Option | Description | Selected |
|--------|-------------|----------|
| Fork into new `psychological-profile-prompt.ts` | Independent file at `src/memory/` level; mirrors M010 operational prompt sibling | ✓ |
| Extend `ProfilePromptDimension` union in existing `profile-prompt.ts` | Single source of prompt-building code | |
| Generic prompt builder with profile-domain plugin | Future-proof for additional profile domains | |

**Selected:** Fork into new file.
**Rationale:** RESEARCH.md ARCHITECTURE §3 verbatim: "cannot extend `ProfilePromptDimension`'s union without breaking every exhaustive switch consuming it (`profile-prompt.ts:51,107,124,175`)." File location `src/memory/psychological-profile-prompt.ts` matches REQUIREMENTS PGEN-01 verbatim. Generic plugin rejected: premature abstraction for 2 profile types vs operational's 4.

---

## Hard Rule D027 extension placement

| Option | Description | Selected |
|--------|-------------|----------|
| Inline constant in new `psychological-profile-prompt.ts` | Scoped to psychological inference; reusable by Phase 39 PSURF-02 via import | ✓ |
| In `src/chris/personality.ts` alongside CONSTITUTIONAL_PREAMBLE | Centralized constitutional invariant | |
| Duplicated text in both prompt + Phase 39 formatter | Maximum isolation between concerns | |

**Selected:** Inline constant in new prompt file.
**Rationale:** The extension is specific to psychological-profile inference framing — `personality.ts` holds cross-mode invariants. Phase 39's `formatPsychologicalProfilesForPrompt` (PSURF-02) will import the same constant — one source of truth at the appropriate scope. Duplication rejected: future edits would need to land in two places.

---

## Batching — per-dimension vs per-profile-type Sonnet calls

| Option | Description | Selected |
|--------|-------------|----------|
| 1 call per profile type (1 HEXACO + 1 Schwartz = 2 calls per fire) | Cross-dim coherence preserved (HEXACO 6 dims) + circumplex coherence preserved (Schwartz 10 values) | ✓ |
| 1 call per dimension (6+10 = 16 calls per fire) | Per-dim isolation; smaller individual prompts | |
| 1 combined call for both profile types | Maximum coherence; single output | |

**Selected:** 2 calls per fire (1 per profile type).
**Rationale:** Research SUMMARY locks "2 Sonnet calls per monthly fire" — 16 calls × 10s = 160s vs 2 × 10s = 20s; HEXACO's 6 dimensions are one theoretical framework needing cross-dim coherence; Schwartz's 10 values are a circumplex (splitting destroys cross-value evidence). Combined call rejected: HEXACO and Schwartz use different per-dim shapes and different empirical interpretations; single Zod schema would lose the per-profile-type schema discipline.

---

## Unconditional fire vs hash-skip

| Option | Description | Selected |
|--------|-------------|----------|
| Unconditional fire — record substrate_hash but do NOT skip | PGEN-06 verbatim; inverse of M010 GEN-07; prevents permanent gaps in inter-period time series | ✓ |
| Hash-skip on match (mirror M010 GEN-07) | Cost optimization; matches M010 idempotency precedent | |
| Hash-skip only on the first 60 days, then unconditional | Hybrid — saves cost early when substrate is stable, switches as Greg's speech accumulates | |

**Selected:** Unconditional fire.
**Rationale:** LOCKED by REQUIREMENTS PGEN-06 — not a gray area; the auto-mode pick is just confirmation. Rationale recorded in PITFALLS.md Pitfall 5: skipped months break the future inter-period consistency time series; psychological profiles need a data point every month. Three-cycle integration test (D-34) asserts cumulative 4 Sonnet calls after Cycle 2 — direct inverse of M010 PTEST-03. Hybrid rejected: adds complexity for marginal cost savings ($0.05-0.10/month is negligible).

---

## Orchestrator concurrency

| Option | Description | Selected |
|--------|-------------|----------|
| Promise.allSettled (parallel, per-generator error isolation) | HEXACO failure does NOT abort Schwartz (PGEN-04 verbatim); 2 calls in parallel | ✓ |
| Promise.all (parallel, fail-fast on first error) | Atomic monthly fire — either both succeed or both fail | |
| Sequential (HEXACO then Schwartz) | Simpler control flow; one Sonnet call at a time | |

**Selected:** Promise.allSettled.
**Rationale:** PGEN-04 verbatim: "HEXACO failing must not abort Schwartz." Mirrors M010 D-21. Fail-fast rejected: a transient Sonnet timeout on HEXACO should not block Schwartz inference. Sequential rejected: monthly cadence means 2 generators × 10s = 20s wall-clock — parallelism is a free win.

---

## Substrate-load count per fire

| Option | Description | Selected |
|--------|-------------|----------|
| 2 loads (one per profile type — gets per-profile-type prevHistorySnapshot) | Simpler; postgres caches corpus query for second call; <50ms wall-clock impact | ✓ |
| 1 corpus load + 2 separate prevHistorySnapshot lookups | Slight performance gain; refactor required to `loadPsychologicalSubstrate` signature | |
| 1 unified load returning both snapshots | Maximum efficiency; biggest refactor | |

**Selected:** 2 loads per fire.
**Rationale:** Phase 37's `loadPsychologicalSubstrate(profileType, now)` signature already returns `prevHistorySnapshot` for a given profile type. Calling twice is the cleanest consumption pattern — corpus + wordCount queries are identical and postgres caches them; only `prevHistorySnapshot` differs. Optimization deferred to v2.6.1 if profiling shows >100ms overhead per fire.

---

## Cron timing + collision-avoidance

| Option | Description | Selected |
|--------|-------------|----------|
| `'0 9 1 * *'` Europe/Paris (1st of month, 09:00) | PGEN-05 verbatim; 13-hour gap from M010 Sunday 22:00 cron when 1st falls on Sunday | ✓ |
| `'0 9 2 * *'` (2nd of month, 09:00) — dodge the Sunday-1st corner case | Avoids same-day-as-M010 cron when 1st = Sunday | |
| `'0 10 1 * *'` (1st of month, 10:00) — push to 10:00 for an extra collision buffer | Predictable monthly cadence + larger gap | |

**Selected:** `'0 9 1 * *'` Europe/Paris.
**Rationale:** LOCKED by REQUIREMENTS PGEN-05 verbatim. When the 1st falls on Sunday, M011's 09:00 cron is 13 hours BEFORE M010's 22:00 cron — no minute-level collision. Predictable monthly cadence trumps avoidance dodges. Cron-collision detection unit test stays in scope (D-27 mandates verification at registration time).

---

## Zod `.refine()` overall_confidence ceiling

| Option | Description | Selected |
|--------|-------------|----------|
| No `.refine()` — prompt-level directive only | Word-count floor (5,000) is gated upstream by `loadPsychologicalSubstrate`; r ≈ .31–.41 ceiling communicated via directive language | ✓ |
| Mirror M010 D-32 — `.refine()` blocks `overall_confidence > 0.5` below some word threshold | Defense in depth; double gate | |
| `.refine()` against `data_consistency` instead | Match M010 pattern more precisely; Sonnet self-reports `data_consistency` | |

**Selected:** No `.refine()`.
**Rationale:** Word-count floor already fires at substrate-load time (PSCH-08) — refusing the parse above 5,000 words would block legitimate inferences. M010's pattern targets a different gate (entry count, not word count). Empirical observation in v2.6.1 may justify adding back if confidence inflation patterns emerge.

---

## Integration test scope (Phase 38 vs Phase 40)

| Option | Description | Selected |
|--------|-------------|----------|
| Three-cycle unconditional-fire test in Phase 38 with inline mocked substrate | Locks PGEN-06 contract independently of Phase 40 fixture work; Phase 38 ships standalone | ✓ |
| Defer all integration tests to Phase 40 with primed fixtures | Single test surface; matches M010 PTEST split | |
| Both — Phase 38 unit + Phase 40 fixture-driven | Belt-and-suspenders | |

**Selected:** Three-cycle test in Phase 38 with inline mocked substrate.
**Rationale:** PGEN-06 is the inverse-of-M010-idempotency contract — locking it at the same time as the generator code reduces refactor-regression risk. Phase 40's PMT-05 builds on top using primed fixtures from PMT-01/PMT-02; Phase 38's test verifies the contract without depending on Phase 40's fixture infrastructure. NO live Sonnet calls in Phase 38 — that's Phase 40 PMT-06 only.

---

## Claude's Discretion

Listed in 38-CONTEXT.md `<decisions>` — planner-flex items:
- Extract `runPsychologicalProfileGenerator(config, deps)` helper or keep per-file functions (only 2 files — extraction may be premature)
- `PSYCHOLOGICAL_HARD_RULE_EXTENSION` as const string vs const-returning function (either works; const matches `DO_NOT_INFER_DIRECTIVE` shape)
- Separate prompt-builder unit test or fold into generator integration test (recommend separate)
- Polish on the unconditional-fire divergence comment (D-18 provides starting phrasing)

## Deferred Ideas

Captured in 38-CONTEXT.md `<deferred>`:
- Attachment generator (D-23 + PGEN-04 verbatim — v2.6.1 / ATT-POP-01)
- Host-side inter-period consistency math (D-20 + PGEN-07 — v2.6.1 / CONS-01 / CONS-02)
- `.refine()` ceiling on overall_confidence (D-33 — revisit empirically in v2.6.1)
- Single-load substrate optimization (D-24 — revisit if >100ms overhead)
- `runPsychologicalProfileGenerator` helper extraction (Claude's-discretion item)
- Retry on Sonnet failure (D-22 — revisit if >2 consecutive monthly failures)
- Per-profile-type substrate filtering (revisit empirically in v2.6.1)
- `hash_recorded` debug-log event (D-17 — optional simplification)
- Cron collision-avoidance dodge (D-27 — explicitly rejected)
