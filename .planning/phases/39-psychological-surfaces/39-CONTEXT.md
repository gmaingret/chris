# Phase 39: Psychological Surfaces — Context

**Gathered:** 2026-05-14 (via `/gsd-discuss-phase 39 --auto`)
**Status:** Ready for planning
**Prior phases:** Phase 37 (Substrate) shipped 2026-05-13; Phase 38 (Inference Engine) shipped 2026-05-14. First M011 cron fire scheduled 2026-06-01 09:00 Paris.

<domain>
## Phase Boundary

Phase 39 ships the **user-facing surfaces** that consume Phase 37's reader (`getPsychologicalProfiles`) and Phase 38's populated rows. After this phase:

- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` exported from `src/memory/profiles.ts` — DISTINCT from `PROFILE_INJECTION_MAP` (operational); `REFLECT: ['hexaco', 'schwartz']`, `PSYCHOLOGY: ['hexaco', 'schwartz']`, **COACH: []** (explicit-absent; D027 Hard Rule violation risk)
- `formatPsychologicalProfilesForPrompt(map, profiles, mode)` exported from `src/memory/profiles.ts` — returns empty string when below threshold OR zero overall_confidence OR mode not in map; for populated profiles, renders per-dim score lines with explicit confidence framing AND appends the Hard Rule extension footer inline
- `ChrisContextExtras` interface in `src/chris/personality.ts` extended with optional `psychologicalProfiles?: string` field (sibling to existing `operationalProfiles?: string`)
- REFLECT + PSYCHOLOGY mode handlers in `src/chris/modes/{reflect,psychology}.ts` call `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt → buildSystemPrompt(..., extras with psychologicalProfiles)` alongside their existing operational-profile injection
- **COACH handler explicitly UNCHANGED** — no call to `getPsychologicalProfiles`; negative-invariant test asserts `src/chris/modes/coach.ts` contains zero `psychological` references
- JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY silently drop the `psychologicalProfiles` extra (mirrors current `operationalProfiles` behavior in `personality.ts`)
- `src/bot/handlers/profile.ts` `/profile` command extended — replaces `MSG.m011Placeholder` (line 627) with three new `ctx.reply` calls (HEXACO + Schwartz + Attachment sections)
- `formatPsychologicalProfileForDisplay(profile, lang)` pure function exported alongside existing `formatProfileForDisplay`
- Insufficient-data branch: `"HEXACO: insufficient data — need N more words"` where `N = max(0, 5000 - word_count)`
- Attachment section: `"Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)"`
- Golden-output inline-snapshot test in `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` covers four scenarios — all-populated, all-insufficient, mixed (HEXACO populated + Schwartz below-floor + Attachment deferred), and FR + RU language hook slots reserved

**Explicitly NOT in this phase** (Phase 40):
- `--psych-profile-bias` flag in `synthesize-delta.ts` — Phase 40 PMT-01
- Primed fixtures `m011-30days`, `m011-1000words` — Phase 40 PMT-02
- Sparse-threshold integration test — Phase 40 PMT-03
- Populated-fixture integration test — Phase 40 PMT-04
- Three-cycle unconditional-fire end-to-end fixture test — Phase 40 PMT-05 (Phase 38 covers contract-level)
- Live 3-of-3 anti-hallucination milestone gate — Phase 40 PMT-06

**Inter-phase coupling:**
- **Upstream (Phase 37):** `getPsychologicalProfiles()` reader + `PsychologicalProfiles` interface + `HexacoProfileData` / `SchwartzProfileData` / `AttachmentProfileData` types from `src/memory/profiles/psychological-schemas.ts`
- **Upstream (Phase 38):** populated rows from the monthly cron (post-2026-06-01 fire); not required for Phase 39 unit/golden tests (those use inline fixtures)
- **Upstream (Phase 35):** `ChrisContextExtras` interface already exists with `operationalProfiles?: string`; Phase 39 adds a sibling field. `buildSystemPrompt` signature already accepts `extras` — no refactor needed. M010 mode-handler injection wiring is the proven shape Phase 39 mirrors.
- **Downstream (Phase 40):** the `## Psychological Profile (inferred — low precision, never use as authority)` system-prompt block injected by REFLECT/PSYCHOLOGY is the surface PMT-06's live 3-of-3 anti-hallucination test asserts against. The `/profile` command output is the surface Greg uses for manual UAT.

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M011 research pass (`.planning/research/SUMMARY.md`, `PITFALLS.md` §1 — D027 sycophancy injection) + REQUIREMENTS PSURF-01..05 + the M010 Phase 35 precedent that shipped clean. The `--auto` flag locked each at the recommended option.

`[auto]` annotations record the gray area, the recommended option chosen, and the source.

### Plan split structure

- **D-01: Two plans matching REQUIREMENTS traceability + HARD CO-LOC #M11-3.** `[auto]` Plan structure — Q: "How to split Phase 39?" → Selected: "2 plans (cleaner-than-Phase-35 split — buildSystemPrompt refactor was Phase 35-01; that work doesn't repeat here)" (recommended).
  - **Plan 39-01: Prompt-side surface (PSURF-01, PSURF-02, PSURF-03)** — `src/memory/profiles.ts` adds `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` constant + `formatPsychologicalProfilesForPrompt(profiles, mode)` function with Hard Rule extension footer; `src/chris/personality.ts` extends `ChrisContextExtras` with `psychologicalProfiles?: string` field + extends the prompt-template substitution to inject `psychologicalProfiles` ABOVE `operationalProfiles` ABOVE `pensieveContext` for REFLECT + PSYCHOLOGY; REFLECT + PSYCHOLOGY mode handlers in `src/chris/modes/{reflect,psychology}.ts` add the `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt → buildSystemPrompt(..., psychologicalProfiles)` calls alongside the existing operational-profile wiring; COACH handler at `src/chris/modes/coach.ts` is NOT modified; negative-invariant test asserts COACH handler contains zero `psychological` token references; structural test asserts injection happens for REFLECT/PSYCHOLOGY and is absent for the other 6 modes (JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY/COACH). **~4 tasks.**
  - **Plan 39-02: Display-side surface (PSURF-04, PSURF-05) — HARD CO-LOC #M11-3 atomic** — `src/bot/handlers/profile.ts` extended: `formatPsychologicalProfileForDisplay(profileType, profile, lang)` pure function + `/profile` command extension replacing the `MSG.m011Placeholder` line at `src/bot/handlers/profile.ts:627`; the four new replies (HEXACO + Schwartz + Attachment + final wrap-up) handle populated / insufficient-data / Attachment-deferred branches; golden-output inline-snapshot test in `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` against four fixtures. **HARD CO-LOC #M11-3: display formatter + golden snapshot ship in the same plan.** **~4 tasks.**

- **D-02: Plan ordering is strict, not parallelizable.** 39-01 ships before 39-02 (39-02 may reference the injection-map state for the `/profile` command's "this profile is injected into REFLECT/PSYCHOLOGY" disclosure text if planner chooses to include it — minor coupling, but conceptually clean to order the prompt-side first). Same hard-sequencing discipline as Phase 35 (35-01 → 35-02 → 35-03).

### PSYCHOLOGICAL_PROFILE_INJECTION_MAP (Plan 39-01 / PSURF-01)

- **D-03: DISTINCT named constant from operational `PROFILE_INJECTION_MAP` — no merging.** Locked by REQUIREMENTS PSURF-01 verbatim. The two maps have different value types (`Dimension[]` for operational vs `PsychologicalProfileType[]` for psychological); merging would force a union type and lose nominal type-safety. `[auto]` Map structure — Q: "Single merged map or distinct constants?" → Selected: "Distinct constants" (recommended — REQUIREMENTS verbatim).
- **D-04: Map values locked by REQUIREMENTS PSURF-01:**
  ```typescript
  export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>> = {
    REFLECT: ['hexaco', 'schwartz'],
    PSYCHOLOGY: ['hexaco', 'schwartz'],
  } as const;
  ```
  COACH is explicitly absent (NOT a key in the map). JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY are also absent. The map's TypeScript type narrows acceptable mode names to `'REFLECT' | 'PSYCHOLOGY'` — passing any other mode to the formatter returns `""`. `'attachment'` is NOT in any mode's array (D-23 from Phase 38 — attachment generator deferred to v2.6.1, no data to inject in M011).
- **D-05: Formatter return shape: empty string OR fully-rendered block (no partial).** When ANY of these are true, `formatPsychologicalProfilesForPrompt` returns `""`:
  - `mode` not in `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (JOURNAL, INTERROGATE, PRODUCE, PHOTOS, ACCOUNTABILITY, COACH)
  - All profiles in the mode's array are `null` (Phase 37 reader returns null per profile on DB error)
  - All profiles in the mode's array have `overall_confidence === 0` (below-threshold from Phase 38 — first cron fire hasn't happened OR word count below 5000)
  - All profiles in the mode's array have `last_updated === null` (seed-row state from Phase 37)
- **D-06: Rendered block structure (per PITFALLS §1 — D027 mitigation):**
  ```
  ## Psychological Profile (inferred — low precision, never use as authority)

  HEXACO Openness: 4.2 / 5.0 (confidence 0.6 — moderate evidence across N words)
  HEXACO Conscientiousness: 4.5 / 5.0 (confidence 0.5 — moderate evidence across N words)
  …
  Schwartz Self-Direction: 4.2 / 5.0 (confidence 0.6 — moderate evidence)
  Schwartz Stimulation: 3.1 / 5.0 (confidence 0.4 — limited evidence)
  …

  CRITICAL CONSTRAINT: These scores describe statistical tendencies inferred from speech
  patterns, NOT facts about who Greg is. You MUST NOT:
  - Use these scores to tell Greg he is "the kind of person who..."
  - Appeal to his trait scores as evidence that his current reasoning is correct
  - Construct advice that validates his existing position by citing his personality
  The Hard Rule (D027) applies here with additional force: psychological traits are
  not evidence. Evaluate every claim on its merits regardless of what the profile says.
  ```
  The Hard Rule footer text is identical to `PSYCHOLOGICAL_HARD_RULE_EXTENSION` from Phase 38's `psychological-profile-prompt.ts:144` — the formatter MUST import this constant and append it inline, NOT redeclare. Single source of truth.
- **D-07: Per-dim confidence qualifier mapping (locked):**
  - `confidence < 0.3` → `"limited evidence"`
  - `0.3 <= confidence < 0.6` → `"moderate evidence"`
  - `confidence >= 0.6` → `"substantial evidence"`
  - This is informational text inside the prompt; Sonnet uses it to gauge how much weight to give the score. Implementation: inline `function qualifierFor(c: number): string` private to `formatPsychologicalProfilesForPrompt`.
- **D-08: Per-dim score format: `"<DIM> <Trait>: X.X / 5.0 (confidence Y.Y — <qualifier>)"`.** Score rendered to 1 decimal; confidence rendered to 1 decimal. Trait names use Title Case for HEXACO (Honesty-Humility, Emotionality, Extraversion, Agreeableness, Conscientiousness, Openness) and Title Case for Schwartz values (Self-Direction, Stimulation, Hedonism, Achievement, Power, Security, Conformity, Tradition, Benevolence, Universalism). Hyphenation preserved.
- **D-09: Skip individual dimensions with `null` score OR `confidence === 0`.** Don't render orphan "DIM Trait: insufficient data" lines inside the populated block. If ALL dims in a profile are null/zero-confidence, the entire profile is treated as below-threshold for injection purposes (skipped from the block). If SOME dims are populated and others null, render only the populated ones.

### ChrisContextExtras extension (Plan 39-01 / PSURF-03)

- **D-10: Add `psychologicalProfiles?: string` field to `ChrisContextExtras` interface in `src/chris/personality.ts`.** Sibling to existing `operationalProfiles?: string`. Optional — call sites that don't need it (JOURNAL, INTERROGATE, etc.) omit the field. Like `operationalProfiles`, the field is a PRE-RENDERED prompt-side string (NOT the structured `PsychologicalProfiles` object) — keeps `personality.ts` ignorant of profile internals.
- **D-11: Inject `psychologicalProfiles` ABOVE `operationalProfiles` ABOVE `pensieveContext`.** Order locked: psychological → operational → pensieve → relational. Rationale: psychological framing is the broadest "this is who Greg is" context; operational is the narrower "this is Greg's current state"; pensieve is the immediate-retrieval ground truth. The injection block should establish trait framing BEFORE the operational context interprets that framing. **Important:** the Hard Rule footer is appended at the BOTTOM of the psychological block (per D-06) so it lands closest to the operational + pensieve content — maximizes Sonnet's recency-bias attention on the constraint.
- **D-12: Prompt-template substitution logic in `personality.ts` is extended for the 4 modes that already render `operationalProfiles` (REFLECT, COACH, PSYCHOLOGY) — but `psychologicalProfiles` is injected ONLY for REFLECT + PSYCHOLOGY** (COACH receives the field but ignores it — silent drop, mirrors current `relationalContext`-on-JOURNAL behavior). The mode-handler is the gate (D-13) — `coach.ts` simply doesn't pass `psychologicalProfiles` in its `extras` call. As belt-and-suspenders, the template's conditional rendering can also gate on mode, but the primary gate is at the handler level.

### Mode-handler wiring (Plan 39-01 / PSURF-03)

- **D-13: REFLECT + PSYCHOLOGY handlers call `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt → buildSystemPrompt`.** Order of operations:
  1. `const profiles = await getOperationalProfiles();` (existing, unchanged)
  2. `const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT' | 'PSYCHOLOGY');` (existing, unchanged)
  3. **NEW:** `const psychProfiles = await getPsychologicalProfiles();`
  4. **NEW:** `const psychologicalProfiles = formatPsychologicalProfilesForPrompt(psychProfiles, 'REFLECT' | 'PSYCHOLOGY');`
  5. `buildSystemPrompt('REFLECT' | 'PSYCHOLOGY', pensieveContext, relationalContext, { language, declinedTopics, operationalProfiles, psychologicalProfiles });`
  - Both `getOperationalProfiles` and `getPsychologicalProfiles` are never-throw (Phase 33 + Phase 37) — handlers don't need additional try/catch.
- **D-14: COACH handler is NOT MODIFIED.** Negative-invariant test at `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` (or similar) asserts: `grep -c "psychological\|Psychological" src/chris/modes/coach.ts === 0`. This prevents future "let's also inject in COACH" changes that would re-introduce the D027 risk. Locked by REQUIREMENTS PSURF-05.
- **D-15: JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY handlers NOT MODIFIED.** Same negative-invariant assertion via a structural test that loops over all mode-handler files and asserts `getPsychologicalProfiles` is imported ONLY by `reflect.ts` and `psychology.ts`. Required by REQUIREMENTS PSURF-03 "verified by negative-invariant test."
- **D-16: Sequential `await` in handler (NOT `Promise.all`).** Each `getXxxProfiles()` call is independent but the wall-clock overhead is small (both reader-only DB queries against `name='primary'` sentinel rows — single-row reads). Sequential is simpler to read and reason about; the wall-clock cost is <50ms total. Defer `Promise.all` parallelism to v2.6.1 if profiling reveals real latency. `[auto]` Reader concurrency — Q: "Sequential or Promise.all for the two reader calls?" → Selected: "Sequential" (recommended; latency is negligible; simpler code).

### `/profile` command extension (Plan 39-02 / PSURF-04)

- **D-17: Replace `MSG.m011Placeholder` at `src/bot/handlers/profile.ts:627` with three NEW `ctx.reply` calls** — one for HEXACO, one for Schwartz, one for Attachment. Order in the message stream: jurisdictional → capital → health → family → **HEXACO → Schwartz → Attachment** (insert after the existing 4 operational replies; before the M010 wrap-up that was previously the placeholder). Each reply renders one profile via `formatPsychologicalProfileForDisplay(profileType, profile, lang)`.
- **D-18: Display-side profile loader uses `getPsychologicalProfiles()` (same as the prompt-side reader).** Phase 37's reader is never-throw — display gracefully handles `null` per-profile (renders "insufficient data" line per D-19). Same try/catch pattern as the existing `/profile` handler (lines 595-635 area).
- **D-19: Display branches per profile state:**
  - **Populated** (`overall_confidence > 0`, `last_updated !== null`): render section title + per-dim score lines (Title Case, score X.X/5.0, confidence Y.Y, qualifier per D-07)
  - **Insufficient data** (`overall_confidence === 0`, `word_count < 5000`): render `"HEXACO: insufficient data — need N more words"` where `N = max(0, 5000 - word_count)`. Use the second-person framing consistent with existing `/profile` text.
  - **Attachment-deferred** (special-case for `profile_attachment`): always render `"Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)"` regardless of `activated` flag — in M011 the flag is always `false` per Phase 37 D-14. When v2.6.1 ships the activation trigger, this branch updates to render populated data.
  - **Never-fired** (`last_updated === null`, after first cron fire never happened): render `"HEXACO: not yet inferred (first profile inference runs 1st of month, 09:00 Paris)"` — distinct from "insufficient data" because the user might have plenty of words but the cron hasn't fired yet.
- **D-20: Localization slots reserved for FR + RU.** Existing `MSG.*[lang]` pattern in `src/bot/handlers/profile.ts` covers EN/FR/RU. Phase 39 adds new `MSG.psychologicalSections` (or similar) with `{en, fr, ru}` fields, but the FR + RU strings can be placeholders matching the EN structure — per REQUIREMENTS PSURF-05 "FR + RU language hook slots reserved (deferred wiring; structure must accommodate without snapshot churn)." Planner picks placeholder strategy (recommend: machine-translate-quality EN copy for FR/RU initial release; a v2.6.1 cleanup pass localizes properly).

### Display formatter — pure function (Plan 39-02 / PSURF-05)

- **D-21: `formatPsychologicalProfileForDisplay(profileType, profile, lang)` exported from `src/bot/handlers/profile.ts`.** Signature:
  ```typescript
  export function formatPsychologicalProfileForDisplay(
    profileType: 'hexaco' | 'schwartz' | 'attachment',
    profile: ProfileRow<HexacoProfileData> | ProfileRow<SchwartzProfileData> | ProfileRow<AttachmentProfileData> | null,
    lang: 'en' | 'fr' | 'ru',
  ): string;
  ```
  Pure function — zero side effects, zero DB/network. Returns the user-facing string for ONE profile section. Composability: `/profile` command calls it 3 times.
- **D-22: HARD CO-LOC #M11-3 atomic plan.** `formatPsychologicalProfileForDisplay` + `profile-psychological.golden.test.ts` ship in the SAME plan (Plan 39-02). Locked by REQUIREMENTS PSURF-05 verbatim. Mirrors M010 SURF-04 pattern.

### Golden-output snapshot test (Plan 39-02 / PSURF-05)

- **D-23: Snapshot file location: `src/bot/handlers/__tests__/profile-psychological.golden.test.ts`.** Sibling to the existing `profile.golden.test.ts` (M010 operational). Vitest inline-snapshot pattern (`toMatchInlineSnapshot`). Test fixtures fully inline — no external fixture files (the M010 `MOCK_PROFILES` pattern).
- **D-24: 4 fixture scenarios (locked by REQUIREMENTS PSURF-05):**
  1. **All populated** — HEXACO 6 dims scored, Schwartz 10 values scored, Attachment deferred (D-19 message)
  2. **All insufficient** — all three profiles below threshold (`overall_confidence === 0`, low word counts)
  3. **Mixed** — HEXACO populated + Schwartz below-floor + Attachment deferred
  4. **FR + RU slots reserved** — same fixture as scenario 1 but with `lang: 'fr'` and `lang: 'ru'` snapshot variants; structure must accommodate without churn when proper translations ship later
- **D-25: Per-language `describe.each` parametrization for scenarios 1-3.** Scenario 4 explicitly tests FR + RU as separate snapshots to lock the structural shape. Each snapshot is an inline string per `toMatchInlineSnapshot()` — passing one assertion per (scenario × language) combination.

### Claude's Discretion

The planner has flexibility on:

- **Whether to extract a `runPsychologicalSection` helper** in `src/bot/handlers/profile.ts` to deduplicate the 3 reply-emit calls. Phase 35 left the 4 operational replies as a `for` loop over `dimensions`; Phase 39 could mirror that with a `for` loop over `['hexaco', 'schwartz', 'attachment']`. Recommend: yes, mirror the loop pattern.
- **Localization string placement** — inline as `MSG.psychologicalSections.hexaco_section_title.en = "HEXACO Personality"` OR centralized in a per-profile-type translation table. Either works; planner picks consistent style.
- **Whether the negative-invariant COACH-isolation test lives in `src/chris/modes/__tests__/` or alongside the boundary-audit test in `src/memory/profiles/__tests__/`.** Recommend: `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` (handler-adjacent — closer to the file under guard).
- **Whether to include a structural sanity test asserting the prompt-template substitution order is exactly psychological → operational → pensieve.** Belt-and-suspenders for D-11. Planner can include if cheap.
- **Whether the qualifier mapping in D-07 is a const tuple or a switch.** Either works; const tuple is more declarative.
- **Whether to add a comment near the Hard Rule footer in the formatter explaining the recency-bias rationale.** Helps future maintainers; planner picks.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### M011 Research (locked decisions)
- `.planning/research/SUMMARY.md` — phase-ownership map; "PSYCHOLOGICAL_PROFILE_INJECTION_MAP as a new constant distinct from PROFILE_INJECTION_MAP" lock
- `.planning/research/ARCHITECTURE.md` §5 (reader API split) — `getPsychologicalProfiles` does NOT extend operational return type; the formatter follows the same split discipline
- `.planning/research/PITFALLS.md` §1 (D027 sycophancy injection via profile authority framing) — the load-bearing pitfall this phase exists to mitigate. The Hard Rule extension footer (D-06) IS the primary mitigation surface.

### Project specs
- `.planning/PROJECT.md` Key Decisions D027 (Hard Rule — Chris never tells Greg he is right because of who he is), D028 (attachment activation gate — attachment profile is "not yet active" in M011 surface), D031 (Known Facts pattern — psychological block follows operational block follows pensieve)
- `.planning/REQUIREMENTS.md` PSURF-01..05 — this phase's contract verbatim
- `.planning/ROADMAP.md` Phase 39 entry — full success criteria; HARD CO-LOC #M11-3; UI hint flag (this is the user-facing surface phase)

### Phase 37 + Phase 38 deliverables (consumed by Phase 39)
- `src/memory/profiles.ts:246` — `PsychologicalProfiles` interface; `:408` — `getPsychologicalProfiles()` reader (Phase 37)
- `src/memory/profiles/psychological-schemas.ts` — Zod schemas + inferred types HexacoProfileData / SchwartzProfileData / AttachmentProfileData (Phase 37)
- `src/memory/psychological-profile-prompt.ts:144` — `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant (Phase 38; reused VERBATIM in formatter's footer per D-06)
- `src/memory/profiles/psychological-shared.ts` — `PsychologicalProfileType` type (Phase 37; constrains map values per D-04)

### M010 reference patterns (most-similar phase precedents)
- `.planning/milestones/v2.5-phases/35-surfaces/35-CONTEXT.md` — DIRECT ANALOG; 3-plan structure (M010 needed buildSystemPrompt refactor in 35-01; M011 doesn't, so 2-plan split)
- `.planning/milestones/v2.5-phases/35-surfaces/35-01-PLAN.md` — buildSystemPrompt refactor pattern (Phase 35 already did this; Phase 39 extends `ChrisContextExtras` only)
- `.planning/milestones/v2.5-phases/35-surfaces/35-02-PLAN.md` — `PROFILE_INJECTION_MAP` + `formatProfilesForPrompt` + mode-handler wiring (most-similar Plan 39-01 precedent)
- `.planning/milestones/v2.5-phases/35-surfaces/35-03-PLAN.md` — `/profile` command + display formatter + golden snapshot (most-similar Plan 39-02 precedent; HARD CO-LOC #M10-5 mirrors #M11-3)

### Codebase substrate (existing patterns to mirror)
- `src/memory/profiles.ts:87` — `PROFILE_INJECTION_MAP` operational exemplar; Phase 39 adds parallel `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` alongside
- `src/memory/profiles.ts:417,446` — `formatProfilesForPrompt(profiles, mode)` operational exemplar; Phase 39 adds parallel `formatPsychologicalProfilesForPrompt`
- `src/chris/personality.ts:39` — `ChrisContextExtras` interface declaration (extend with `psychologicalProfiles?: string`)
- `src/chris/personality.ts:124-155` — `buildSystemPrompt` body with `operationalProfiles` prepending logic (Phase 39 extends to prepend `psychologicalProfiles` ABOVE `operationalProfiles`)
- `src/chris/modes/reflect.ts:11,76-80` — operational profile wiring pattern (Phase 39 mirrors for psychological)
- `src/chris/modes/psychology.ts:11,77-82` — same
- `src/chris/modes/coach.ts:11,77-78` — operational profile wiring; Phase 39 does NOT modify this file (D-14)
- `src/bot/handlers/profile.ts:179,627` — `MSG.m011Placeholder` definition + usage site; Phase 39 replaces line 627 with three psychological-section replies
- `src/bot/handlers/profile.ts:formatProfileForDisplay` (operational exemplar) — Phase 39 adds parallel `formatPsychologicalProfileForDisplay`
- `src/bot/handlers/__tests__/profile.golden.test.ts` (M010 operational golden test) — Phase 39 sibling at `profile-psychological.golden.test.ts`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`PSYCHOLOGICAL_HARD_RULE_EXTENSION`** at `src/memory/psychological-profile-prompt.ts:144` — Phase 38 constant; Phase 39's `formatPsychologicalProfilesForPrompt` IMPORTS this verbatim for the inline footer. Single source of truth.
- **`getPsychologicalProfiles`** at `src/memory/profiles.ts:408` — Phase 37 reader; never-throw; consumed by REFLECT + PSYCHOLOGY handlers (D-13) and `/profile` command handler (D-18).
- **`PROFILE_INJECTION_MAP`** at `src/memory/profiles.ts:87` — operational analog; Phase 39 adds sibling `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (D-03).
- **`formatProfilesForPrompt`** at `src/memory/profiles.ts:446` — operational analog; Phase 39 adds sibling `formatPsychologicalProfilesForPrompt`.
- **`buildSystemPrompt`** at `src/chris/personality.ts:94` — accepts `extras: ChrisContextExtras`; Phase 39 extends `ChrisContextExtras` interface and the substitution logic at lines 124-155 (prepend `psychologicalProfiles` above `operationalProfiles`).
- **`/profile` command structure** at `src/bot/handlers/profile.ts:595-635` — existing 4-dimension operational rendering + try/catch + `MSG.m011Placeholder` replaced by Phase 39's 3 psychological sections.
- **Localization `MSG.*[lang]` pattern** in `src/bot/handlers/profile.ts:179` — EN/FR/RU keys; Phase 39 adds new keys with FR/RU placeholders per D-20.

### Established Patterns

- **Named injection-map constant per mode subset** — separate operational vs psychological maps; nominal type-safety preserved. Mode-handler is the gate; template substitution is belt-and-suspenders.
- **Pre-rendered prompt-side string in ChrisContextExtras** — keeps `personality.ts` single-responsibility (renders the prompt; doesn't compute injection scope).
- **Sequential reader calls in mode handlers** — `getOperationalProfiles → getPsychologicalProfiles` sequentially (D-16). Both never-throw.
- **Hard Rule extension footer at the BOTTOM of the psych block** — recency-bias attention (D-11). The footer's exact phrasing comes from Phase 38's `PSYCHOLOGICAL_HARD_RULE_EXTENSION` import — never duplicated.
- **COACH negative-invariant test pattern** — grep-based assertion that the file is unchanged; mirrors M008 boundary-audit pattern. Locks the "no trait → coaching-conclusion" rule structurally, not just by code review.
- **Inline-snapshot golden test** — `toMatchInlineSnapshot()` with fixed `MOCK_PROFILES` fixtures (M010 SURF-04 pattern).
- **Insufficient-data branch UX** — second-person framing, count down to threshold (e.g., "need N more words"). The `word_count_at_last_run` column from Phase 37 PSCH-08 enables this without re-querying.

### Integration Points

- **`src/memory/profiles.ts` (MODIFIED)** — Plan 39-01 owns: append `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt`.
- **`src/chris/personality.ts` (MODIFIED)** — Plan 39-01 owns: extend `ChrisContextExtras` interface (~line 39) with `psychologicalProfiles?: string` + extend substitution logic (~lines 124-155) to prepend the field above `operationalProfiles`.
- **`src/chris/modes/reflect.ts` (MODIFIED)** — Plan 39-01 owns: add 4 lines (getPsychologicalProfiles import + 2-call wiring per D-13 + extras field).
- **`src/chris/modes/psychology.ts` (MODIFIED)** — Plan 39-01 owns: same shape as reflect.ts.
- **`src/chris/modes/coach.ts` (NOT MODIFIED)** — Plan 39-01 NEGATIVE-INVARIANT test asserts no changes (D-14).
- **`src/chris/modes/__tests__/coach-psychological-isolation.test.ts` (NEW)** — Plan 39-01 owns: regex sweep test asserting COACH handler is psych-vocabulary-free (D-14).
- **`src/chris/modes/__tests__/<various>.test.ts` (MAYBE MODIFIED)** — Plan 39-01 may extend existing handler-tests to assert the new injection happens. Planner picks.
- **`src/memory/__tests__/profiles.test.ts` (MODIFIED)** — Plan 39-01 owns: add tests for `formatPsychologicalProfilesForPrompt` (empty cases, populated rendering, Hard Rule footer present).
- **`src/bot/handlers/profile.ts` (MODIFIED)** — Plan 39-02 owns: replace `MSG.m011Placeholder` with 3 new replies + add `formatPsychologicalProfileForDisplay` + add MSG psychological keys + add reader call.
- **`src/bot/handlers/__tests__/profile-psychological.golden.test.ts` (NEW)** — Plan 39-02 owns: 4 fixture scenarios × 3 languages where applicable (D-23 to D-25).

</code_context>

<specifics>
## Specific Ideas

- **Mirror Phase 35's three-plan structure with one fewer plan.** Phase 35 needed Plan 35-01 (buildSystemPrompt refactor — HARD CO-LOC #M10-4). Phase 39 doesn't — that refactor already shipped. So Phase 39 has 2 plans: 39-01 prompt-side (mirrors 35-02 mode-handler wiring) + 39-02 display-side (mirrors 35-03 /profile + golden, with HARD CO-LOC #M11-3).
- **Footer is the load-bearing safeguard.** PITFALLS §1 names this as THE primary D027 mitigation surface for M011. The phrasing in D-06 is the exact text Sonnet sees — small wording changes here can dramatically change sycophancy resistance. Lock the text by importing from Phase 38's `PSYCHOLOGICAL_HARD_RULE_EXTENSION` rather than re-writing in the formatter.
- **Negative-invariant test for COACH is structural defense.** Phase 39's PSURF-05 verbatim names this test. It's a grep — runs in <1s; catches future refactors that import `getPsychologicalProfiles` into `coach.ts`. Make the failure message LOUD: "COACH handler must not reference psychological profiles per D027 — see PITFALLS.md §1."
- **Display formatter is pure — golden snapshot is the test surface.** No I/O in the formatter; the `/profile` command does the I/O (reader call + ctx.reply chain). Mirrors M010 SURF-04 pattern.
- **`word_count_at_last_run` from Phase 37 enables the "need N more words" branch.** No additional reader call needed for the display; the existing `getPsychologicalProfiles` returns the row including the word-count column.

</specifics>

<deferred>
## Deferred Ideas

- **Real FR + RU translations** — PSURF-05 says "language hook slots reserved (deferred wiring)". Phase 39 ships placeholder strings (likely machine-translated EN copy) and the snapshot structure that accommodates real translations without churn. Proper localization pass is v2.6.1 or M014.
- **Schwartz circumplex-ordered display** — `/profile` renders Schwartz values alphabetically. Grouping by circumplex sector (Openness-to-change vs Conservation vs Self-Enhancement vs Self-Transcendence) is `CIRC-01` in v2.6.1 / M014.
- **Trait change-detection alerts on `/profile`** — when a HEXACO dimension shifts >0.5 month-over-month, surface that in the display. `CONS-02` in v2.6.1.
- **Attachment activation** — D-19's Attachment branch always renders "not yet active" in M011. When v2.6.1 / M013 ships `ATT-POP-01`, this branch updates to render populated data based on the `activated` flag.
- **"This profile is injected into REFLECT/PSYCHOLOGY" disclosure text** — Claude's-discretion item in `/profile` output. If included, it tells Greg which modes use the data. Not in PSURF-04 verbatim; planner can decide.
- **Promise.all parallelism for the two reader calls** — D-16 defers this to v2.6.1 if profiling reveals latency.
- **Cross-validation between HEXACO and Schwartz** — "Openness + Self-Direction independently corroborated" output enrichment. `CROSS-VAL-01` in v2.6.1.
- **Narrative summary of psychological profile** — interpretation-of-inference; M014 only per ANTI-features. NOT in M011 surface.

</deferred>

---

*Phase: 39-psychological-surfaces*
*Context gathered: 2026-05-14*
