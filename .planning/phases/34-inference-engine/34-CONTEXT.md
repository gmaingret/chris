# Phase 34: Inference Engine — Context

**Gathered:** 2026-05-12 (via `/gsd-discuss-phase 34 --auto`)
**Status:** Ready for planning
**Prior phase:** Phase 33 (Profile Substrate) — shipped + deployed to prod 2026-05-11 (migration 0012, 5 tables, getOperationalProfiles reader, confidence module, Zod v3/v4 schemas)

<domain>
## Phase Boundary

Phase 34 ships the **inference engine** that turns Phase 33's seeded profile rows into Sonnet-inferred operational profiles. After this phase:

- A 4th cron fires every Sunday 22:00 Paris and runs `updateAllOperationalProfiles()` end-to-end against Greg's real Pensieve+episodic substrate
- `src/memory/profile-prompt.ts` exports `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` — the **shared builder consumed by all 4 generators** (HARD CO-LOC #M10-2 enforcement against per-dimension drift)
- Four per-dimension generators in `src/memory/profiles/{jurisdictional,capital,health,family}.ts` each call Sonnet with structured output, write a `profile_history` snapshot, then upsert via `name='primary'` sentinel
- `src/memory/profile-updater.ts` orchestrates the four generators via `Promise.allSettled` with discriminated outcome logging
- 10-entry threshold short-circuits the Sonnet call (logs `'chris.profile.threshold.below_minimum'`)
- SHA-256 substrate-hash idempotency short-circuits the Sonnet call on unchanged input (emits `'profile_skipped_no_change'`)
- `/health` endpoint reports `profile_cron_registered: 'registered' | 'failed'`
- Two-cycle integration test verifies substrate-hash idempotency (second-fire-blindness regression detector — M009 `lt→lte` lesson applied)

**Explicitly NOT in this phase:** `/profile` Telegram command, mode-handler injection, `buildSystemPrompt` refactor, the `m010-30days` primed fixture, live 3-of-3 anti-hallucination test. Those are Phases 35 + 36.

**Inter-phase coupling:**
- **Upstream (consumes Phase 33):** `getOperationalProfiles()`, `computeProfileConfidence()`, `isAboveThreshold()`, `MIN_ENTRIES_THRESHOLD`, `SATURATION`, per-profile Zod v3/v4 schema pairs from `src/memory/profiles/schemas.ts`, the four seeded sentinel rows
- **Downstream (consumed by Phase 35):** populated rows with non-zero confidence enable `/profile` non-null rendering test and REFLECT/COACH/PSYCHOLOGY mode-handler injection wiring

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M010 research pass (STACK + FEATURES + ARCHITECTURE + PITFALLS, synthesized in `.planning/research/SUMMARY.md`). The `--auto` flag locked each at the recommended option. The planner should treat them as the contract surface and validate via the success criteria in ROADMAP.md Phase 34 entry.

`[auto]` annotations record the gray area, the recommended option chosen, and the source.

### Plan split structure

- **D-01: 3 plans matching REQUIREMENTS traceability.** `[auto]` Plan structure — Q: "How to split Phase 34?" → Selected: "3 plans (matches REQUIREMENTS GEN-01..GEN-07 mapping)" (recommended default per REQUIREMENTS table rows 86-92).
  - **Plan 34-01: Shared prompt builder + structural test** — `src/memory/profile-prompt.ts` ships `assembleProfilePrompt`, `CONSTITUTIONAL_PREAMBLE` re-export check, `DO_NOT_INFER_DIRECTIVE` constant, prev-state injection block, volume-weight ceiling phrasing. Structural test in `src/memory/__tests__/profile-prompt.test.ts` asserts CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE appear in every dimension's assembled output. Satisfies GEN-04. ~4 tasks. **HARD CO-LOC #M10-2: this plan MUST ship before plan 34-02.**
  - **Plan 34-02: Four generators + substrate loader + substrate-hash + two-cycle test** — `src/memory/profiles/shared.ts` (`loadProfileSubstrate`, `computeSubstrateHash`); four files `jurisdictional.ts`, `capital.ts`, `health.ts`, `family.ts` each calling `messages.parse` + zodOutputFormat(v4) + Zod v3 re-validate + threshold check + hash skip + write-before-upsert via `profile_history` + upsert via `name='primary'` sentinel; two-cycle integration test (Cycle 1 populate from seed, Cycle 2 `vi.setSystemTime` +7d with identical substrate → hash match → `mockAnthropicParse.toHaveBeenCalledTimes(4)` not 8, `profile_history` has 2 rows per dimension). Satisfies GEN-03, GEN-06, GEN-07, and the substrate portion of GEN-05 (consumption). **HARD CO-LOC #M10-3: substrate-hash test ships in the SAME plan as the first generator that introduces the hash.** ~6 tasks.
  - **Plan 34-03: Orchestrator + cron + config + /health** — `src/memory/profile-updater.ts` (`updateAllOperationalProfiles` via `Promise.allSettled`, discriminated outcome logging); `src/cron-registration.ts` registration of 4th cron (Sunday 22:00 Paris); `src/config.ts` `profileUpdaterCron` env var + `cron.validate` fail-fast; `CronRegistrationStatus.profileUpdate` field; `/health` endpoint reports `profile_cron_registered`. Satisfies GEN-01, GEN-02. ~4 tasks.

- **D-02: Plan ordering is strict, not parallelizable.** 34-01 ships before 34-02 (HARD CO-LOC #M10-2); 34-02 ships before 34-03 (orchestrator imports the per-dimension generators).

### Shared prompt builder (Plan 34-01 / GEN-04)

- **D-03: `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` signature locked.** Same shape as M009's `assembleWeeklyReviewPrompt` (pure function, zero side effects, zero DB/LLM/fs/env access). Returns a `{ system: string, user: string }` pair consumed at the SDK boundary. `dimension` typed as `'jurisdictional' | 'capital' | 'health' | 'family'`. `[auto]` Builder API — Q: "Single function returning system+user, or per-dimension subclasses?" → Selected: "single shared function (mirrors M009 weekly-review-prompt)" (recommended; HARD CO-LOC #M10-2 enforcement).
- **D-04: CONSTITUTIONAL_PREAMBLE explicit re-export check.** First section of the assembled `system` string is `CONSTITUTIONAL_PREAMBLE` imported from `src/chris/personality.ts` (same pattern as `weekly-review-prompt.ts:43`). Structural test asserts `system.startsWith('## Core Principles (Always Active)')` for all 4 dimensions.
- **D-05: `DO_NOT_INFER_DIRECTIVE` constant.** New verbatim block exported from `src/memory/profile-prompt.ts`. Phrasing locked: instructs Sonnet to leave fields empty / mark "insufficient data" when substrate does not contain the explicit fact; forbids derivation from related-but-distinct facts. Asserted present in all 4 dimension outputs by the structural test (M010-06 mitigation).
- **D-06: Volume-weight ceiling text in prompt.** The prompt explicitly tells Sonnet: "Report `data_consistency` in 0–1; the host code computes final `confidence` from `(entryCount, data_consistency)` — do NOT emit a `confidence` field directly." This resolves the STACK-vs-ARCHITECTURE conflict per research line 243: Sonnet emits `data_consistency`; host computes confidence via `computeProfileConfidence(entryCount, data_consistency)`. `[auto]` Confidence origin — Q: "Sonnet emits confidence or host computes?" → Selected: "hybrid: Sonnet emits data_consistency, host computes" (recommended per Conflict Resolution Log line 243).
- **D-07: Previous-state injection.** When `prevState` is non-null (every fire after the first, including the seed row from Phase 33), the prompt includes a `## CURRENT PROFILE STATE` section rendering the prior row's jsonb fields verbatim. Sonnet is instructed to update high-confidence fields ONLY when 3+ supporting substrate entries justify the change (M010-03 mitigation against profile drift).

### Per-dimension generator implementation (Plan 34-02 / GEN-03)

- **D-08: One generator file per dimension, identical shape.** `src/memory/profiles/{jurisdictional,capital,health,family}.ts` each export `generate<Dimension>Profile(deps): Promise<ProfileGenerationOutcome>`. Body is mechanical: load substrate → check threshold → compute hash → skip-if-match → call Sonnet → parse v4 → re-validate v3 → write history snapshot → upsert. The only per-file variance is the dimension config object and the imported v3/v4 schemas.
- **D-09: Dimension config objects.** Each file declares a constant `JURISDICTIONAL_PROFILE_CONFIG` (etc.) with `{ dimension, v3Schema, v4Schema, dimensionSpecificDirective }` shape. Keeps the generator body uniform; the planner may further extract a `runProfileGenerator(config, deps)` helper if duplication is mechanical (Claude's discretion).
- **D-10: Sonnet model = `SONNET_MODEL` (claude-sonnet from config).** Use `anthropic.messages.parse({ model: SONNET_MODEL, system: assembled.system, messages: [{role:'user', content: assembled.user}], output_format: zodOutputFormat(v4Schema, 'profile') })` — the same surface used by M009 weekly_review and M008 episodic consolidate.
- **D-11: Discriminated outcome type.** `type ProfileGenerationOutcome = { dimension, outcome: 'profile_updated' | 'profile_skipped_no_change' | 'profile_below_threshold' | 'profile_generation_failed', error?, entryCount?, confidence?, durationMs }`. Logged as `logger.info({ outcome, dimension, ... }, 'chris.profile.<outcome>')` (and `'chris.profile.threshold.below_minimum'` specifically — REQUIREMENTS GEN-06 names this log key verbatim).

### Substrate loader (Plan 34-02 / GEN-03 substrate portion)

- **D-12: `src/memory/profiles/shared.ts` exports `loadProfileSubstrate(): Promise<ProfileSubstrate>`** returning `{ pensieveEntries, episodicSummaries, decisions, entryCount }`. `[auto]` OQ-1 Pensieve domain-filter strategy — Q: "How to filter Pensieve entries per dimension?" → Selected: "Tag-only filter (FACT/RELATIONSHIP/INTENTION/EXPERIENCE), no keyword/semantic" (recommended starting point per OQ-1; upgrade only if Phase 36 fixture tests show contamination).
- **D-13: Substrate sources fixed.** `pensieve_entries` filtered by tags FACT, RELATIONSHIP, INTENTION, EXPERIENCE (the four substrate-bearing tag types — INSTRUCTION/INSIGHT/RITUAL_RESPONSE/etc. are excluded as not facts-of-record). Episodic summaries via existing `getEpisodicSummariesRange(start, end)` from `src/pensieve/retrieve.ts` over the **last 60 days** (matches the rolling-context horizon used elsewhere). Decisions via the existing decisions reader, filter `status='resolved'` over last 60 days. `entryCount` = `pensieveEntries.length` (the threshold gate uses Pensieve count, not episodic/decision counts — episodic summaries are derived, not facts).
- **D-14: `loadProfileSubstrate` is called ONCE per fire, not per dimension.** All 4 generators receive the same substrate object. Per-dimension filtering happens inside the prompt builder via the `dimensionSpecificDirective` — Sonnet ignores irrelevant entries (OQ-1 recommended starting point). This is a deliberate v1 simplification; per-dimension substrate views are a v2.5.1 candidate if fixture tests show signal pollution.

### Substrate-hash idempotency (Plan 34-02 / GEN-07)

- **D-15: SHA-256 of canonical JSON.** `computeSubstrateHash(substrate, prevStateMeta): string` returns `sha256(canonicalJSON({ pensieveIds: substrate.pensieveEntries.map(e=>e.id).sort(), episodicDates: substrate.episodicSummaries.map(s=>s.summaryDate).sort(), decisionIds: substrate.decisions.map(d=>d.id).sort(), schemaVersion: prevStateMeta.schema_version }))`. ID-and-date-only (not full content) — minimizes false-positive misses while staying deterministic across processes.
- **D-16: `schema_version` participates in the hash.** A schema-version bump invalidates all prior hashes → forces regeneration on next fire. This is a deliberate cache-busting mechanism for schema migrations (M010-11 + M010-09 interplay).
- **D-17: Comparison is per-dimension, not global.** Each of the 4 generators independently compares its computed substrate hash to its own `profile.substrate_hash` column. A single dimension's hash mismatch does NOT force the other three to regenerate. This is consistent with `Promise.allSettled` per-dimension error isolation.
- **D-18: Seed-row `substrate_hash = ''` from Phase 33 D-11 always triggers regen.** First fire ever for each profile always calls Sonnet (empty string never matches a real hash). This guarantees the seed row is replaced with an inferred profile on first fire (assuming threshold met).

### Threshold enforcement (Plan 34-02 / GEN-06)

- **D-19: Threshold check happens BEFORE substrate-hash computation.** Cheaper short-circuit. If `entryCount < 10`, the generator logs `'chris.profile.threshold.below_minimum'` (verbatim — required by GEN-06), leaves the profile row untouched (confidence stays 0, fields stay "insufficient data" markers from Phase 33 seed), and returns `{ outcome: 'profile_below_threshold' }`. NO Sonnet call.
- **D-20: Threshold uses `entryCount = pensieveEntries.length`.** Per D-13 — Pensieve count gates the dimension, not aggregate count across all sources. This matches M010 spec intent: a dimension with 8 Pensieve entries but 20 episodic summaries is still below-threshold (episodic summaries are derived from past Pensieve entries, not new facts).

### Orchestrator (Plan 34-03 / GEN-02)

- **D-21: `Promise.allSettled` execution.** `updateAllOperationalProfiles()` invokes all four generators concurrently via `Promise.allSettled([generateJurisdictional(deps), generateCapital(deps), generateHealth(deps), generateFamily(deps)])`. Per-generator failures isolated; aggregate result logged with one `logger.info` per dimension. `[auto]` Execution model — Q: "Promise.all vs Promise.allSettled vs sequential?" → Selected: "Promise.allSettled" (recommended; STACK-vs-ARCHITECTURE conflict resolved at research line 241 in favor of error isolation; 4 calls/week nowhere near Anthropic 200 RPM rate limit).
- **D-22: No retry loop.** A failed generator logs `'profile_generation_failed'` with the error and waits for next Sunday. No exponential backoff, no second attempt within the same fire. This matches M008 episodic and M009 weekly-review conservative-retry posture; cron cadence (weekly) IS the retry mechanism. `[auto]` Retry strategy — Q: "Retry failed generators within the same fire?" → Selected: "no retry — next week's cron is the retry" (recommended; matches M008/M009 precedent).
- **D-23: Orchestrator returns void / fire-and-forget.** Caller is the cron handler. Outcomes are observed via logs, not return values. Matches `src/episodic/cron.ts` pattern.

### Cron registration (Plan 34-03 / GEN-01)

- **D-24: 4th cron, `'0 22 * * 0'`, `{timezone: config.proactiveTimezone}`.** `[auto]` Cron timing — Q: "Sunday 21:00 or 22:00 Paris?" → Selected: "Sunday 22:00 Paris" (recommended; M010-04 — 2-hour gap after M009's 20:00 weekly_review covers worst-case retry-loop adversarial week; rationale recorded in migration 0012 SQL comment in Phase 33).
- **D-25: `config.profileUpdaterCron` env var with `cron.validate` fail-fast.** Mirrors M009's `weeklyReviewCron` shape (`src/config.ts:53,57` precedent). Default value `'0 22 * * 0'`; env-var override allows testing. Fail-fast at module load if `validate(value)` returns false — silent bad cron is the M008 EPI-04 incident class. Asserted by config unit test.
- **D-26: `CronRegistrationStatus.profileUpdate: 'registered' | 'failed'` field.** Added to the existing interface in `src/cron-registration.ts:22`. The `RegisterCronsDeps` interface adds a `runProfileUpdate: () => Promise<void>` field. Wrapped in try/catch that logs `profile.cron.error` (CRON-01 belt-and-suspenders pattern — `src/cron-registration.ts:21-31` JSDoc).
- **D-27: `/health` endpoint reports `profile_cron_registered`.** The health response object (currently exposing RIT-12-style cron status) gains a `profile_cron_registered: status.profileUpdate === 'registered'` boolean. REQUIREMENTS GEN-01 names this key verbatim. Wire-up is in `src/index.ts`'s health handler (alongside the existing cron-status fields).
- **D-28: Wiring in `src/index.ts:89` `registerCrons({...})` call.** New `runProfileUpdate: () => updateAllOperationalProfiles()` field added to the deps object. No changes to `createApp`'s shape.

### profile_history write-before-upsert (Plan 34-02 / interplay with PROF-02)

- **D-29: Snapshot the current row BEFORE the upsert.** Each generator's success path: (1) read current profile row, (2) `INSERT INTO profile_history (profile_table_name, profile_id, snapshot) VALUES (...)` with the current row's full jsonb (including metadata: `id`, `name`, `schema_version`, `substrate_hash`, `last_updated`, `confidence`), (3) upsert the new row via `db.insert(...).onConflictDoUpdate({ target: <table>.name, set: {...} })` per Phase 33 D-04 sentinel-row pattern. On a no-change skip (D-15 hash match) NO history row is written — `profile_history` records actual state changes only.
- **D-30: History snapshot is full row, not diff.** Phase 33 D-17 already designed the table for this. Replay-from-snapshot is a v2.5.1+ capability; M010 just writes the snapshots and forgets them.

### Sonnet structured output schema (Plan 34-02)

- **D-31: Output schema = Phase 33 v4 schemas, unchanged.** The schemas Phase 33 shipped in `src/memory/profiles/schemas.ts` are the SDK-boundary schemas — `zodOutputFormat(profileJurisdictionalV4Schema, 'profile')` is consumed verbatim. Each schema includes a `data_consistency: z.number().min(0).max(1)` field; the host code reads this and computes final `confidence` via `computeProfileConfidence(entryCount, data_consistency)`.
- **D-32: Volume-weight ceiling refine inside the v4 schema.** The v4 schema's `.refine()` rejects parses where `data_consistency > 0.5 && entryCount < 20` — this is the M010-01 confidence-inflation mitigation. On refine failure, the generator logs the failure and returns `'profile_generation_failed'` (D-22: no retry; next week's fire retries). `[auto]` Confidence inflation refine — Q: "Where does the volume-weight ceiling enforce?" → Selected: "Zod v4 .refine() at SDK boundary" (recommended per M010-01).
- **D-33: Per-field source citation NOT required in v1.** Research SUMMARY line 102 lists per-field `sources: uuid[]` as an M010-02 mitigation. **Deferred to v2.5.1.** Rationale: the `DO_NOT_INFER_DIRECTIVE` (D-05) is the primary anti-hallucination control; per-field source arrays add output-token weight (cost) without yet-measurable benefit on a 4-call/week budget. Phase 36's live anti-hallucination test will quantify residual hallucination rate; if non-zero, v2.5.1 adds the source-arrays. `[auto]` M010-02 mitigation — Q: "Per-field sources arrays in v1 or v2.5.1?" → Selected: "v1 directive-only, v2.5.1 adds sources if anti-hallucination test surfaces gaps" (recommended; output-token frugality).

### Logging / telemetry

- **D-34: Discriminated outcome log keys.** All four normalized: `chris.profile.<outcome>` where outcome ∈ {`profile_updated`, `profile_skipped_no_change`, `profile_below_threshold`, `profile_generation_failed`}. Plus the verbatim GEN-06 key `chris.profile.threshold.below_minimum` for the threshold case. Aggregate orchestrator outcome (after `Promise.allSettled`): one `logger.info({ summary }, 'chris.profile.cron.complete')` with per-dimension outcome counts.

### Test strategy

- **D-35: Structural test for assembleProfilePrompt (Plan 34-01).** `src/memory/__tests__/profile-prompt.test.ts` parametrizes over all 4 dimensions; asserts CONSTITUTIONAL_PREAMBLE presence (M010-06), DO_NOT_INFER_DIRECTIVE presence, volume-weight ceiling phrasing presence, previous-state section presence when prevState non-null and absence when prevState null.
- **D-36: Two-cycle integration test (Plan 34-02, HARD CO-LOC #M10-3).** Real Docker Postgres + mocked Anthropic. Cycle 1: seeded DB (post-migration), `entryCount >= 10` synthetic in-test pensieve_entries inserts, run `updateAllOperationalProfiles()`, assert all 4 rows updated + `profile_history` has 4 rows + `mockAnthropicParse.toHaveBeenCalledTimes(4)`. Cycle 2 (same test, `vi.setSystemTime(+7d)`): re-run with IDENTICAL substrate, assert `mockAnthropicParse.toHaveBeenCalledTimes(4)` NOT 8 (hash match), assert `profile_history` still has 4 rows (no new snapshots), assert all `outcome = 'profile_skipped_no_change'`. Cycle 3 (same test): mutate one Pensieve entry, re-run, assert `mockAnthropicParse.toHaveBeenCalledTimes(8)` (one new call), assert outcome `'profile_updated'`.
- **D-37: Sparse-fixture test (Plan 34-02).** 5-Pensieve-entry fixture → all four profiles return `'profile_below_threshold'` + log line + no Sonnet call. Asserts threshold-enforcement contract.
- **D-38: Cron registration test (Plan 34-03).** Existing `src/__tests__/cron-registration.test.ts` extended: `vi.mock('node-cron')` + spy + assert `cron.schedule` called with `'0 22 * * 0'` + correct timezone; assert `runProfileUpdate` wired; assert `status.profileUpdate === 'registered'`; assert health endpoint reports `profile_cron_registered: true`.
- **D-39: Config fail-fast test (Plan 34-03).** Existing `src/__tests__/config.test.ts` extended: `profileUpdaterCron='invalid'` env → config-load throws; valid `'0 22 * * 0'` loads OK.
- **D-40: No live Sonnet call in Phase 34 tests.** The 3-of-3 atomic anti-hallucination live test (PTEST-05) is Phase 36 and dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`. Phase 34 mocks Anthropic in all tests — cost discipline per D-30-03.

### Claude's Discretion (for planner / executor)

- **Helper extraction within generators.** If the four `generate<X>Profile` functions are >80% mechanically identical, the planner MAY introduce a `runProfileGenerator(config, deps)` helper in `src/memory/profiles/shared.ts`. Each dimension file then collapses to: `export const generateJurisdictionalProfile = (deps) => runProfileGenerator(JURISDICTIONAL_PROFILE_CONFIG, deps)`. Tradeoff: helper reduces duplication but adds one level of indirection for the M010-06 reviewer. Default if unsure: extract the helper (research line 77 endorses uniform body shape).
- **Substrate window length.** Research SUMMARY uses "last 60 days" as the rolling-context horizon (D-13). The planner may tune to 90 days during planning if the Phase 33 ground-truth seed coverage suggests 60 is too narrow. Lock the chosen value as a `SUBSTRATE_WINDOW_DAYS` constant in `src/memory/profiles/shared.ts`.
- **Canonical-JSON helper choice.** D-15's substrate hash needs deterministic JSON serialization. Either reuse an existing canonical-JSON utility in `src/utils/` (check first), import `fast-json-stable-stringify` if already a transitive dep, or hand-roll a small sort-keys serializer. Tradeoff frame: dependency footprint vs maintenance.
- **Dimension-specific directive content.** D-09's `dimensionSpecificDirective` for each profile (e.g., jurisdictional: "focus on country/residency/tax-status facts; ignore relationship and health entries"). Draft these in plan 34-01 alongside `DO_NOT_INFER_DIRECTIVE`; lock as HARD CO-LOC inside the dimension config objects so they cannot drift from the structural test's expectations.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked phase-level context (read FIRST)
- `.planning/phases/33-profile-substrate/33-CONTEXT.md` — Phase 33's locked decisions (sentinel-row pattern D-04, seed-row substrate_hash='' D-11, never-throw reader D-12, confidence module D-19, history-snapshot D-17/18 — all foundational for Phase 34)
- `.planning/phases/33-profile-substrate/33-SUMMARY.md` — what Phase 33 actually shipped (read for the as-built state of the substrate)
- `.planning/phases/33-profile-substrate/33-VERIFICATION.md` — Phase 33 success criteria verification (confirms the Phase 33 contract surface is intact)

### M010 research (locked decisions)
- `.planning/research/SUMMARY.md` — consolidated M010 research summary; pitfall-to-phase ownership map (M010-02/04/06/09/10 are this phase); STACK-vs-ARCHITECTURE conflict resolution at line 241 (Promise.allSettled wins) and line 243 (Sonnet emits data_consistency, host computes confidence)
- `.planning/research/STACK.md` — zero new deps; `messages.parse({ output_format: zodOutputFormat })` pattern at SDK boundary; v3+v4 dual Zod
- `.planning/research/FEATURES.md` — §2.1-2.4 per-profile canonical fields (already shaped in Phase 33 schemas — Phase 34 just populates); §3.2 confidence calibration model
- `.planning/research/ARCHITECTURE.md` — Q1 cron-vs-ritual (cron wins — Phase 34); Q2 generator structure; Q4 reader API shape
- `.planning/research/PITFALLS.md` — M010-02 hallucinated facts (Phase 34 / D-05+D-33), M010-04 cron timing collision (Phase 34 / D-24), M010-06 shared-prompt drift (Phase 34 / D-03+D-35), M010-09 substrate_hash idempotency (Phase 34 / D-15-18), M010-10 second-fire blindness (Phase 34 / D-36)

### Project specs
- `M010_Operational_Profiles.md` (project root) — original milestone spec (legacy "John" → "Greg" naming applies to all code/requirements)
- `.planning/PROJECT.md` — Key Decisions D004 (append-only Pensieve), D005 (never-throw fire-and-forget), D029 (M009 ships before profiles), D030 (cost discipline — Phase 36's PTEST-05 is dual-gated), D031 (boundary-marker pattern), D034 (episodic_summaries 8-cols locked), D035 (profiles module never reads episodic into narrative), D041 (primed-fixture pipeline supersedes calendar wait)
- `.planning/REQUIREMENTS.md` — GEN-01..GEN-07 are this phase's contract; traceability table maps each REQ to plan (34-01/02/03)
- `.planning/ROADMAP.md` — Phase 34 entry with success criteria 1-5 verbatim; HARD CO-LOCATIONS #M10-2 (prompt builder before generators) and #M10-3 (hash test atomic with first-generating plan) named here

### Codebase substrate (existing patterns to mirror)

**M009 weekly_review (closest precedent — same shape, different domain):**
- `src/rituals/weekly-review-prompt.ts` — `assembleWeeklyReviewPrompt` pure-function pattern that `assembleProfilePrompt` mirrors; CONSTITUTIONAL_PREAMBLE injection at section 1; comment block at top documenting contract and HARD CO-LOC references
- `src/rituals/weekly-review.ts:124-end` — `messages.parse` + zodOutputFormat + v3 re-validate + retry loop pattern; `runStage2HaikuJudge` shape (don't replicate the Stage-2 judge in Phase 34 — single Sonnet call only)
- `src/rituals/weekly-review-sources.ts:36-200+` — substrate loader pattern; `loadWeeklyReviewContext` returns a typed substrate object; `getEpisodicSummariesRange` consumer
- `src/rituals/__tests__/weekly-review.test.ts` — two-cycle test scaffolding (`vi.setSystemTime`, `mockAnthropicParse.toHaveBeenCalledTimes`); use this as the template for the M10-3 two-cycle test in Plan 34-02

**M008 episodic consolidate (parallel-cron precedent):**
- `src/episodic/consolidate.ts` — v3/v4 dual at SDK boundary; never-throw contract; sequential-multi-schema (Phase 34 uses single schema per call, so simpler)
- `src/episodic/cron.ts:21-31` — CRON-01 try/catch belt-and-suspenders pattern (every cron handler wraps body in try/catch + logs `*.cron.error`); D-26 reinforces

**Phase 33 substrate (consumed by this phase):**
- `src/memory/profiles.ts` — `getOperationalProfiles()` reader + `OperationalProfiles` interface; generators write via direct `db.insert(...).onConflictDoUpdate`, not via this reader
- `src/memory/profiles/schemas.ts` — Zod v3 + v4 pairs for all 4 profile shapes; `zodOutputFormat(v4Schema, 'profile')` at the Sonnet boundary
- `src/memory/confidence.ts` — `computeProfileConfidence(entryCount, dataConsistency)`, `isAboveThreshold(entryCount)`, `MIN_ENTRIES_THRESHOLD = 10`, `SATURATION = 50` (already shipped + tested)

**Cron + config + health:**
- `src/cron-registration.ts:22-31` — `CronRegistrationStatus` interface + `RegisterCronsDeps` (extend both); JSDoc on the file explains the testability rationale (D-06 from Phase 25); CRON-01 try/catch pattern shown at lines 21-31
- `src/cron-registration.ts:48-end` — `registerCrons` body; the new `cron.schedule(deps.config.profileUpdaterCron, async () => { try { await deps.runProfileUpdate() } catch (err) { logger.error(...) } }, { timezone: deps.config.proactiveTimezone })` registration block goes at the end alongside other crons
- `src/config.ts:53-80` — `validatedCron` pattern with `cron.validate` fail-fast; `weeklyReviewCron` is the closest precedent
- `src/index.ts:89` — `registerCrons({...})` deps object site; add `runProfileUpdate` field here
- `src/index.ts` health endpoint — extend the response with `profile_cron_registered: status.profileUpdate === 'registered'`

**Pensieve readers (substrate sources):**
- `src/pensieve/retrieve.ts` — `getEpisodicSummariesRange(start, end)` already exists; the per-tag Pensieve query pattern (FACT/RELATIONSHIP/INTENTION/EXPERIENCE filter) — confirm exact API during planning (`retrieveContext` may already support tag filters; if not, planner adds a `retrieveByTags(tags, sinceDate)` helper)
- `src/pensieve/types.ts` — Pensieve tag union type (verify FACT/RELATIONSHIP/INTENTION/EXPERIENCE values match the filter constants — case-sensitive)
- `src/pensieve/ground-truth.ts:24-63` — seed data source consumed by Phase 33's seed-row INSERTs; Phase 34's first-fire substrate-hash compares to seed-row `''` and triggers regen

**Decisions reader (third substrate source):**
- Find the decisions module — likely `src/decisions/retrieve.ts` or similar — and confirm exported reader signature for `status='resolved'` + last-60-days filter; if no exact match exists, planner adds a thin wrapper

### Tests to mirror
- `src/__tests__/cron-registration.test.ts` — extend for the 4th cron; pattern for `vi.mock('node-cron')` + `cron.schedule` spy is here
- `src/__tests__/config.test.ts` — extend for `profileUpdaterCron` env-var validation
- `src/rituals/__tests__/weekly-review.test.ts` — template for two-cycle (Cycle 1 vs Cycle 2 hash idempotency) test structure

</canonical_refs>

<deferred>
## Deferred Ideas (out of Phase 34 scope)

- **Per-field `sources: uuid[]` arrays in Sonnet output (M010-02 strict mitigation).** Research SUMMARY recommends; deferred to v2.5.1 pending Phase 36 anti-hallucination test results (D-33).
- **Per-dimension substrate views.** D-14 keeps a single shared substrate object across all 4 generators in v1. Per-dimension filtering (jurisdictional sees only jurisdictional-tagged entries) is a v2.5.1 candidate if Phase 36 fixture tests reveal signal pollution.
- **Optional Haiku post-check after Sonnet output.** Research SUMMARY line 102 mentions an "optional Haiku post-check" for M010-02. Deferred — same rationale as per-field sources.
- **SATURATION tuning.** OQ-5 — first estimate is 50; tune after 4-8 weeks of real M010 operation. v2.5.1 follow-up, not a Phase 34 blocker.
- **Per-field confidence (DIFF-7).** Aggregate per-profile confidence ships in M010; per-field confidence is M013.
- **`/profile` Telegram command + mode-handler injection.** Phase 35.
- **`m010-30days` + `m010-5days` primed fixtures + live 3-of-3 anti-hallucination test.** Phase 36.

</deferred>

<code_context>
## Codebase Context (from scout pass)

### Reusable assets
- **Cron registration substrate** (`src/cron-registration.ts`): `CronRegistrationStatus` interface, `RegisterCronsDeps` interface, `registerCrons` body with CRON-01 try/catch pattern. Phase 34 extends both interfaces with one field each and adds one `cron.schedule(...)` block.
- **Config fail-fast** (`src/config.ts`): `validatedCron` helper + `weeklyReviewCron` precedent. Phase 34 adds `profileUpdaterCron` with default `'0 22 * * 0'`.
- **Sonnet SDK boundary** (`src/llm/client.ts`): `anthropic` client + `SONNET_MODEL` + `HAIKU_MODEL` exports. Phase 34 uses only Sonnet (no Haiku judge — see deferred items).
- **Substrate loader template** (`src/rituals/weekly-review-sources.ts`): `loadWeeklyReviewContext` is the precedent for `loadProfileSubstrate`. Both load multiple sources, both return a typed substrate object, both are pure-function (no side effects beyond DB reads).
- **Pure-function prompt builder** (`src/rituals/weekly-review-prompt.ts`): mirror for `assembleProfilePrompt`. Same 9-section structure, same CONSTITUTIONAL_PREAMBLE-first contract, same comment-block-as-contract documentation style.
- **v3/v4 dual schemas at SDK boundary** (`src/memory/profiles/schemas.ts` from Phase 33): already shipped; Phase 34 just imports and consumes.
- **Confidence helper** (`src/memory/confidence.ts` from Phase 33): `computeProfileConfidence`, `isAboveThreshold`, threshold constants — Phase 34 just imports.
- **`getOperationalProfiles()` reader** (`src/memory/profiles.ts`): not used by generators (they upsert directly), but used by integration tests to assert post-fire state.
- **profile_history table + Phase 33 D-29-style write-before-upsert design** (already in migration 0012): Phase 34 writes here in every successful generator path.
- **`onConflictDoUpdate` sentinel-row upsert pattern**: Phase 33 D-04 documents; precedent in `src/proactive/state.ts`.
- **Two-cycle test scaffolding**: `src/rituals/__tests__/weekly-review.test.ts` uses `vi.setSystemTime` + mock SDK boundary assertions — direct template for Plan 34-02's M10-3 atomic test.

### Integration points
- **`src/index.ts:89`** — add `runProfileUpdate: () => updateAllOperationalProfiles()` to the `registerCrons({...})` deps object.
- **`src/index.ts` health endpoint** — add `profile_cron_registered: status.profileUpdate === 'registered'` to the response object.
- **`src/cron-registration.ts:22` + `:31`** — add `profileUpdate` field to `CronRegistrationStatus` and `runProfileUpdate` to `RegisterCronsDeps`.
- **`src/config.ts`** — add `profileUpdaterCron` env-validated field; default `'0 22 * * 0'`.
- **No edits to `src/memory/profiles.ts`** — that reader is Phase 33's contract surface; Phase 34 writes via direct `db.insert(...).onConflictDoUpdate(...)`.
- **No edits to `src/memory/confidence.ts`** — already complete per Phase 33 D-19.
- **No edits to `src/memory/profiles/schemas.ts`** — already complete per Phase 33 D-15; Phase 34 just imports.

### Patterns to follow
- **Conventional commits**: `feat(34-01): assembleProfilePrompt shared builder + structural test`, `feat(34-02): four dimension generators + substrate loader + substrate-hash + two-cycle test`, `feat(34-03): updateAllOperationalProfiles orchestrator + Sunday 22:00 Paris cron + /health`.
- **HARD CO-LOC enforcement**: gsd-plan-checker MUST refuse: (a) Plan 34-02 if Plan 34-01 hasn't shipped (M10-2 violation); (b) Plan 34-02 if substrate-hash + two-cycle test are split into different plans (M10-3 violation).
- **CRON-01 try/catch belt-and-suspenders** on the cron handler — every generator failure already returns a discriminated outcome (no throw), but the cron-level wrapper provides defense-in-depth per `src/cron-registration.ts:21-31` JSDoc.
- **`logger.info({ ... }, 'chris.<channel>.<event>')` log key shape** — matches existing convention; GEN-06 names `chris.profile.threshold.below_minimum` verbatim.
- **`Promise.allSettled` discriminated outcomes** — handle both `'fulfilled'` and `'rejected'` results; rejected → log + return `'profile_generation_failed'`; fulfilled → already a discriminated outcome from the generator.

</code_context>

<test_strategy>
## Test Strategy

Five layers ship across the 3 plans (no live Sonnet calls — that's Phase 36 PTEST-05):

1. **Structural test (Plan 34-01)** — `src/memory/__tests__/profile-prompt.test.ts`: parametrized over all 4 dimensions; asserts CONSTITUTIONAL_PREAMBLE first, DO_NOT_INFER_DIRECTIVE present, volume-weight ceiling phrasing present, previous-state injection on non-null prevState. Pure-function test, no DB, no mocks.

2. **Mocked-SDK unit tests (Plan 34-02)** — per-generator: substrate loader returns expected shape (real DB integration); threshold check short-circuits at <10 entries (no Sonnet call asserted via mock); substrate-hash skip on identical input; volume-weight ceiling refine triggers on inflated `data_consistency` against low `entryCount`.

3. **Two-cycle integration test (Plan 34-02, HARD CO-LOC #M10-3)** — Real Docker Postgres + mocked Anthropic. Cycle 1 populates from seed (4 Sonnet calls); Cycle 2 with identical substrate verifies hash idempotency (still 4 calls total, NOT 8) + `profile_history` row count unchanged; Cycle 3 with mutated substrate verifies an update happens (5+ calls).

4. **Sparse-fixture test (Plan 34-02)** — 5-Pensieve-entry DB → all 4 generators return `'profile_below_threshold'`, log `'chris.profile.threshold.below_minimum'`, no Sonnet calls, profile rows unchanged from seed.

5. **Cron + config + health integration (Plan 34-03)** — Existing `src/__tests__/cron-registration.test.ts` extended: `cron.schedule` spy receives `'0 22 * * 0'` + `proactiveTimezone`; `status.profileUpdate === 'registered'` after `registerCrons`; `runProfileUpdate` deps field wired through to `updateAllOperationalProfiles`. Existing `src/__tests__/config.test.ts` extended: invalid `profileUpdaterCron` env throws at load. Health endpoint test asserts `profile_cron_registered: true` after registration.

**Live tests are explicitly excluded** from Phase 34 per D-40 (cost discipline). PTEST-05's 3-of-3 atomic anti-hallucination test ships in Phase 36, dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`.

</test_strategy>

<plan_hints>
## Plan Structure Hint

Recommended plan split for Phase 34 (3 plans, matching the REQUIREMENTS GEN-01..07 traceability table at REQUIREMENTS.md:86-92):

- **Plan 34-01: Shared prompt builder + structural test (HARD CO-LOC #M10-2 anchor)** — `src/memory/profile-prompt.ts` exports `assembleProfilePrompt`, `DO_NOT_INFER_DIRECTIVE`, `PROFILE_PROMPT_SECTIONS` constants; structural test in `src/memory/__tests__/profile-prompt.test.ts` parametrized over all 4 dimensions. Satisfies GEN-04. **~4 tasks.** MUST ship first; gsd-plan-checker refuses 34-02 if 34-01 is incomplete.

- **Plan 34-02: Four dimension generators + substrate loader + substrate-hash + two-cycle test (HARD CO-LOC #M10-3 atomic)** — `src/memory/profiles/shared.ts` (`ProfileSubstrate` type, `loadProfileSubstrate`, `computeSubstrateHash`, optional `runProfileGenerator` helper); `src/memory/profiles/{jurisdictional,capital,health,family}.ts` (each: dimension config + generator function); two-cycle real-DB+mock-SDK integration test in `src/memory/profiles/__tests__/generators.test.ts`; sparse-fixture test in same file. Satisfies GEN-03, GEN-06, GEN-07. **~6 tasks.** gsd-plan-checker refuses if substrate-hash logic and two-cycle test are split across plans.

- **Plan 34-03: Orchestrator + cron + config + /health** — `src/memory/profile-updater.ts` (`updateAllOperationalProfiles` via `Promise.allSettled`); `src/config.ts` `profileUpdaterCron` field with validate-fail-fast; `src/cron-registration.ts` extension (`CronRegistrationStatus.profileUpdate`, `RegisterCronsDeps.runProfileUpdate`, new `cron.schedule` block); `src/index.ts` registerCrons deps wiring + `/health` response field; cron-registration + config + health integration tests. Satisfies GEN-01, GEN-02. **~4 tasks.**

**Total: 14 tasks across 3 plans.** Plan 34-02 is the largest and most novel; 34-01 is small and front-loaded to anchor M10-2; 34-03 is mechanical wiring once 34-02 ships.

**Open Questions for Phase 34 planner to confirm (research flags OQ-1, OQ-2 from SUMMARY.md):**
- **OQ-1 confirmation (substrate filter):** D-12+D-13 lock tag-only (FACT/RELATIONSHIP/INTENTION/EXPERIENCE). Planner verifies `src/pensieve/retrieve.ts` exposes a tag-filterable query before locking the helper API.
- **OQ-2 confirmation (confidence calibration prompt phrasing):** D-06 locks the hybrid model (Sonnet → `data_consistency`, host → `confidence`). Planner drafts the exact prompt phrasing in Plan 34-01 and validates it against an expected-output structural test (no live LLM in Phase 34).

</plan_hints>
