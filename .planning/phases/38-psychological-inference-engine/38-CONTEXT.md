# Phase 38: Psychological Inference Engine — Context

**Gathered:** 2026-05-14 (via `/gsd-discuss-phase 38 --auto`)
**Status:** Ready for planning
**Prior phase:** Phase 37 (Psychological Substrate) — shipped 2026-05-13 (migration 0013, 3 tables, `getPsychologicalProfiles` reader, `loadPsychologicalSubstrate` discriminated-union loader, `MIN_SPEECH_WORDS`/`isAboveWordThreshold`, `psych-boundary-audit.test.ts`, Zod v3+v4 dual schemas)

<domain>
## Phase Boundary

Phase 38 ships the **inference engine** that turns Phase 37's seeded psychological profile rows into Sonnet-inferred HEXACO + Schwartz outputs. After this phase:

- A **5th cron** fires monthly on the 1st at 09:00 Europe/Paris (`'0 9 1 * *'`) and runs `updateAllPsychologicalProfiles()` end-to-end against Greg's `source='telegram'` Pensieve substrate
- `src/memory/psychological-profile-prompt.ts` (NEW, sibling to operational `profile-prompt.ts` — NOT under `profiles/`) exports `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount)` — the **shared builder consumed by both generators** (HARD CO-LOC #M11-2 enforcement against per-profile-type drift)
- Two per-profile-type generators in `src/memory/profiles/{hexaco,schwartz}.ts` each call Sonnet with structured output, write a `profile_history` snapshot, then upsert via `name='primary'` sentinel
- `src/memory/psychological-profile-updater.ts` (NEW, sibling to operational `profile-updater.ts`) orchestrates the two generators via `Promise.allSettled` with discriminated outcome logging
- 5,000-word-count threshold (already checked inside `loadPsychologicalSubstrate` per PSCH-08) short-circuits the Sonnet call (logs `'chris.psychological.{hexaco,schwartz}.skipped_below_threshold'`)
- **UNCONDITIONAL FIRE — substrate-hash is recorded on each fire for audit trail but does NOT short-circuit the Sonnet call.** Direct inverse of M010 GEN-07 idempotency. Documented inline.
- `/health` endpoint reports `psychological_profile_cron_registered: true`
- Three-cycle integration test verifies the unconditional-fire contract — Cycle 1 = 2 Sonnet calls (1 HEXACO + 1 Schwartz), Cycle 2 identical substrate = cumulative 4 (NOT 2 — divergence from M010 PTEST-03), Cycle 3 with new entries = cumulative 6

**Explicitly NOT in this phase** (Phases 39–40):
- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` constant + `formatPsychologicalProfilesForPrompt` — Phase 39
- `ChrisContextExtras` extension + REFLECT/PSYCHOLOGY handler wiring — Phase 39
- `/profile` Telegram command extension — Phase 39
- `formatPsychologicalProfileForDisplay` + golden-output snapshot — Phase 39
- `--psych-profile-bias` flag in `synthesize-delta.ts` — Phase 40
- Primed fixtures (`m011-30days`, `m011-1000words`) — Phase 40
- Live 3-of-3 milestone gate against real Sonnet 4.6 — Phase 40
- Attachment generator (population gated on D028 — deferred to v2.6.1 weekly sweep)

**Inter-phase coupling:**
- **Upstream (consumes Phase 37):** `loadPsychologicalSubstrate`, `getPsychologicalProfiles`, `PsychologicalProfileType`, `MIN_SPEECH_WORDS`, Zod v3/v4 schemas from `psychological-schemas.ts`, the three seeded sentinel rows in `profile_hexaco`/`profile_schwartz`/`profile_attachment`
- **Downstream (consumed by Phase 39):** populated rows with non-zero `overall_confidence` enable REFLECT + PSYCHOLOGY mode-handler injection; `/profile` non-null rendering test
- **Downstream (consumed by Phase 40):** `updateAllPsychologicalProfiles()` is the public entry point exercised by the three-cycle test (PMT-05)

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M011 research pass (`.planning/research/SUMMARY.md` + `ARCHITECTURE.md` §§3-7 + `PITFALLS.md` Pitfalls 1, 5, 6, 7) and REQUIREMENTS PGEN-01..07. The `--auto` flag locked each at the recommended option. The planner should treat them as the contract surface and validate via the success criteria in ROADMAP.md Phase 38 entry.

`[auto]` annotations record the gray area, the recommended option chosen, and the source.

### Plan split structure

- **D-01: Three plans matching REQUIREMENTS traceability + HARD CO-LOC #M11-2.** `[auto]` Plan structure — Q: "How to split Phase 38?" → Selected: "3 plans (mirror Phase 34 split that proved out in M010)" (recommended; REQUIREMENTS PGEN-01..07 maps cleanly across these three plans).
  - **Plan 38-01: Shared prompt builder + structural test (PGEN-01)** — `src/memory/psychological-profile-prompt.ts` ships `assemblePsychologicalProfilePrompt` + `CONSTITUTIONAL_PREAMBLE` re-export check + `DO_NOT_INFER_DIRECTIVE` re-export verbatim + **Hard Rule D027 extension constant** + per-profile-type directive blocks (HEXACO 6-dim coherence framing; Schwartz 10-value circumplex framing) + prev-state injection + word-count framing. Structural test in `src/memory/__tests__/psychological-profile-prompt.test.ts` asserts CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE + Hard Rule D027 extension appear in every profile-type's assembled output. **HARD CO-LOC #M11-2: this plan MUST ship before plan 38-02 — drift between per-generator prompts is the failure mode this co-location prevents.**
  - **Plan 38-02: Two generators + three-cycle unconditional-fire test (PGEN-02, PGEN-03, PGEN-06, PGEN-07)** — `src/memory/profiles/hexaco.ts` and `src/memory/profiles/schwartz.ts` each calling `messages.parse` + `zodOutputFormat(v4)` + Zod v3 re-validate + write-before-upsert via `profile_history` + upsert via `name='primary'` sentinel; **substrate_hash recorded but NOT used for short-circuit (PGEN-06 unconditional fire)**; `prevHistorySnapshot` threaded into prompt for Sonnet-reported `data_consistency` (PGEN-07); three-cycle integration test (Cycle 1 populate, Cycle 2 identical substrate → cumulative 4 Sonnet calls NOT 2 — inverse-of-idempotency contract, Cycle 3 mutated substrate → cumulative 6). **HARD CO-LOC #M11-2 (continued): both generator files ship in the SAME plan to prevent skew.**
  - **Plan 38-03: Orchestrator + monthly cron + config + /health (PGEN-04, PGEN-05)** — `src/memory/psychological-profile-updater.ts` (`updateAllPsychologicalProfiles` via `Promise.allSettled`, discriminated outcome logging, unconditional-fire comment); `src/cron-registration.ts` registration of 5th cron (1st of month, 09:00 Paris); `src/config.ts` `psychologicalProfileUpdaterCron` env var + `cron.validate` fail-fast; `CronRegistrationStatus.psychologicalProfileUpdate` field; `/health` endpoint reports `psychological_profile_cron_registered`. ~4 tasks.

- **D-02: Plan ordering is strict, not parallelizable.** 38-01 ships before 38-02 (HARD CO-LOC #M11-2 — generators import the builder); 38-02 ships before 38-03 (orchestrator imports both generators). Same shape as Phase 34's 34-01 → 34-02 → 34-03 ordering that shipped clean.

### Shared prompt builder (Plan 38-01 / PGEN-01)

- **D-03: `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount)` signature locked.** `profileType` typed as `'hexaco' | 'schwartz'` — `'attachment'` deferred per D-23. Returns `{ system: string, user: string }` consumed at the SDK boundary. Pure function: zero side effects, zero DB/LLM/fs/env access. `[auto]` Builder API — Q: "Extend operational `assembleProfilePrompt` or fork?" → Selected: "Fork into new file" (recommended per CONTEXT.md ARCHITECTURE §3 + RESEARCH.md confirmation — cannot extend `ProfilePromptDimension` union without breaking every exhaustive switch consuming it at `src/memory/profile-prompt.ts:51,124,363`).
- **D-04: File location `src/memory/psychological-profile-prompt.ts`, NOT under `profiles/`.** Mirrors M010 operational `src/memory/profile-prompt.ts` at the same level. Aligns with REQUIREMENTS PGEN-01 verbatim ("shared builder in `src/memory/psychological-profile-prompt.ts`"). The `profiles/` subdirectory is reserved for per-profile-type generator files (hexaco.ts, schwartz.ts) — exact mirror of M010 where `profile-prompt.ts` is at `src/memory/` and the four generators are under `src/memory/profiles/`.
- **D-05: CONSTITUTIONAL_PREAMBLE explicit re-export check.** First section of the assembled `system` string imports `CONSTITUTIONAL_PREAMBLE` from `src/chris/personality.ts` verbatim. Structural test asserts `system.startsWith('## Core Principles (Always Active)')` for both profile types. Same pattern as M010 D-04 / M009 weekly-review-prompt.ts:43.
- **D-06: `DO_NOT_INFER_DIRECTIVE` re-imported from M010, NOT redeclared.** Import the existing constant from `src/memory/profile-prompt.ts` to keep one source of truth — the anti-hallucination floor applies equally to operational + psychological inference. The structural test asserts the directive appears in both `hexaco` and `schwartz` assembled output. (Conflict-of-interest noted: if M010 ever changes the directive, M011 inherits automatically — that's intentional, NOT a coupling defect.)
- **D-07: Hard Rule D027 extension is an INLINE constant in the new prompt file.** Phrasing locked verbatim from PITFALLS.md §1 (most-critical):
  ```
  ## Psychological Profile Framing (D027 extension — REQUIRED)

  These trait scores describe statistical tendencies inferred from speech patterns,
  NOT facts about who Greg is. You MUST NOT:
  - Use these scores to tell Greg he is "the kind of person who..."
  - Appeal to his trait scores as evidence that his current reasoning is correct
  - Construct advice that validates his existing position by citing his personality
  The Hard Rule (D027) applies here with additional force: psychological traits are
  not evidence. Evaluate every claim on its merits regardless of what the profile says.
  ```
  Constant name: `PSYCHOLOGICAL_HARD_RULE_EXTENSION`. Exported from `psychological-profile-prompt.ts`. Asserted present in both profile-type assembled outputs by the structural test. (Phase 39's `formatPsychologicalProfilesForPrompt` will later inject a similar block at the surface level per PSURF-02 — these are two enforcement points; both are required.)
- **D-08: Word-count framing in prompt (replaces M010's volume-weight ceiling).** The prompt explicitly tells Sonnet: "Report `data_consistency` in 0–1; the host code reads this as a combined volume + consistency signal — do NOT emit a `confidence` field directly." Word count is communicated in the substrate block — Sonnet sees the actual wordCount value (e.g., "Substrate: 6,247 words of Greg's first-person Telegram speech from the previous calendar month"). `[auto]` Confidence origin — Q: "Sonnet emits confidence or host computes?" → Selected: "Sonnet emits `data_consistency` per-dim + per-profile-type overall; host stores both verbatim" (recommended per PGEN-07 + research SUMMARY §3 "Sonnet-reports `data_consistency` as combined volume+consistency signal").
- **D-09: Previous-state injection via `prevHistorySnapshot`.** When `prevState` is non-null (every fire after the first, including the seed row from Phase 37), the prompt includes a `## CURRENT PROFILE STATE` section rendering the prior `profile_history` snapshot's per-dim jsonb verbatim. Sonnet is instructed to update high-confidence dimension scores ONLY when substantial cross-month behavioral evidence justifies the change (parallel to M010-03 mitigation, adjusted for slow-moving-trait domain). The `prevHistorySnapshot` comes from `loadPsychologicalSubstrate.prevHistorySnapshot` field per Phase 37.
- **D-10: Per-profile-type directive blocks.** Each profile type gets a dedicated section in the assembled prompt:
  - **HEXACO directive** — emphasizes cross-dimension coherence (the 6 HEXACO dimensions are one theoretical framework; coherent inference requires considering all 6 together, not independently)
  - **Schwartz directive** — emphasizes the circumplex structure (10 values are arranged in a circular motivational continuum; coherent inference acknowledges opposing-value tradeoffs, e.g. Self-Direction ↔ Conformity)
  - Both directives include the empirical-limits framing: "speech-based personality inference accuracy bound is r ≈ .31–.41; confidence should reflect this ceiling, not project precision the substrate cannot support"

### Per-profile-type generator implementation (Plan 38-02 / PGEN-02, PGEN-03)

- **D-11: One generator file per profile type, identical shape.** `src/memory/profiles/hexaco.ts` and `src/memory/profiles/schwartz.ts` each export `generate{Hexaco,Schwartz}Profile(deps): Promise<PsychologicalProfileGenerationOutcome>`. Body is mechanical: receive substrate (already loaded by orchestrator) → check substrate.belowThreshold branch → call Sonnet → parse v4 → re-validate v3 → write history snapshot → upsert. The only per-file variance is the profile-type config object and the imported v3/v4 schemas. Mirrors M010 D-08 with 2 generators instead of 4.
- **D-12: Profile-type config objects.** Each file declares `HEXACO_PROFILE_CONFIG` / `SCHWARTZ_PROFILE_CONFIG` with `{ profileType, v3Schema, v4Schema }` shape. Keeps the generator body uniform; the planner may extract a `runPsychologicalProfileGenerator(config, deps)` helper if duplication is mechanical (Claude's discretion).
- **D-13: Sonnet model = `SONNET_MODEL` (claude-sonnet-4-6 from config).** Use `anthropic.messages.parse({ model: SONNET_MODEL, system: assembled.system, messages: [{role:'user', content: assembled.user}], output_format: zodOutputFormat(v4Schema, 'profile') })`. Same surface used by M010 generators + M009 weekly_review + M008 episodic consolidate.
- **D-14: Discriminated outcome type.** `type PsychologicalProfileGenerationOutcome = { profileType: 'hexaco' | 'schwartz', outcome: 'updated' | 'skipped_below_threshold' | 'error', error?: string, wordCount?: number, overallConfidence?: number, durationMs: number }`. Logged as `logger.info({ outcome, profileType, ... }, 'chris.psychological.<profileType>.<outcome>')` — REQUIREMENTS PGEN-02 names `chris.psychological.hexaco.{updated,skipped_below_threshold,error}` verbatim.
- **D-15: One Sonnet call per profile type — NOT per-dimension.** HEXACO = 1 call for all 6 dimensions in one structured output (cross-dimension coherence preserved). Schwartz = 1 call for all 10 values in one structured output (circumplex coherence preserved). NOT 16 per-dimension calls. Per-call latency ~10s vs per-dim calls 16×10s = 160s. `[auto]` Batching — Q: "One call per dim or one call per profile-type?" → Selected: "One call per profile-type" (recommended per research SUMMARY "2 Sonnet calls per monthly fire").
- **D-16: `Promise.allSettled` execution order is set by the orchestrator (D-19).** Generators themselves do not invoke each other.

### substrate-hash recording without short-circuit (Plan 38-02 / PGEN-06 — UNCONDITIONAL FIRE)

- **D-17: substrate_hash is computed and persisted on every fire — but the matching-prior-hash branch does NOT skip the Sonnet call.** Direct inverse of M010 GEN-07 idempotency. Implementation: compute SHA-256 of canonical JSON of substrate (same shape as M010 D-15 — pensieveIds sorted + episodicDates sorted + schemaVersion), log the computed value in the outcome (`'chris.psychological.<profileType>.hash_recorded'` at debug level), then **proceed unconditionally to the Sonnet call**. No `if (prevHash === currHash) return skip` branch. `[auto]` Hash skip semantics — Q: "Skip on matching hash or unconditional fire?" → Selected: "Unconditional fire (PGEN-06)" (LOCKED by REQUIREMENTS PGEN-06 — not a gray area; the auto-mode pick is just confirmation).
- **D-18: Rationale comment inline in `psychological-profile-updater.ts` documents the divergence from M010.** REQUIREMENTS PGEN-06 mandates this comment. Phrasing (planner can polish):
  ```
  // Divergence from M010 GEN-07 (operational profile-updater.ts): psychological
  // profiles fire UNCONDITIONALLY on the monthly cron. A skipped month creates
  // a permanent gap in the inter-period consistency time series; trait inference
  // needs a data point every month. substrate_hash is recorded on each fire for
  // audit-trail / forensic-replay only — NOT used for short-circuit.
  ```
  Comment placement: top of the `updateAllPsychologicalProfiles()` function body, before the generator invocations.

### `prevHistorySnapshot` injection (Plan 38-02 / PGEN-07)

- **D-19: Orchestrator threads `prevHistorySnapshot` from substrate → generator → prompt assembler.** `loadPsychologicalSubstrate` already returns `prevHistorySnapshot` per Phase 37 — the generator passes it into `assemblePsychologicalProfilePrompt(profileType, substrate, prevHistorySnapshot, wordCount)`. The assembler renders it inside the `## CURRENT PROFILE STATE` block (D-09). Sonnet self-reports a `data_consistency` field in its structured output — the host stores it verbatim, performs no stddev / inter-period math.
- **D-20: Host-side inter-period consistency math is explicitly deferred.** REQUIREMENTS PGEN-07 verbatim: "Host does NOT compute stddev or any inter-period math (deferred to v2.6.1 — needs ≥3 monthly fires to be statistically meaningful)." Comment in the generator documents this. The deferred work is `CONS-01` in v2.6.1.

### Orchestrator (Plan 38-03 / PGEN-04)

- **D-21: `Promise.allSettled` execution.** `updateAllPsychologicalProfiles()` invokes both generators concurrently via `Promise.allSettled([generateHexacoProfile(deps), generateSchwartzProfile(deps)])`. Per-generator failures isolated; aggregate result logged with one `logger.info` per profile type. `[auto]` Execution model — Q: "Promise.all vs Promise.allSettled vs sequential?" → Selected: "Promise.allSettled" (recommended; mirrors M010 D-21 — HEXACO failing must not abort Schwartz per REQUIREMENTS PGEN-04 verbatim).
- **D-22: No retry loop.** A failed generator logs `'chris.psychological.<profileType>.error'` with the error and waits for next month. No exponential backoff, no second attempt within the same fire. Matches M010 D-22 + M008/M009 conservative-retry posture; monthly cadence (less frequent than M010's weekly) makes the wait penalty larger, but the alternative (retry inside the same fire) increases cost without changing the inference signal. `[auto]` Retry strategy — Q: "Retry failed generators within the same fire?" → Selected: "No retry — next month's cron is the retry" (recommended; matches M010 D-22).
- **D-23: Attachment generator is NOT included in the orchestrator's `Promise.allSettled`.** REQUIREMENTS PGEN-04 verbatim: "Attachment generator NOT included (population deferred to post-M011 weekly sweep)." The attachment table from Phase 37 stays in cold-start state (all dims NULL, `activated = false`) throughout M011. The orchestrator returns `{ hexaco: PromiseSettledResult, schwartz: PromiseSettledResult }`. v2.6.1 / ATT-POP-01 will add the attachment population orchestration via a separate weekly sweep — that work has its own monthly-or-weekly cadence decision, deliberately out of Phase 38 scope.
- **D-24: Substrate loading happens once per fire at the orchestrator level.** `updateAllPsychologicalProfiles()` calls `loadPsychologicalSubstrate('hexaco', now)` once — both generators receive the same substrate (the source filter `WHERE source='telegram'` is identical for HEXACO and Schwartz; word-count gating is identical). Saves one DB roundtrip per fire. **Caveat:** the `profileType` argument to `loadPsychologicalSubstrate` only affects `prevHistorySnapshot` (which is per-profile-type). The orchestrator must therefore call substrate-load with each profile type to get the right snapshot — OR refactor to a two-stage call where the corpus+wordCount load once and the snapshot loads twice. **Decision: call `loadPsychologicalSubstrate` once per profile type** (2 calls total per fire) — simpler, the corpus/wordCount query is cached by postgres for the second call, total wall-clock impact <50ms. The "single substrate load" optimization is deferred to v2.6.1 if profiling shows meaningful overhead.
- **D-25: Orchestrator returns `Promise<void>` / fire-and-forget.** Caller is the cron handler. Outcomes observed via logs, not return values. Matches M010 D-23 + `src/episodic/cron.ts` pattern.

### Monthly cron registration (Plan 38-03 / PGEN-05)

- **D-26: 5th cron, `'0 9 1 * *'`, `{timezone: config.proactiveTimezone}` (default `'Europe/Paris'`).** The 1st of each month at 09:00 Paris time. `[auto]` Cron timing — Q: "1st of month at what time?" → Selected: "09:00 Paris" (LOCKED by REQUIREMENTS PGEN-05 — verbatim `'0 9 1 * *'`).
- **D-27: Collision-avoidance with M010 Sunday 22:00 cron is verified at registration time.** When the 1st of a month falls on a Sunday, the M011 cron (09:00) is 13 hours BEFORE the M010 cron (22:00) on that same day — no overlap. `cron.validate('0 9 1 * *')` + an integration assertion in `cron-registration.test.ts` confirms the two crons can co-exist without same-minute collision (the day-and-hour collision check is verbatim from PGEN-05). The Phase 38 plan includes a unit test that computes the next-fire date for both crons for the upcoming 12 months and asserts they never coincide within the same hour. Lock to `'0 9 1 * *'` rather than dodging to `'0 9 2 * *'` — predictable monthly cadence trumps "avoid the Sunday corner case."
- **D-28: `config.psychologicalProfileUpdaterCron` env var with `cron.validate` fail-fast.** Mirrors M010's `profileUpdaterCron` shape at `src/config.ts:87`. Default value `'0 9 1 * *'`; env-var override `PSYCHOLOGICAL_PROFILE_UPDATER_CRON` allows testing. Fail-fast at module load if `validate(value)` returns false. Asserted by a new config unit test.
- **D-29: `CronRegistrationStatus.psychologicalProfileUpdate: 'registered' | 'failed'` field.** Added to the existing interface in `src/cron-registration.ts:22` alongside the existing `profileUpdate` field (M010). The `RegisterCronsDeps` interface adds a `runPsychologicalProfileUpdate: () => Promise<void>` field. Wrapped in try/catch that logs `psychological.profile.cron.error` (CRON-01 belt-and-suspenders pattern from M010 D-26).
- **D-30: `/health` endpoint reports `psychological_profile_cron_registered`.** The health response object gains `psychological_profile_cron_registered: status.psychologicalProfileUpdate === 'registered'` boolean. REQUIREMENTS PGEN-05 names this key verbatim. Wire-up alongside the existing `profile_cron_registered` field in `src/index.ts` health handler.
- **D-31: Wiring in `src/index.ts` `registerCrons({...})` call.** New `runPsychologicalProfileUpdate: () => updateAllPsychologicalProfiles()` field added to the deps object. No changes to `createApp`'s shape.

### Sonnet structured output schema (Plan 38-02)

- **D-32: Output schema = Phase 37 v4 schemas, unchanged.** The Zod v4 schemas Phase 37 shipped in `src/memory/profiles/psychological-schemas.ts` (`HexacoProfileSchemaV4`, `SchwartzProfileSchemaV4`) are the SDK-boundary schemas — `zodOutputFormat(HexacoProfileSchemaV4, 'profile')` is consumed verbatim. Each schema includes per-dim `{score, confidence, last_updated}` shape; the host code generates `last_updated` server-side (the v4 schema may need a small adjustment to allow Sonnet to omit `last_updated` and let the host inject it — the planner verifies whether Phase 37's v4 schema currently requires `last_updated` from Sonnet or accepts host-injection).
- **D-33: No `.refine()` ceiling on `overall_confidence` at the Zod v4 boundary.** Distinct from M010 D-32 (which used `.refine()` to enforce `data_consistency < 0.5` when `entryCount < 20`). For M011: word count below 5,000 is gated upstream by `loadPsychologicalSubstrate` (PSCH-08); above 5,000 there is no in-prompt host-side ceiling — the empirical r ≈ .31–.41 ceiling is communicated to Sonnet via the directive language (D-10), and the cross-period consistency signal in `data_consistency` reflects volume + stability. Adding `.refine()` here would either be redundant (word count gate already fired) or block legitimate above-floor inferences. `[auto]` Confidence ceiling — Q: "Add a Zod refine ceiling on overall_confidence?" → Selected: "No — prompt-level directive only" (recommended; M010's refine pattern applies to a different threshold model).

### Three-cycle unconditional-fire integration test (Plan 38-02 / verifies PGEN-06)

- **D-34: Integration test file location `src/memory/__tests__/psychological-profile-updater.integration.test.ts`.** Real Docker postgres; mocks Anthropic SDK via `mockAnthropicParse`. Test structure:
  - Setup: seed populated substrate (e.g., 6,000 telegram words of Greg's speech, distributed across 30 days)
  - Cycle 1: invoke `updateAllPsychologicalProfiles()` → assert `mockAnthropicParse.toHaveBeenCalledTimes(2)` (1 HEXACO + 1 Schwartz); assert both profile rows have `overall_confidence > 0`; assert `profile_history` has 2 rows (one per profile_type)
  - Cycle 2: re-invoke `updateAllPsychologicalProfiles()` with **identical substrate** → assert `mockAnthropicParse.toHaveBeenCalledTimes(4)` cumulative (NOT 2 — this is the inverse-of-idempotency assertion); assert `profile_history` has 4 rows total
  - Cycle 3: INSERT 5 new Pensieve telegram entries with new content → re-invoke → assert `mockAnthropicParse.toHaveBeenCalledTimes(6)` cumulative; `profile_history` has 6 rows
  - Per-cycle assertion that `substrate_hash` IS recorded (not blank) — proves the hash machinery is wired even when not used for skip
- **D-35: Test name and comment EXPLICITLY document the inverse-of-M010 contract.** Test file docblock includes:
  ```
  // CRITICAL: This test is the INVERSE of M010's PTEST-03 idempotency test.
  // M010 PTEST-03 asserts hash-skip behavior (cumulative 4 calls after Cycle 2
  // with identical substrate). M011 PMT-05 asserts UNCONDITIONAL FIRE (cumulative
  // 4 calls after Cycle 2 — same number but different semantics). If a future
  // refactor introduces hash-skip "for consistency with M010", this test fails.
  // Do NOT "fix" the test — the divergence is intentional per PGEN-06.
  ```
- **D-36: Mocked `mockAnthropicParse` returns a designed-signature payload.** Realistic HEXACO + Schwartz output values (e.g., openness=4.2 conf=0.6, conscientiousness=4.5 conf=0.5, etc.) — exact values irrelevant for the unconditional-fire assertion; just need to be parseable by the v4 schema. The signature-verification test (PMT-04, designed openness >=4.0 within tolerance) is Phase 40, not Phase 38.

### Claude's Discretion

The planner has flexibility on:

- **Whether to extract a `runPsychologicalProfileGenerator(config, deps)` helper** from the two generator files (D-11/D-12). If duplication is mechanical and clear, extract. If divergence between HEXACO and Schwartz justifies separate functions, keep them separate. Phase 34 used per-file generators (4 files mostly-identical); Phase 38 has only 2 files — extraction may be premature.
- **Exact placement of the `prevHistorySnapshot` lookup query inside `loadPsychologicalSubstrate`.** Phase 37 already exposes `prevHistorySnapshot` per profile type — the orchestrator just consumes it. No extra Phase 38 work unless the existing lookup proves insufficient.
- **Whether the Hard Rule extension constant `PSYCHOLOGICAL_HARD_RULE_EXTENSION` (D-07) is a const string or a const-returning function.** Either works; const string is simpler and matches `DO_NOT_INFER_DIRECTIVE` shape at `src/memory/profile-prompt.ts:107`.
- **Whether to write a separate unit test for `assemblePsychologicalProfilePrompt` (e.g., `psychological-profile-prompt.test.ts`) or fold the structural test into the generator integration test.** Recommend: separate unit test for the prompt builder (mirrors `src/memory/__tests__/profile-prompt.test.ts` pattern from M010). Structural assertions are cheaper at the unit level.
- **Exact comment phrasing for the unconditional-fire divergence (D-18)** — D-18 provides a starting phrasing; the planner can polish for clarity.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### M011 Research (locked decisions)
- `.planning/research/SUMMARY.md` — M011 consolidated research; phase-ownership map; locked architecture decisions; "2 Sonnet calls per monthly fire" + "unconditional fire" rationale
- `.planning/research/ARCHITECTURE.md` §§3-5 — prompt assembler fork rationale (cannot extend `ProfilePromptDimension` union); orchestrator split rationale (different cadence + different substrate-load contract); separate cron entry
- `.planning/research/PITFALLS.md` Pitfalls 1, 5, 6 — D027 trait-authority sycophancy (Phase 38/39 co-mitigation), unconditional-monthly-fire vs hash-skip (LOCKED here), monthly-cron registration with day-and-hour collision check
- `.planning/research/STACK.md` — zero new dependencies; reuse `messages.parse` + `zodOutputFormat` from M010 pattern

### Project specs
- `.planning/PROJECT.md` — Key Decisions D027 (Hard Rule — Chris never tells Greg he is right because of who he is), D028 (attachment activation gate — population deferred), D042 (Never-Retrofit Checklist — relevant to Phase 38 only insofar as Phase 37 already satisfied it), D043 (PROFILE_INJECTION_MAP — Phase 39 work, Phase 38 just produces the data), D045 (three-way `describe.skipIf` for live tests — Phase 40 work), D046 (live-test cost discipline — Phase 40 work)
- `.planning/REQUIREMENTS.md` — PGEN-01..07 is this phase's contract; PSCH-01..10 (Phase 37, complete) is the substrate; PSURF-01..05 (Phase 39) downstream; PMT-01..06 (Phase 40) further downstream
- `.planning/ROADMAP.md` Phase 38 entry — full success criteria; HARD CO-LOC #M11-2; "Key divergence from M010: 3-cycle test asserts cumulative 4 Sonnet calls after Cycle 2 (inverse of M010's idempotency pattern)"

### Phase 37 deliverables (consumed by Phase 38)
- `src/memory/profiles/psychological-shared.ts` — `loadPsychologicalSubstrate<T>(profileType, now)` discriminated-union loader + `PsychologicalProfileType` re-exported via `profiles.ts`
- `src/memory/profiles/psychological-schemas.ts` — Zod v3+v4 dual schemas: `HexacoProfileSchemaV3/V4`, `SchwartzProfileSchemaV3/V4`, `AttachmentProfileSchemaV3/V4` + inferred TypeScript types
- `src/memory/profiles.ts` — `getPsychologicalProfiles()` reader + `PSYCHOLOGICAL_PROFILE_SCHEMAS` dispatcher + `chris.psychological.profile.read.*` log namespace
- `src/memory/confidence.ts` — `MIN_SPEECH_WORDS = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`, `isAboveWordThreshold` (Phase 38 does NOT redefine the threshold; consumes Phase 37's gate decision at the substrate-loader level)
- `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` — two-directional D047 audit; Phase 38 files MUST pass this audit (no operational tokens in `psychological-*.ts`; no psych tokens in operational files)
- `src/db/migrations/0013_psychological_profiles.sql` — applied; 3 tables seeded; cold-start `substrate_hash = ''`, `overall_confidence = 0`, all dims NULL
- `.planning/phases/37-psychological-substrate/37-01-SUMMARY.md` and `37-02-SUMMARY.md` — Phase 37 deliverables manifest

### M010 reference patterns (most-similar phase precedents to mirror with locked divergences)
- `.planning/milestones/v2.5-phases/34-inference-engine/34-CONTEXT.md` — DIRECT ANALOG; 30 decisions captured. Mirror the structure (3 plans: 34-01 prompt → 34-02 generators → 34-03 orchestrator) and translate per the divergences locked in this CONTEXT.md
- `.planning/milestones/v2.5-phases/34-inference-engine/34-01-PLAN.md`, `34-02-PLAN.md`, `34-03-PLAN.md` — plan-shape precedents for the three sub-plans
- `.planning/milestones/v2.5-phases/34-inference-engine/34-VERIFICATION.md` — phase-verification structure to mirror

### Codebase substrate (existing patterns to mirror with locked divergences)
- `src/memory/profile-prompt.ts:51,107,124,175` — operational `assembleProfilePrompt` exemplar; `ProfilePromptDimension` type at line 51 must NOT be extended (D-03 forks instead); `DO_NOT_INFER_DIRECTIVE` at line 107 imported verbatim per D-06
- `src/memory/profiles/jurisdictional.ts` (and capital/health/family) — operational generator exemplars at the `src/memory/profiles/` level; Phase 38 adds `hexaco.ts` and `schwartz.ts` siblings using the same shape with the divergences in D-11..D-17
- `src/memory/profile-updater.ts:64` — operational `updateAllOperationalProfiles` exemplar; Phase 38 adds `updateAllPsychologicalProfiles` in a NEW sibling file `src/memory/psychological-profile-updater.ts` (NOT extending the operational orchestrator)
- `src/cron-registration.ts:22,29,40,66,73,179,189,191` — existing `profileUpdate` cron field at line 29; Phase 38 adds `psychologicalProfileUpdate` alongside (parallel pattern, separate cron entry)
- `src/config.ts:87` — existing `profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0')` exemplar; Phase 38 adds `psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *')`
- `src/index.ts` — health handler with `profile_cron_registered`; Phase 38 adds `psychological_profile_cron_registered` alongside
- `src/episodic/cron.ts` — fire-and-forget cron handler pattern that the updater's `void` return type matches per D-25

### M009 reference patterns (one-call-per-shape precedent)
- `.planning/milestones/v2.4-phases/29-weekly-review/29-02-PLAN.md` — most-similar one-shared-builder-plus-one-orchestrator structure; Phase 38 mirrors at the smaller HEXACO+Schwartz scale

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/memory/profiles/psychological-shared.ts`** (Phase 37) — `loadPsychologicalSubstrate<T>(profileType, now)` returns a discriminated union; Phase 38 consumes it directly at the orchestrator level. The `prevHistorySnapshot` field is already populated per profile type — generators receive it via prompt assembler.
- **`src/memory/profiles/psychological-schemas.ts`** (Phase 37) — Zod v3+v4 dual schemas; `HexacoProfileSchemaV4` / `SchwartzProfileSchemaV4` are the SDK-boundary schemas consumed by `zodOutputFormat`. No Phase 38 modification needed.
- **`src/memory/profile-prompt.ts`** (M010) — exports `CONSTITUTIONAL_PREAMBLE` re-export pattern (line 50-ish) and `DO_NOT_INFER_DIRECTIVE` at line 107. Phase 38 imports both verbatim per D-05/D-06.
- **`src/memory/profile-updater.ts`** (M010) — `updateAllOperationalProfiles()` at line 64 is the orchestrator shape Phase 38 mirrors with 2 generators + unconditional fire + `Promise.allSettled`.
- **`src/cron-registration.ts`** (M010 + earlier) — `CronRegistrationStatus.profileUpdate` at line 29 is the cron-status field shape Phase 38 mirrors for `psychologicalProfileUpdate`.
- **`src/config.ts:87`** — `profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0')` is the exact validated-cron shape Phase 38 mirrors at line ~88-89 with `psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *')`.
- **`@anthropic-ai/sdk` `messages.parse` + `zodOutputFormat`** — already used in M010 generators; M009 weekly_review; M008 episodic consolidate. No new SDK surface introduced.

### Established Patterns

- **HARD CO-LOC #M11-2** (set in REQUIREMENTS PGEN-01, formalized here) — shared prompt builder MUST ship in the same plan that introduces it; both generators MUST ship in the same plan. Splitting risks per-generator prompt drift (M010-06 lesson applied to M011).
- **Per-profile-type config object** — each generator file declares `{HEXACO,SCHWARTZ}_PROFILE_CONFIG` with `{ profileType, v3Schema, v4Schema }`. Mirrors M010 D-09 with `dimension` replaced by `profileType`.
- **`Promise.allSettled` execution + per-generator error isolation** — both generators run concurrently; HEXACO failure does NOT abort Schwartz (PGEN-04 verbatim).
- **Fire-and-forget orchestrator** — `void` return type; outcomes observed via structured logs, not return values. M008/M009/M010 precedent.
- **Cron `validatedCron(envVar, default)` pattern** — fail-fast at module load if `cron.validate(value)` returns false; default value is the canonical expression; env-var override allows testing.
- **`messages.parse({ model, system, messages, output_format })` SDK pattern** — used in M010 generators verbatim; Phase 38 mirrors.

### Integration Points

- **`src/memory/psychological-profile-prompt.ts` (NEW)** — exports `assemblePsychologicalProfilePrompt`, `PSYCHOLOGICAL_HARD_RULE_EXTENSION`, possibly a private `PsychologicalProfilePromptType = 'hexaco' | 'schwartz'` union. Plan 38-01 owns.
- **`src/memory/profiles/hexaco.ts` (NEW)** — exports `generateHexacoProfile(deps)` + `HEXACO_PROFILE_CONFIG`. Plan 38-02 owns.
- **`src/memory/profiles/schwartz.ts` (NEW)** — exports `generateSchwartzProfile(deps)` + `SCHWARTZ_PROFILE_CONFIG`. Plan 38-02 owns.
- **`src/memory/psychological-profile-updater.ts` (NEW)** — exports `updateAllPsychologicalProfiles(): Promise<void>`. Plan 38-03 owns.
- **`src/cron-registration.ts` (MODIFIED)** — extend `CronRegistrationStatus` with `psychologicalProfileUpdate`; extend `RegisterCronsDeps` with `runPsychologicalProfileUpdate`; register the 5th cron in `registerCrons()`. Plan 38-03 owns.
- **`src/config.ts` (MODIFIED)** — append `psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *')`. Plan 38-03 owns.
- **`src/index.ts` (MODIFIED)** — extend `registerCrons({...})` deps with `runPsychologicalProfileUpdate`; extend health response with `psychological_profile_cron_registered`. Plan 38-03 owns.
- **`src/memory/__tests__/psychological-profile-prompt.test.ts` (NEW)** — structural test for the prompt builder (CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE + PSYCHOLOGICAL_HARD_RULE_EXTENSION + per-profile-type directives present). Plan 38-01 owns.
- **`src/memory/__tests__/psychological-profile-updater.integration.test.ts` (NEW)** — three-cycle unconditional-fire integration test (PMT-05 precursor). Plan 38-02 owns.
- **`src/memory/profiles/__tests__/hexaco.test.ts`, `schwartz.test.ts` (NEW)** — per-generator unit tests (mocked Sonnet; verify upsert payload + history-row write + outcome shape). Plan 38-02 owns.

</code_context>

<specifics>
## Specific Ideas

- **Mirror Phase 34's three-plan split exactly.** Phase 34 (M010 inference engine) shipped clean with 34-01 (prompt builder + test), 34-02 (generators + substrate-hash test), 34-03 (orchestrator + cron + config + /health). Phase 38 uses the same split shape with 2 generators instead of 4, monthly instead of weekly, and the unconditional-fire divergence in 38-02.
- **`PsychologicalProfileType` is imported from `psychological-shared.ts`**, NOT redefined in the prompt file. Phase 37 already locked the canonical type. Keep one source of truth.
- **The Hard Rule extension constant lives in the prompt file**, NOT in `src/chris/personality.ts`. The personality file holds invariants applied to all modes; the psychological extension is scoped specifically to psychological profile inference. Phase 39's prompt-injection footer (PSURF-02) will reuse this same constant by import.
- **No retry on Sonnet failure** — `Promise.allSettled` per D-21 + no retry per D-22. Failed month is logged + visible in `/health` next-fire scheduling; trustworthy observability is the M008/M009/M010 precedent.
- **The integration test (D-34) IS the PMT-05 substrate**, not PMT-05 itself. PMT-05 (Phase 40) uses primed `m011-30days` fixtures + the `--psych-profile-bias` flag from PMT-01. Phase 38's integration test uses inline mocked substrate + the unconditional-fire assertion — sufficient to lock the contract before the more elaborate Phase 40 fixture work.
- **Live Sonnet 4.6 calls in tests are NOT part of Phase 38.** All Sonnet interaction in Phase 38 tests is mocked. Live test gate (PMT-06, 3-of-3 atomic, dual-gated `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`) is Phase 40 only per D045/D046 — Phase 38 doesn't burn the live-test budget.
- **`messages.parse` failure handling** is per-generator. If Sonnet returns malformed structured output that the v4 schema rejects, the generator logs `chris.psychological.<profileType>.error` with the parse error + returns `{ outcome: 'error' }`. The orchestrator's `Promise.allSettled` ensures the other generator is unaffected.

</specifics>

<deferred>
## Deferred Ideas

- **Attachment generator** — D-23 + REQUIREMENTS PGEN-04 verbatim defer this to v2.6.1 / ATT-POP-01. The attachment table stays in cold-start state throughout M011. Phase 38 must NOT include `generateAttachmentProfile` even as a stub — adding it would falsely suggest the activation orchestration is in scope.
- **Host-side inter-period consistency math** — D-20 + REQUIREMENTS PGEN-07 verbatim. `data_consistency` is Sonnet-reported only in M011; host-side stddev / change-detection deferred to v2.6.1 / CONS-01 / CONS-02 (needs ≥3 monthly fires to be statistically meaningful).
- **`.refine()` ceiling on `overall_confidence`** — D-33 explicitly excludes this. If post-M011 empirical observation shows confidence inflation patterns above the 5,000-word floor, the refine can be added in v2.6.1.
- **Single-load substrate optimization** — D-24 accepts 2 substrate loads per fire (one per profile type) for the prevHistorySnapshot lookup. Refactor to one substrate query + two snapshot lookups deferred to v2.6.1 if profiling shows >100ms overhead per fire.
- **`runPsychologicalProfileGenerator(config, deps)` helper extraction** — Claude's-discretion item in D-11/D-12. The planner may extract OR keep separate functions. With only 2 generators (vs M010's 4), extraction may be premature.
- **Retry on Sonnet failure** — D-22 defers any retry strategy beyond "next month's cron." If empirical observation shows >2 consecutive monthly fires failing, revisit in v2.6.1.
- **Per-profile-type substrate filtering** — Phase 38 uses the same `source='telegram'` + RITUAL_RESPONSE-excluded corpus for both HEXACO and Schwartz. Per-profile-type substrate views (e.g., feeding only longform reflective entries to Schwartz) deferred to v2.6.1 only if signature-detection accuracy bound r ≈ .31–.41 is reachable at lower-pollution scope; first M011 deployment will reveal whether this is needed.
- **`hash_recorded` log event at `debug` level (D-17)** — captures the audit-trail benefit of computing substrate_hash without conflating with `updated` / `skipped_below_threshold` / `error`. Optional; planner may collapse into the main outcome log if simplicity is preferred.
- **Cron collision-avoidance dodge (e.g., `'0 9 2 * *'` to avoid the Sunday-1st corner case)** — D-27 explicitly rejects this. Lock to `'0 9 1 * *'` per REQUIREMENTS PGEN-05; predictable monthly cadence trumps "avoid the Sunday corner case." Cron-collision-detection unit test stays in scope.

</deferred>

---

*Phase: 38-psychological-inference-engine*
*Context gathered: 2026-05-14*
