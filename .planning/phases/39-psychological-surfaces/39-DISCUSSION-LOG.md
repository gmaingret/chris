# Phase 39: Psychological Surfaces — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 39-CONTEXT.md.

**Date:** 2026-05-14
**Phase:** 39-psychological-surfaces
**Mode:** `--auto` (autonomous; recommended-default selected for every gray area)
**Areas discussed:** Plan split, injection-map structure, formatter return shape, Hard Rule footer reuse, ChrisContextExtras field placement, mode-handler wiring order, COACH negative-invariant test, display formatter signature, golden snapshot fixtures, FR/RU localization

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 2 plans (prompt-side + display-side) | Phase 35 needed 3 plans because of buildSystemPrompt refactor (35-01 HARD CO-LOC #M10-4). Phase 39 doesn't need that — refactor already shipped. | ✓ |
| 3 plans (mirror Phase 35 exactly) | Inject map | mode wiring | /profile + display | |
| 1 plan (everything atomic) | Simplest blast radius; biggest plan | |

**Selected:** 2 plans.
**Rationale:** ChrisContextExtras + buildSystemPrompt already accept `extras` from Phase 35 — only the interface extension is needed, not a refactor. Plan 39-01 covers prompt-side (map + formatter + ChrisContextExtras field + REFLECT/PSYCHOLOGY wiring + COACH negative test). Plan 39-02 covers display-side (HARD CO-LOC #M11-3 atomic: display formatter + golden snapshot).

---

## Injection-map structure — distinct vs merged

| Option | Description | Selected |
|--------|-------------|----------|
| DISTINCT constant from operational PROFILE_INJECTION_MAP | REQUIREMENTS PSURF-01 verbatim; preserves nominal type-safety (Dimension[] vs PsychologicalProfileType[]) | ✓ |
| Single merged map with union types | One source of truth; loses type narrowing | |
| Per-mode object with both subsets nested | Maximum encapsulation; harder to grep | |

**Selected:** DISTINCT constant.
**Rationale:** LOCKED by REQUIREMENTS PSURF-01. Merging would force a union value type and lose compile-time mode→profile-type narrowing.

---

## Formatter return shape

| Option | Description | Selected |
|--------|-------------|----------|
| Empty string OR fully-rendered block (no partial) | Cleaner semantic boundary; downstream sees either "inject" or "skip" | ✓ |
| Always-rendered with per-dim "insufficient data" placeholders | Maximum information density in prompt | |
| Empty string with explicit reason code | More observability; overcomplicates the API | |

**Selected:** Empty string OR fully-rendered.
**Rationale:** Mirrors operational `formatProfilesForPrompt` pattern (M010 D-12). Partial rendering would inject "insufficient data" markers that themselves become D027 attack surfaces ("Sonnet, you may not know Greg's openness yet, but you do know..."). Cleaner to omit entirely until threshold.

---

## Hard Rule footer — reuse vs redeclare

| Option | Description | Selected |
|--------|-------------|----------|
| Import `PSYCHOLOGICAL_HARD_RULE_EXTENSION` from Phase 38's psychological-profile-prompt.ts:144 | Single source of truth; future edits land in one place | ✓ |
| Redeclare verbatim in formatter | Decouples surface from prompt builder | |
| Reference by name only ("see Hard Rule extension") | Forces Sonnet to look elsewhere — defeats the purpose | |

**Selected:** Import from Phase 38.
**Rationale:** D027 mitigation depends on EXACT phrasing. Two copies risk drift; one is canonical. The constant is appropriately scoped to psych domain (not personality.ts) — both Phase 38 prompt and Phase 39 surface need the same enforcement language.

---

## ChrisContextExtras field placement

| Option | Description | Selected |
|--------|-------------|----------|
| `psychologicalProfiles?: string` sibling to `operationalProfiles?: string` | Pre-rendered string; keeps personality.ts ignorant of profile internals | ✓ |
| `psychologicalProfiles?: PsychologicalProfiles` structured object | Type safety; pushes rendering into personality.ts | |
| Composite `profiles?: { operational, psychological }` nested object | One field for both; cleaner interface | |

**Selected:** Pre-rendered string sibling.
**Rationale:** Mirrors operational pattern (Phase 35 D-04). Personality.ts is single-responsibility (renders the prompt; doesn't compute injection scope or Hard Rule framing). The formatter functions in profiles.ts own the rendering logic.

---

## Mode-handler reader concurrency

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential `await getOperationalProfiles(); await getPsychologicalProfiles();` | Simpler code; latency ~50ms total | ✓ |
| `Promise.all([getOperationalProfiles(), getPsychologicalProfiles()])` | Saves ~25ms wall-clock | |

**Selected:** Sequential.
**Rationale:** Both readers query single-row sentinel rows by `name='primary'` — query latency is <25ms each. Parallel saves <25ms wall-clock but adds Promise.all error-handling nuance. Defer optimization to v2.6.1 if profiling reveals real latency.

---

## COACH negative-invariant test placement

| Option | Description | Selected |
|--------|-------------|----------|
| `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` | Handler-adjacent — closer to the file under guard | ✓ |
| Extend existing `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (Phase 37) | Single boundary-audit surface; one regex sweep | |
| Inline in `coach.ts` handler test | Maximum locality but couples test concerns | |

**Selected:** Handler-adjacent new test file.
**Rationale:** The boundary-audit test (Phase 37 PSCH-10) targets vocabulary leakage between profile namespaces. The COACH isolation test (Phase 39 PSURF-05) targets a different invariant — mode-handler ownership of D027. Two distinct semantic concerns → two distinct test files.

---

## Display formatter signature

| Option | Description | Selected |
|--------|-------------|----------|
| `formatPsychologicalProfileForDisplay(profileType, profile, lang)` — pure function per profile section | Mirrors M010 `formatProfileForDisplay(dim, profile, lang)`; composable | ✓ |
| `formatAllPsychologicalProfiles(profiles, lang)` — renders all 3 sections at once | Single call site; harder to reuse | |
| Class-based renderer with method per profile type | Object-oriented; overengineered for 3 sections | |

**Selected:** Pure function per profile section.
**Rationale:** Mirrors M010 SURF-04 exactly. `/profile` command iterates over the 3 profile types and calls the formatter 3 times. Golden snapshot can target each section independently.

---

## Golden snapshot fixtures

| Option | Description | Selected |
|--------|-------------|----------|
| 4 scenarios (populated / all-insufficient / mixed / FR+RU slots) | REQUIREMENTS PSURF-05 verbatim | ✓ |
| 3 scenarios (drop the FR+RU explicit slots; rely on EN-only initially) | Simpler test surface; defers localization to v2.6.1 | |
| 6+ scenarios (each profile-type populated/insufficient × each lang) | Maximum coverage; snapshot churn risk | |

**Selected:** 4 scenarios.
**Rationale:** LOCKED by REQUIREMENTS PSURF-05. The FR+RU slots are reserved for future localization without snapshot churn — locking the structure now means real translations can ship without rewriting tests.

---

## FR + RU localization strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder strings matching EN structure (likely machine-translation-quality initial release) | Slot reserved; structure locked; v2.6.1 polish | ✓ |
| Block FR/RU until proper translations land | Cleaner from launch but blocks Greg's RU/FR use | |
| Render only EN if `lang !== 'en'` | Degraded experience but no incorrect translations | |

**Selected:** Placeholder strings.
**Rationale:** PSURF-05 verbatim says "FR + RU language hook slots reserved (deferred wiring; structure must accommodate without snapshot churn)." Placeholder copy preserves the user-facing flow without committing to translation fidelity until v2.6.1 dedicated localization pass.

---

## Claude's Discretion

Listed in 39-CONTEXT.md `<decisions>` — planner-flex items:
- `runPsychologicalSection` helper extraction vs inline `for` loop over 3 profile types
- Localization string placement (inline vs centralized table)
- COACH-isolation test file location (recommend handler-adjacent)
- Prompt-template substitution order sanity test (belt-and-suspenders for D-11)
- Qualifier mapping const tuple vs switch (D-07)
- Comment near Hard Rule footer explaining recency-bias rationale

## Deferred Ideas

Captured in 39-CONTEXT.md `<deferred>`:
- Real FR + RU translations (v2.6.1 / M014)
- Schwartz circumplex-ordered display (CIRC-01 — v2.6.1 / M014)
- Trait change-detection alerts (CONS-02 — v2.6.1)
- Attachment activation orchestration (D028 / ATT-POP-01 — v2.6.1 / M013)
- "This profile is injected into REFLECT/PSYCHOLOGY" disclosure text (Claude's-discretion)
- Promise.all parallelism for reader calls (revisit if profiling shows latency)
- HEXACO × Schwartz cross-validation (CROSS-VAL-01 — v2.6.1)
- Narrative summary of psychological profile (M014 only per ANTI-features)
