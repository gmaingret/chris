# Research Summary — M010 Operational Profiles

**Project:** Chris — M010 Operational Profiles
**Domain:** Profile inference + persistence layer on top of Pensieve/episodic/ritual substrate
**Researched:** 2026-05-11
**Confidence:** HIGH (all four research files grounded in direct codebase inspection; no speculative web sources)

---

## Executive Summary

M010 builds the first layer of persistent situational context for Chris: four operational profile tables (jurisdictional, capital, health, family) that accumulate weekly from Greg's Pensieve entries and episodic summaries, then inject as grounded context into the REFLECT, COACH, and PSYCHOLOGY mode handlers. The milestone solves a concrete correctness problem: without profiles, Chris treats Greg as a blank slate in every conversation and may give anachronistic advice (recommending French tax strategy months after Greg relocated to Georgia). Profiles are not narrative summaries — they are typed structured data inferred from observable facts, gated on a 10-entry minimum threshold, and rated with a confidence score so mode handlers know how much to trust the context they receive.

The recommended implementation composes entirely from patterns established in M006–M009. No new dependencies. Five new source files plus one migration. The four generators run via `Promise.allSettled` (parallel, error-isolated) on a 4th cron firing Sunday 22:00 Paris — two hours after the weekly_review (M009, Sunday 20:00) to avoid Anthropic rate-limit collisions under retry conditions. Each generator does full regeneration from substrate on every fire (no delta updates), using the v3/v4 dual-Zod/Sonnet structured-output pattern established in `src/episodic/consolidate.ts` and `src/rituals/weekly-review.ts`. The `buildSystemPrompt` signature is refactored in Phase 35 to accept a named `extras: ChrisContextExtras` object folding in `language`, `declinedTopics`, and new `operationalProfiles` field — this is a one-time breaking change that must be atomic across all call sites.

The primary risks are: (1) Sonnet inflating confidence scores when data is sparse — mitigated by a volume-weight ceiling formula enforced at Zod parse time; (2) hallucinated profile facts — mitigated by per-field source-citation requirements in the output schema and a shared `DO_NOT_INFER_DIRECTIVE` in the prompt builder; (3) second-fire regression (the M009 `lt/lte` class of bug) — mitigated by two-cycle synthetic fixture tests and a substrate-hash idempotency guard. Every pitfall identified in PITFALLS.md has a concrete mitigation assigned to a specific phase, and seven of eleven pitfalls require schema-phase artifacts that cannot be retrofitted (history table, schema_version, substrate_hash). These must land in the initial migration.

---

## Key Findings

### Recommended Stack

No new direct dependencies. No version bumps. M010 composes entirely from installed packages at their current versions: `drizzle-orm` 0.45.2 (`jsonb().$type<T>()` is already present), `@anthropic-ai/sdk` ^0.90.0 (`messages.parse` + `zodOutputFormat`), `zod` ^3.24.0 + `zod/v4` sub-path (dual-schema pattern already established), `grammy` ^1.31.0 (`bot.command()` + `ctx.reply()`), `node-cron` ^4.2.1 (4th cron peer alongside episodic cron), `luxon` ^3.7.2 (existing cron timezone patterns).

The one pattern that is new to the codebase is `jsonb().$type<T>()` — used to give TypeScript compile-time type safety on profile-specific JSONB columns. This is already supported in the installed Drizzle version. Every other pattern (singleton upsert via `onConflictDoUpdate`, sequential multi-schema structured output, v3/v4 dual validation, plain-text command handler) has a named precedent in M008/M009 code.

**Core technologies:**
- `drizzle-orm` 0.45.2: four profile tables with typed JSONB columns — `jsonb().$type<T>()` pattern, singleton upsert on fixed sentinel `name='primary'`
- `@anthropic-ai/sdk` ^0.90.0: one Sonnet structured-output call per profile generator using `messages.parse({ output_config: { format: zodOutputFormat(v4Schema) } })`
- `zod` ^3.24.0 + `zod/v4`: four v3/v4 schema pairs (one per profile), each including a `data_consistency: z.number().min(0).max(1)` field for confidence calibration
- `node-cron` ^4.2.1: 4th cron in `registerCrons`, Sunday 22:00 Paris, same `{timezone: proactiveTimezone}` pattern as existing crons
- `grammy` ^1.31.0: `/profile` command handler, plain-text output only (D-31 policy), same `bot.command(..., handler as any)` registration pattern

**Anti-recommendations (confirmed by research):** No `Promise.all` (use `Promise.allSettled` for error isolation); no streaming (background cron, no real-time UX); no delta updates (full regen only); no `parse_mode` on `/profile` (user-origin content, D-31 policy); no ritual subsystem routing (wrong semantics for a silent data pipeline); SATURATION constant first-estimate is 50 — tune post-ship against real data, not a blocker.

### Expected Features

All 12 table-stakes features are P1 for M010. The complex items with most implementation risk are TS-3 (weekly profile update cron — 4 Sonnet prompts, structured output parsing, merge logic, confidence calculation) and TS-9 (30-day synthetic fixture — must cover all 4 dimensions with domain-biased entries).

**Must have (table stakes) — M010:**
- TS-1: Four Drizzle profile tables with migration (also: `profile_history`, `schema_version`, `substrate_hash` columns — cannot be retrofitted)
- TS-2: `getOperationalProfiles()` in `src/memory/profiles.ts` — never-throw, confidence-gated reader
- TS-3: Weekly cron — 4 focused Sonnet prompts via `Promise.allSettled`, full regen, upsert
- TS-4: 10-entry minimum threshold enforcement (below threshold: row exists, confidence=0, fields="insufficient data")
- TS-5: Confidence score per profile (volume-weight ceiling × Sonnet-reported `data_consistency`)
- TS-6: REFLECT, COACH, PSYCHOLOGY system prompt injection via `extras.operationalProfiles` in refactored `buildSystemPrompt`
- TS-7: `/profile` Telegram command — plain-text, 4 separate `ctx.reply()` calls, second-person formatting
- TS-8: Below-threshold "insufficient data" + progress indicator
- TS-9: `m010-30days` primed fixture — 30+ days, domain-biased entries, HARN sanity gate (>= 12 entries per dimension)
- TS-10: `m010-5days` sparse fixture — all 4 profiles at confidence=0
- TS-11: D035 boundary — profiles module never reads episodic_summaries directly into narrative fields
- TS-12: Never-throw contract on `getOperationalProfiles()`

**Ground-truth seeding:** `src/pensieve/ground-truth.ts` contains 13 facts that are effectively jurisdictional + capital profile data. M010 seeds initial profile rows from these at migration time → day-1 confidence 0.2–0.3 for known facts instead of "insufficient data" everywhere.

**Should have (v2.5.1 after empirical validation):**
- DIFF-2: Auto-detection of profile-change moments
- DIFF-4: Per-profile narrative summary
- DIFF-5: Profile consistency checker
- DIFF-6: Wellbeing-anchored health profile updates

**Defer to M013+:** DIFF-1 (multi-profile cross-reference reasoning), DIFF-3 (time-series history), DIFF-7 (per-field confidence granularity)

**Explicit anti-features (never build):** ANTI-1 (predictive forecasting), ANTI-4 (real-time profile update on every message), ANTI-6 (profile editing via Telegram commands)

### Architecture Approach

The profile layer has two independent code paths: a weekly write path (cron → orchestrator → 4 generators → DB upsert) and a read path (mode handler or `/profile` command → `getOperationalProfiles()` → `formatProfilesForPrompt()` → system prompt injection). These paths share only the reader module and the DB tables. The write path has no user-visible surface; the read path has no write capability.

**STACK vs ARCHITECTURE conflict — execution model:** STACK.md recommends sequential `await` loop; ARCHITECTURE.md recommends `Promise.allSettled`. **Resolution: `Promise.allSettled` wins.** 4 independent profile types, no data dependency between them, error isolation per profile, 4× wall-clock improvement (15s vs 60s). The 200 RPM Anthropic rate limit is not a constraint at 4 calls/week.

**Major components:**
1. **Cron registration** (`src/cron-registration.ts`): 4th cron, Sunday 22:00 Paris — fire-and-forget, try/catch, logs error, never throws
2. **Profile orchestrator** (`src/memory/profile-updater.ts`): `updateAllOperationalProfiles()` via `Promise.allSettled`, discriminated outcome logging per profile
3. **Shared substrate reader** (`src/memory/profiles/shared.ts`): `loadProfileSubstrate()` — reads pensieve_entries (tag-filtered: FACT/RELATIONSHIP/INTENTION/EXPERIENCE), `getEpisodicSummariesRange()`, and decisions (resolved, domain-tagged, last 60 days); enforces 10-entry threshold
4. **Four profile generators** (`src/memory/profiles/{jurisdictional,capital,health,family}.ts`): each owns its Zod v3+v4 schema pair, Sonnet system prompt, upsert logic; all assembled via shared `assembleProfilePrompt()` builder (M010-06 mandate)
5. **Reader API** (`src/memory/profiles.ts`): `getOperationalProfiles()` with confidence gating (null for missing rows or confidence=0); `formatProfilesForPrompt()` for mode handlers; `PROFILE_INJECTION_MAP` named constant
6. **Bot command handler** (`src/bot/handlers/profile.ts`): `/profile` plain-text display, EN/FR/RU localized, second-person formatting, golden-output snapshot test
7. **`buildSystemPrompt` refactor** (`src/chris/personality.ts`): `extras: ChrisContextExtras` named object replaces positional `language` + `declinedTopics` + adds `operationalProfiles?`; atomic change across all call sites in Phase 35

**Per-mode profile injection mapping (PROFILE_INJECTION_MAP):**
- REFLECT: all 4 profiles
- COACH: capital + family only (topic-drift risk if health injected)
- PSYCHOLOGY: health + jurisdictional only
- JOURNAL, INTERROGATE, PRODUCE, ACCOUNTABILITY: no profile injection

**Confidence formula (`src/memory/confidence.ts`):**
```
if (entryCount < 10) → confidence = 0
volumeScore = min(1.0, (entryCount - 10) / (SATURATION - 10))   // SATURATION = 50
confidence = round((0.3 + 0.7 × volumeScore × consistencyFactor) × 100) / 100
```
`consistencyFactor` is the `data_consistency` field Sonnet self-reports in each structured output. Volume ceiling enforced at Zod parse time: `confidence > 0.5` when `entryCount < 20` triggers Zod refinement failure → retry loop.

### Critical Pitfalls

**All 11 pitfalls from PITFALLS.md are load-bearing. Seven require schema-phase artifacts that cannot be retrofitted.**

1. **M010-01 — Confidence inflation** (Phase 33/34): Volume-weight ceiling in Zod output schema — `confidence > 0.5` when `entryCount < 20` fails Zod `.refine()` and triggers retry loop.

2. **M010-02 — Hallucinated profile facts** (Phase 34): Per-field `sources: uuid[]` (min 2) in Sonnet output schema. Shared `DO_NOT_INFER_DIRECTIVE` constant in `assembleProfilePrompt()` builder. Optional Haiku post-check.

3. **M010-03 — Profile drift without history** (Phase 33+34): `profile_history` table in initial migration. Previous profile row injected as "CURRENT PROFILE STATE" in weekly Sonnet prompt. High-confidence field change requires 3+ supporting substrate entries.

4. **M010-04 — Weekly cron timing collision** (Phase 34): Cron at Sunday 22:00 Paris (NOT 21:00 from spec default) — 2h gap after weekly_review. Rationale documented in migration SQL comment.

5. **M010-05 — Synthetic fixture dimension coverage gap** (Phase 36): `synthesize-delta.ts --profile-bias` flag. HARN sanity gate: >= 12 entries per profile dimension before any profile update test runs.

6. **M010-06 — Four-prompt drift** (Phase 34): `assembleProfilePrompt()` shared builder is the first artifact written in the prompt phase. Structural test verifies CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE in all 4 dimension outputs.

7. **M010-07 — /profile internal field leak** (Phase 35): `formatProfileForDisplay()` with golden-output snapshot test ships in same plan as `/profile` handler. Second-person framing mandatory.

8. **M010-08 — Mode handler context injection scope** (Phase 35): PROFILE_INJECTION_MAP named constant. Health profile only when `confidence >= 0.5`. Staleness qualifier when `last_updated > 21 days ago`.

9. **M010-09 — Double-update idempotency** (Phase 33+34): `substrate_hash` column in all profile tables (initial migration). Skip LLM call if hash unchanged.

10. **M010-10 — First-fire celebration blindness** (Phase 36): Two-cycle synthetic fixture test. Cycle 2 previous-state injection verified via mock SDK boundary assertion. Direct M009 `lt/lte` lesson applied to M010.

11. **M010-11 — JSONB schema evolution failure** (Phase 33): `schema_version INT NOT NULL DEFAULT 1` in all profile tables (initial migration). Schema registry in `getOperationalProfiles()`. Unsupported version returns null, does not throw.

---

## Implications for Roadmap

Continuing from M009's Phase 32. Phases are numbered 33–36.

### Phase 33 — Substrate (Schema + Types + Reader API Stub)

**Rationale:** Seven pitfall mitigations require schema-phase artifacts that cannot be retrofitted. Phase 33 ships zero LLM calls and zero user-visible features — it is foundation-only but it gates everything else.

**Delivers:**
- Migration 0012 (hand-authored SQL): `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family` — each with `id uuid pk`, `name text UNIQUE DEFAULT 'primary'` (ON CONFLICT sentinel), `confidence real CHECK (>= 0 AND <= 1)`, `last_updated timestamptz`, `substrate_hash text`, `schema_version int NOT NULL DEFAULT 1`, profile-specific JSONB columns
- `profile_history` table in same migration
- Drizzle meta snapshot regeneration + `scripts/test.sh` psql apply line for migration 0012
- `src/memory/profiles/shared.ts`: `ProfileSubstrate` type, `loadProfileSubstrate()`, `MIN_ENTRIES_THRESHOLD = 10`
- `src/memory/confidence.ts`: `computeProfileConfidence()`, `isAboveThreshold()`, `SATURATION = 50`
- `src/memory/profiles.ts`: `getOperationalProfiles()` all-null stubs; `OperationalProfiles` interface; `PROFILE_INJECTION_MAP` named constant; `formatProfilesForPrompt()` stub
- Zod v3+v4 schema pairs in each generator file (schemas only, no generator logic)
- Unit tests: migration applies cleanly; `getOperationalProfiles()` returns all-null when no rows; schemas reject invalid shapes; `schema_version: 999` → null; confidence formula pure-function tests

**Addresses:** TS-1, TS-2 (stub), TS-4, TS-5, TS-12
**Avoids:** M010-01, M010-03, M010-09, M010-11
**Hard co-location:** migration SQL + drizzle meta snapshot + `scripts/test.sh` psql line in one atomic plan (D034 precedent)
**Research flag:** Standard Drizzle patterns — no phase research needed.

---

### Phase 34 — Profile Generators + Orchestrator + Cron

**Rationale:** Core inference engine. Highest-complexity phase. `assembleProfilePrompt()` shared builder must be the first artifact written (M010-06 mandate). Depends on Phase 33; Phase 35 depends on this.

**Delivers:**
- `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` shared builder: injects CONSTITUTIONAL_PREAMBLE, DO_NOT_INFER_DIRECTIVE, volume-weight ceiling formula, previous-state section, dimension-specific substrate + schema
- Dimension-specific config objects (JURISDICTIONAL_PROFILE_CONFIG, CAPITAL_PROFILE_CONFIG, HEALTH_PROFILE_CONFIG, FAMILY_PROFILE_CONFIG)
- Full generator implementations for all 4 profiles: Sonnet call, Zod v4 parse, Zod v3 re-validate, substrate-hash check (skip if unchanged), upsert via `name='primary'` sentinel, write to `profile_history` before upsert
- `src/memory/profile-updater.ts`: `updateAllOperationalProfiles()` via `Promise.allSettled`; discriminated outcome logging
- Cron registration: 4th cron, Sunday 22:00 Paris (`'0 22 * * 0'`), `{timezone: proactiveTimezone}`; `CronRegistrationStatus.profileUpdate`; `src/config.ts` `profileUpdateCron` field
- Ground-truth seeding: initial profile rows from `src/pensieve/ground-truth.ts` → day-1 confidence 0.2–0.3 for known facts
- Integration tests (two-cycle): Cycle 1 (populate from empty); Cycle 2 (`vi.setSystemTime` +7 days, update, assert previous-state injection non-null in mock SDK boundary assertion, assert `profile_history` has 2 rows per dimension)
- Structural test: `assembleProfilePrompt` output contains CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE for all 4 dimensions

**Addresses:** TS-3, TS-4, TS-5, TS-8
**Avoids:** M010-02, M010-04, M010-06, M010-09, M010-10
**OQ-1 (resolve in planning):** Pensieve domain-filtering strategy — recommended starting point: tag-only filter (FACT/RELATIONSHIP/INTENTION/EXPERIENCE), no keyword/semantic filtering; upgrade to keyword lists only if fixture tests show contamination.
**OQ-2 (resolve in planning):** Confidence calibration Sonnet prompt phrasing — draft during Phase 34 planning, lock as HARD CO-LOC in generator files.
**Research flag:** Phase-level research recommended for OQ-1 and OQ-2.

---

### Phase 35 — Bot Command + Mode Handler Wiring

**Rationale:** User-visible phase. Depends on Phase 33 (reader API) and Phase 34 (populated rows needed for non-null rendering test). The `buildSystemPrompt` refactor is a breaking change — call-site inventory (OQ-3) must be complete before any code is written.

**Delivers:**
- `src/bot/handlers/profile.ts`: `handleProfileCommand()` — 4 × `ctx.reply()` plain-text, EN/FR/RU localized, second-person framing, staleness qualifier (`last_updated > 21 days`), M011 placeholder section
- `formatProfileForDisplay()` with golden-output snapshot test on fixed `MOCK_PROFILES` fixture
- `src/bot/bot.ts` edit: register `/profile` handler
- `src/memory/profiles.ts` completion: full `formatProfilesForPrompt()` (empty string when all 4 null → mode handlers skip injection)
- `src/chris/personality.ts` refactor: `buildSystemPrompt(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)` — `language` + `declinedTopics` folded into `extras`, `operationalProfiles?` added; ACCOUNTABILITY overload preserved exactly
- Mode handler edits (`reflect.ts`, `coach.ts`, `psychology.ts`): call `getOperationalProfiles()` + `formatProfilesForPrompt()` before `buildSystemPrompt()`; use PROFILE_INJECTION_MAP
- Regression tests: all existing mode-handler and engine tests pass with refactored signature

**Addresses:** TS-6, TS-7, TS-8, TS-11
**Avoids:** M010-07, M010-08
**OQ-3 (pre-work, not research):** Grep `src/` for `buildSystemPrompt` calls; enumerate all call sites; document ACCOUNTABILITY overload explicitly before writing any Phase 35 code.
**Research flag:** No external research needed — internal call-site inventory is the prerequisite.

---

### Phase 36 — Synthetic Fixture Test + Live Integration

**Rationale:** Cannot start until Phase 34 (generators) and Phase 35 (mode wiring) are complete. Dedicated phase following M009's HARD CO-LOCATION #4 precedent — fixture generation and fixture testing are separate concerns.

**Delivers:**
- `scripts/synthesize-delta.ts` extension: `--profile-bias <profile-name>` flag — appends domain keyword hint to daily Haiku style-transfer prompt
- `m010-30days` primed fixture: generated, HARN sanity gate (>= 12 entries per profile dimension), committed as VCR-cached artifact
- `m010-5days` primed fixture: generated, all 4 profiles at confidence=0, committed
- Fixture tests (real-DB integration against Docker Postgres):
  - `m010-30days` → all 4 profiles populate with non-zero calibrated confidence
  - `m010-5days` → all 4 profiles at confidence=0
  - Two-cycle test on `m010-30days`: Cycle 1 (populate from empty) + Cycle 2 (`vi.setSystemTime` +7 days, previous-state injection verified, `profile_history` has 2 rows per dimension)
  - Substrate-hash skip: second Cycle 2 fire with unchanged substrate → no LLM calls
- Live integration test (API-gated, 3-of-3): REFLECT-mode message with `m010-30days` fixture; assert system prompt contains `## Operational Profile` block; assert Sonnet does not hallucinate facts outside profile context
- `boundary-audit.test.ts` extension for TS-11 if needed

**Addresses:** TS-9, TS-10, TS-11
**Avoids:** M010-05, M010-10
**OQ-4 (resolve in planning):** `synthesize-delta.ts --profile-bias` threshold determinism — validate that biased entries cross 10-entry threshold per dimension deterministically in 30-day window.
**Research flag:** Phase-level research recommended for OQ-4 (bias mechanism design and threshold validation).

---

### Phase Ordering Rationale

- Phase 33 before everything: 7 of 11 pitfall mitigations require schema-phase artifacts; retrofitting them adds migration complexity and deployment risk.
- Phase 34 before Phase 35: mode handlers need at least one populated row to test non-null rendering; `buildSystemPrompt` refactor should not happen until the profile data it injects exists.
- Phase 35 before Phase 36: live integration test requires mode wiring to be complete to assert system prompt injection.
- Phase 36 last: dedicated fixture-and-test phase; cannot start until generators and mode wiring exist to validate against.
- Sunday 22:00 cron (not 21:00): 2-hour gap after weekly_review at 20:00 gives full retry-window buffer under worst-case adversarial conditions (M009 weekly_review max retries: ~120s).

---

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 34 (OQ-1):** Pensieve domain-filtering strategy for `loadProfileSubstrate()` — tag-only is recommended starting point; confirm during planning.
- **Phase 34 (OQ-2):** Confidence calibration Sonnet prompt phrasing — must be drafted and validated before locking.
- **Phase 36 (OQ-4):** `synthesize-delta.ts --profile-bias` threshold determinism — confirm 10-entry crossing per domain in 30 days.

**Phases with standard patterns (skip research-phase):**
- **Phase 33:** Pure Drizzle DDL + schema registry. Fully established patterns.
- **Phase 35 (OQ-3):** Call-site inventory is a codebase grep, not external research.

---

## Conflict Resolution Log

| Conflict | STACK says | ARCHITECTURE says | Resolution |
|----------|------------|-------------------|------------|
| Execution model | Sequential `await` loop | `Promise.allSettled` parallel | `Promise.allSettled` wins — error isolation is stronger argument; 4 calls/week nowhere near rate limit |
| Cron time | Sunday 21:00 Paris (spec default) | Sunday 22:00 Paris (2h gap) | 22:00 wins — M010-04 timing collision risk documented |
| `confidence` field origin | Host code computes entirely | Sonnet emits `confidence` in output | Hybrid: Sonnet emits `data_consistency`; host computes final via `computeProfileConfidence(entryCount, data_consistency)` |
| `profile_history` table scope | FEATURES DIFF-3: defer to M013 | PITFALLS/ARCH: must be in initial migration | PITFALLS wins — internal write-before-upsert snapshot is not the DIFF-3 user-facing history feature; the DIFF-3 deferral applies to the read interface, not the internal table |

---

## Pitfall-to-Phase Ownership Map

| Pitfall | Phase Owns Mitigation |
|---------|-----------------------|
| M010-01: Confidence inflation (volume-weight ceiling in Zod) | Phase 33 (schema) + Phase 34 (Sonnet prompt) |
| M010-02: Hallucinated facts (source citation schema + DO_NOT_INFER) | Phase 34 |
| M010-03: Profile drift (profile_history table + prev-state injection) | Phase 33 (table) + Phase 34 (prompt) |
| M010-04: Cron timing collision (22:00 Paris, 2h gap, migration comment) | Phase 34 |
| M010-05: Fixture dimension coverage gap (--profile-bias + HARN gate) | Phase 36 |
| M010-06: Four-prompt drift (shared assembleProfilePrompt builder) | Phase 34 |
| M010-07: /profile field leak (formatProfileForDisplay + golden test) | Phase 35 |
| M010-08: Mode handler injection scope (PROFILE_INJECTION_MAP constant) | Phase 35 |
| M010-09: Double-update idempotency (substrate_hash + skip guard) | Phase 33 (column) + Phase 34 (skip logic) |
| M010-10: First-fire blindness (two-cycle test) | Phase 36 |
| M010-11: JSONB schema evolution (schema_version + reader registry) | Phase 33 |

---

## Never-Retrofit Checklist (Must Land in Phase 33)

- [ ] `profile_history` table in migration 0012
- [ ] `schema_version INT NOT NULL DEFAULT 1` in all 4 profile tables
- [ ] `substrate_hash TEXT` in all 4 profile tables
- [ ] `name TEXT NOT NULL UNIQUE DEFAULT 'primary'` sentinel in all 4 profile tables (ON CONFLICT target)
- [ ] `confidence REAL CHECK (confidence >= 0 AND confidence <= 1)` in all 4 profile tables
- [ ] Migration 0012 in `scripts/test.sh` psql apply chain
- [ ] Drizzle meta snapshot regenerated for migration 0012

---

## Open Questions

| ID | Question | Phase | Recommended Starting Point |
|----|----------|-------|---------------------------|
| OQ-1 | Pensieve domain-filtering strategy for `loadProfileSubstrate()` | Phase 34 | Tag-only (FACT/RELATIONSHIP/INTENTION/EXPERIENCE), no keyword/semantic filtering; let Sonnet ignore irrelevant entries |
| OQ-2 | Confidence calibration Sonnet prompt phrasing | Phase 34 | Draft in Phase 34 planning; validate on sparse vs rich fixtures in Phase 36; lock as HARD CO-LOC in generator files |
| OQ-3 | `buildSystemPrompt` call-site inventory | Phase 35 pre-work | Grep `src/` for `buildSystemPrompt` before writing any Phase 35 code; document ACCOUNTABILITY overload explicitly |
| OQ-4 | `synthesize-delta.ts --profile-bias` threshold determinism | Phase 36 | Validate 10-entry threshold crossing per domain deterministically in 30-day window before fixture generation begins |
| OQ-5 | SATURATION constant tuning | Post-ship | SATURATION = 50 is first estimate; tune after 4–8 weeks of production profile updates; not a blocker |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies installed at correct versions; all patterns have named M008/M009 precedents; no new dependencies |
| Features | HIGH (TS-1–TS-8, TS-11–TS-12); MEDIUM (TS-9–TS-10) | Table stakes clear; synthetic fixture design (TS-9) is MEDIUM because `--profile-bias` mechanism does not yet exist in `synthesize-delta.ts` |
| Architecture | HIGH | All component boundaries derived from direct codebase inspection; execution model conflict resolved |
| Pitfalls | HIGH | All 11 pitfalls grounded in M006–M009 production incidents or direct code inspection; recovery strategies documented for all |

**Overall confidence:** HIGH

### Gaps to Address

- OQ-1 (Phase 34 planning): Confirm tag-only filtering is sufficient before locking substrate reader
- OQ-2 (Phase 34 planning): Draft and validate confidence calibration prompt phrasing before shipping
- OQ-3 (Phase 35 pre-work): Complete `buildSystemPrompt` call-site grep before any Phase 35 code
- OQ-4 (Phase 36 planning): Validate `--profile-bias` threshold determinism before fixture generation
- OQ-5 (post-ship): Tune SATURATION constant against real production data

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)

- `src/rituals/weekly-review.ts` — authoritative pattern for v3/v4 dual-schema, sequential multi-schema Sonnet calls, DB-backed language detection, CONSTITUTIONAL_PREAMBLE, MAX_RETRIES retry loop
- `src/episodic/consolidate.ts` — v3/v4 dual-schema at SDK boundary, `zodOutputFormat()` cast, error-isolation contract
- `src/cron-registration.ts` — `registerCrons`, `CronRegistrationStatus`, `RegisterCronsDeps` interface pattern
- `src/chris/personality.ts` — `buildSystemPrompt` current signature (lines 89-95), ACCOUNTABILITY overload documentation (lines 79-87), CONSTITUTIONAL_PREAMBLE
- `src/proactive/state.ts` — `onConflictDoUpdate` singleton upsert precedent
- `src/bot/handlers/summary.ts` — D-31 plain-text policy, command handler structure, `as any` cast pattern
- `src/db/schema.ts` — existing table shapes, column types; confirmed `jsonb().$type<T>()` in drizzle-orm 0.45.2
- `src/pensieve/retrieve.ts` — `getEpisodicSummariesRange()` already exported
- `src/pensieve/ground-truth.ts` — 13 facts available for initial profile seeding
- `scripts/synthesize-delta.ts` — confirmed: no `--profile-bias` flag; OQ-4 is a real gap
- `.planning/PROJECT.md` — D029, D030, D034, D035, D041
- `package.json` — installed deps + versions verified 2026-05-11

### Secondary (MEDIUM confidence — production incidents + retrospectives)

- v2.4 RETROSPECTIVE.md — first-fire celebration blindness, DB-backed language detection lesson, third-person framing UX failure
- v2.4 M009 Phase 29 VERIFICATION.md — third-person framing incident (direct source for M010-07 formatter requirement)
- v2.4 MILESTONE-AUDIT.md — HARN floor patterns, successive-fire fix origin

### Tertiary (domain concept validation)

- EMA literature — validates 10-entry threshold reasoning; sparse data produces worse inference than no inference
- Clinical documentation patterns (SOAP notes) — source for health profile case-file model (open hypothesis / pending test / active treatment triad)

---

*Research completed: 2026-05-11*
*Ready for roadmap: yes*
*Legacy note: M010 spec uses "John" naming — all requirements and code use Greg.*
