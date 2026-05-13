# Phase 35: Surfaces — Context

**Gathered:** 2026-05-13 (via `/gsd-discuss-phase 35 --auto`)
**Status:** Ready for planning
**Prior phases:** Phase 33 (Profile Substrate) shipped 2026-05-11; Phase 34 (Inference Engine) shipped + deployed 2026-05-12. First Sunday 22:00 Paris cron fire scheduled 2026-05-17.

<domain>
## Phase Boundary

Phase 35 ships the **user-facing surfaces** that consume Phase 33's reader API and Phase 34's populated rows. After this phase:

- `buildSystemPrompt` in `src/chris/personality.ts` is refactored to `(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)` where `ChrisContextExtras = { language?, declinedTopics?, operationalProfiles? }` — atomic across ALL call sites in one plan (HARD CO-LOC #M10-4)
- REFLECT, COACH, and PSYCHOLOGY mode handlers call `getOperationalProfiles()` and inject a `## Operational Profile (grounded context — not interpretation)` block above `{pensieveContext}` per the D031 Known Facts pattern, gated by the `PROFILE_INJECTION_MAP` named constant (M010-08 mitigation)
- JOURNAL, INTERROGATE, PRODUCE, PHOTOS, and ACCOUNTABILITY modes do NOT receive profile injection (per ROADMAP success #2 and SUMMARY.md mapping)
- `src/bot/handlers/profile.ts` exports `handleProfileCommand()` registered as the `/profile` Telegram command — plain-text (no `parse_mode`), EN/FR/RU localized, second-person framing, four `ctx.reply()` calls (one per dimension) + an M011-placeholder reply
- `formatProfileForDisplay(profile)` is a pure function with a golden-output snapshot test on a fixed `MOCK_PROFILES` fixture (HARD CO-LOC #M10-5 with `/profile` handler — M010-07 mitigation)
- `formatProfilesForPrompt(profiles, mode)` in `src/memory/profiles.ts` returns `""` when all four profiles are null OR when no `PROFILE_INJECTION_MAP[mode]` entries pass the confidence/staleness gates — mode handlers omit the injection block entirely in that case (ROADMAP success #5)

**Explicitly NOT in this phase:** synthetic m010-30days fixture, `--profile-bias` synth flag, two-cycle integration test, sparse-fixture threshold test, live 3-of-3 anti-hallucination test, real-DB profile-populate integration test. Those are Phase 36 (PTEST-01..05).

**Inter-phase coupling:**
- **Upstream (consumes Phase 33):** `getOperationalProfiles()` reader + `OperationalProfiles` interface + per-profile Zod v3 schemas + `JurisdictionalProfileData` / `CapitalProfileData` / `HealthProfileData` / `FamilyProfileData` types from `src/memory/profiles.ts` and `src/memory/profiles/schemas.ts`
- **Upstream (consumes Phase 34):** populated rows from the Sunday 22:00 Paris cron — used in Phase 36's integration test to assert non-null rendering; not required for Phase 35 unit/golden tests (those use MOCK_PROFILES)
- **Downstream (consumed by Phase 36):** the `## Operational Profile` system-prompt block injected by REFLECT/COACH/PSYCHOLOGY is the surface that PTEST-05's live 3-of-3 anti-hallucination test asserts against; the `/profile` command output is the surface Greg uses for manual UAT after the first Sunday 22:00 fire

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M010 research pass (`SUMMARY.md` Phase 35 entry, lines 171-187, plus `PITFALLS.md` M010-07 / M010-08). The `--auto` flag locked each at the recommended option. The planner should treat them as the contract surface and validate via the success criteria in ROADMAP.md Phase 35 entry (lines 79-89).

`[auto]` annotations record the gray area, the recommended option chosen, and the source.

### Plan split structure

- **D-01: 3 plans matching REQUIREMENTS traceability table.** `[auto]` Plan structure — Q: "How to split Phase 35?" → Selected: "3 plans (matches REQUIREMENTS SURF-01..SURF-05 mapping at REQUIREMENTS.md:93-97)" (recommended default; mirrors Phase 33/34 split discipline).
  - **Plan 35-01: `buildSystemPrompt` signature refactor + atomic call-site migration (HARD CO-LOC #M10-4)** — `src/chris/personality.ts` refactored to `(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)`; `ChrisContextExtras` interface exported; ALL 8 call sites migrated atomically (5 mode handlers + photos + resolution.ts + 2 test files); ACCOUNTABILITY overload preserved exactly. Pre-work: OQ-3 call-site grep (already inventoried below in D-06 — planner reconfirms before code change). Satisfies SURF-01. **~3-4 tasks.** All existing mode-handler and engine tests pass post-refactor (regression gate).
  - **Plan 35-02: Mode-handler injection wiring + PROFILE_INJECTION_MAP + formatProfilesForPrompt** — `src/memory/profiles.ts` adds `PROFILE_INJECTION_MAP` named constant + `formatProfilesForPrompt(profiles, mode)` function; REFLECT/COACH/PSYCHOLOGY mode handlers call `getOperationalProfiles()` + `formatProfilesForPrompt()` BEFORE `buildSystemPrompt()` and pass the formatted block via `extras.operationalProfiles`; mode-handler tests assert injection happens for the 3 in-scope modes and is absent for the 5 out-of-scope modes. Satisfies SURF-02. **~5 tasks.**
  - **Plan 35-03: `/profile` command + `formatProfileForDisplay` + golden-output snapshot test + bot registration (HARD CO-LOC #M10-5)** — `src/bot/handlers/profile.ts` exports `handleProfileCommand(ctx)` + `formatProfileForDisplay(profile, lang)` pure function; `src/bot/handlers/__tests__/profile.golden.test.ts` snapshot test against `MOCK_PROFILES` fixture; `src/bot/bot.ts` registers `bot.command('profile', handleProfileCommand as any)` between the existing `/summary` and the generic text handler. Satisfies SURF-03, SURF-04, SURF-05. **~5 tasks.**

- **D-02: Plan ordering is strict, not parallelizable.** 35-01 ships before 35-02 (mode-handler edits in 35-02 import the new `ChrisContextExtras` type and call `buildSystemPrompt` with the new signature — partial refactor breaks the build). 35-02 ships before 35-03 (35-03 imports `PROFILE_INJECTION_MAP` and `formatProfilesForPrompt` from `src/memory/profiles.ts` for the M011-placeholder check; if those don't exist yet, the `/profile` handler can't gate on injection map state). Same hard-sequencing discipline as Phase 34.

### buildSystemPrompt refactor (Plan 35-01 / SURF-01)

- **D-03: Signature locked: `buildSystemPrompt(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)`.** `extras` is optional (defaults to `{}`) so call sites that don't need language/declinedTopics/profiles (e.g., test fixtures, engine.test.ts smoke tests) can omit it. The first 3 positional params are unchanged. `[auto]` Refactor strategy — Q: "Keep ACCOUNTABILITY overload as-is or generalize?" → Selected: "Keep overload, add extras as optional 4th positional arg" (recommended; SUMMARY.md line 180 names this exact shape; minimal-blast-radius refactor; ACCOUNTABILITY overload comment in personality.ts:84-92 is preserved verbatim).
- **D-04: `ChrisContextExtras` interface shape locked: `{ language?: string; declinedTopics?: DeclinedTopic[]; operationalProfiles?: string }`.** All three fields optional. `operationalProfiles` is the pre-rendered string from `formatProfilesForPrompt()` — NOT the structured `OperationalProfiles` object. This keeps `personality.ts` ignorant of profile internals (single-responsibility: render the prompt; don't compute injection scope). Exported from `src/chris/personality.ts` alongside `DeclinedTopic`.
- **D-05: ACCOUNTABILITY overload preserved exactly.** The IN-04 parameter-overload semantics (`pensieveContext` → `{decisionContext}`, `relationalContext` → template's `{pensieveContext}` slot) stay verbatim. The 84-92 line comment block in `personality.ts` remains. `resolution.ts:252-257` migrates from `buildSystemPrompt('ACCOUNTABILITY', decisionContext, temporalContext, rawLang)` to `buildSystemPrompt('ACCOUNTABILITY', decisionContext, temporalContext, { language: rawLang })` — same overload, new extras shape.
- **D-06: OQ-3 call-site inventory complete (8 call sites).** Verified via `grep -rn "buildSystemPrompt(" src/` against current main:
  1. `src/chris/personality.ts:94` — declaration (refactored)
  2. `src/chris/modes/journal.ts:81` — `buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics)`
  3. `src/chris/modes/interrogate.ts:115` — `buildSystemPrompt('INTERROGATE', pensieveContext, undefined, language, declinedTopics)`
  4. `src/chris/modes/reflect.ts:76` — `buildSystemPrompt('REFLECT', pensieveContext, relationalContext, language, declinedTopics)` (extras gains `operationalProfiles`)
  5. `src/chris/modes/coach.ts:76` — `buildSystemPrompt('COACH', pensieveContext, relationalContext, language, declinedTopics)` (extras gains `operationalProfiles`)
  6. `src/chris/modes/psychology.ts:77` — `buildSystemPrompt('PSYCHOLOGY', pensieveContext, relationalContext, language, declinedTopics)` (extras gains `operationalProfiles`)
  7. `src/chris/modes/produce.ts:72` — `buildSystemPrompt('PRODUCE', pensieveContext, undefined, language, declinedTopics)`
  8. `src/chris/modes/photos.ts:182` — `buildSystemPrompt('JOURNAL', undefined, undefined, language, declinedTopics)`
  9. `src/decisions/resolution.ts:252` — `buildSystemPrompt('ACCOUNTABILITY', decisionContext, temporalContext, rawLang)` (no declinedTopics — verify intentional in plan)
  10. `src/chris/__tests__/personality.test.ts` — 31 occurrences (mostly `buildSystemPrompt(mode)` smoke tests)
  11. `src/chris/__tests__/engine.test.ts` — 16 occurrences (regression coverage)

  All migration is mechanical: convert positional `(...,language, declinedTopics)` to `(...,{ language, declinedTopics })`. `[auto]` Call-site coverage — Q: "Migrate test files in the same plan or follow-up?" → Selected: "Same plan, atomic — HARD CO-LOC #M10-4 enforcement" (recommended; partial-refactor leaves the build red).

- **D-07: Inject `operationalProfiles` into REFLECT/COACH/PSYCHOLOGY prompts ABOVE `{pensieveContext}`.** Per D031 Known Facts pattern and ROADMAP success #2: the profile block precedes the pensieve context in the final assembled prompt. Implementation: when `extras.operationalProfiles` is a non-empty string AND the mode is REFLECT/COACH/PSYCHOLOGY, the prompt template substitution prepends the block to `pensieveContext`. JOURNAL/INTERROGATE/PRODUCE/PHOTOS receive `extras.operationalProfiles` but IGNORE it (silent drop, mirrors current `relationalContext`-on-JOURNAL behavior in `personality.ts:81-82`). ACCOUNTABILITY receives but ignores it too (`pensieveContext` slot is overloaded for decisionContext).

### Mode-handler injection wiring (Plan 35-02 / SURF-02)

- **D-08: PROFILE_INJECTION_MAP named constant in `src/memory/profiles.ts`.** Exported per-mode subset; values locked by M010-08 mitigation in research SUMMARY.md lines 82-86:
  ```typescript
  export const PROFILE_INJECTION_MAP: Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', Dimension[]> = {
    REFLECT: ['jurisdictional', 'capital', 'health', 'family'], // full context
    COACH: ['capital', 'family'], // decisions + constraints only — health → topic-drift risk
    PSYCHOLOGY: ['health', 'jurisdictional'], // clinical + situational grounding
  };
  ```
  `[auto]` Injection scope — Q: "All 4 profiles for all 3 modes, or per-mode subset?" → Selected: "Per-mode subset via named constant" (recommended per PITFALLS M010-08; SUMMARY.md line 82). Rationale: COACH topic drift is the observable failure mode if health profile is salient in business-strategy conversations. PSYCHOLOGY needs clinical + situational grounding; capital/family aren't psychological. REFLECT synthesizes across everything by design.

- **D-09: Health profile gated by `confidence >= 0.5` before injection in ANY mode.** Per M010-08 mitigation: "Health profile injected into any mode only when `confidence >= 0.5` — avoid injecting speculative health hypotheses as grounded facts." Implemented inside `formatProfilesForPrompt()` — if a dimension in the per-mode list has confidence < 0.5 for `health`, that dimension is skipped from the rendered block. Other dimensions follow the standard non-null-and-non-zero-confidence gate (PROF-04 reader already returns null for missing rows; the formatter additionally skips zero-confidence rows). `[auto]` Health confidence threshold — Q: "Apply 0.5 floor to all dimensions or health only?" → Selected: "Health only — other dimensions inject from confidence > 0" (recommended; PITFALLS specifically calls out health as the topic-drift risk; jurisdictional/capital/family are factual enough to inject at any confidence > 0).

- **D-10: Staleness qualifier: `last_updated > 21 days ago` adds inline staleness note.** Per M010-08 mitigation: "if `profile.last_updated` is more than 21 days ago, inject the profile with an explicit staleness marker in the system prompt: 'Note: profile data from [date] — may not reflect current state.'" Implemented inside `formatProfilesForPrompt()` after the dimension's data renders but before the section separator. 21-day threshold = 3 weekly cron cycles; allows for one missed cron + buffer. `[auto]` Staleness threshold — Q: "14 days, 21 days, or 30 days?" → Selected: "21 days" (recommended per M010-08 verbatim; 3 cron cycles).

- **D-11: Per-dimension token cap of 500 tokens (~2000 chars) in the prompt-side formatter.** Per Performance Trap in PITFALLS.md line 403: "Cap profile injection at 500 tokens per dimension (enforce via character limit in the formatter called by mode handlers). Truncate with '...' marker if over cap." Hard cap at 2000 chars per dimension's rendered block. NOT applied to the user-facing `/profile` output — there the display formatter (D-15) renders full content (Telegram message cap of 4096 chars governs there). `[auto]` Token cap — Q: "Cap at 500 tokens per dimension or rely on Sonnet brevity?" → Selected: "Hard 500-token cap (~2000 chars) with truncation marker" (recommended; Performance Trap directly addresses this).

- **D-12: `formatProfilesForPrompt(profiles, mode)` returns empty string `""` when no in-scope dimensions render.** Per ROADMAP success #5: "When all four profiles are null (e.g., fresh DB or all below threshold), `formatProfilesForPrompt()` returns empty string and mode handlers omit the injection block entirely." Trigger conditions for empty return: (a) the mode is not in `PROFILE_INJECTION_MAP` (JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY); (b) all dimensions in the per-mode list are null; (c) all dimensions in the per-mode list are zero-confidence; (d) the health dimension (when in the list) is below 0.5 and other dimensions in the list are all null/zero-confidence. Mode handler then passes `extras.operationalProfiles = ""` (or skips the field entirely) and `personality.ts` omits the injection block per D-07.

- **D-13: Injection block header: `## Operational Profile (grounded context — not interpretation)`.** Verbatim — per ROADMAP success #2 and SURF-02 requirement text. Header is the same across all 3 modes (REFLECT/COACH/PSYCHOLOGY); subsection headers within the block are dimension names. The "grounded context — not interpretation" parenthetical mirrors D031's "Known Facts about you (Greg)" framing — tells Sonnet to treat these as facts-of-record, not as Sonnet's own inference.

- **D-14: Mode-handler call order:** `getOperationalProfiles()` → `formatProfilesForPrompt()` → `buildSystemPrompt()`. The profile read happens once per message in each of REFLECT/COACH/PSYCHOLOGY. No caching layer in Phase 35 (Performance Trap suggests 1h TTL caching, but at single-user scale this is ~4ms/message overhead — deferred to v2.5.1; see Deferred Ideas). `[auto]` Caching strategy — Q: "Cache getOperationalProfiles() result in memory or per-call?" → Selected: "Per-call (no cache)" (recommended; single-user scale doesn't justify the cache-invalidation complexity in v1).

- **D-15: Mode-handler test coverage:** Each of `reflect.test.ts` / `coach.test.ts` / `psychology.test.ts` gets a new assertion that `getOperationalProfiles` is called and `extras.operationalProfiles` is passed to `buildSystemPrompt`. The 5 out-of-scope modes (`journal.test.ts` / `interrogate.test.ts` / `produce.test.ts` / `photos.test.ts`) get an assertion that `getOperationalProfiles` is NOT called (negative invariant prevents accidental wiring drift). Mock `getOperationalProfiles` at the SDK boundary with `vi.mock('../../memory/profiles.js')` and assert call shape.

### `/profile` command (Plan 35-03 / SURF-03 + SURF-04 + SURF-05)

- **D-16: Handler location: `src/bot/handlers/profile.ts`.** Mirrors `summary.ts` and `decisions.ts`. Registered in `src/bot/bot.ts` between the existing `/summary` registration (line ~34) and the generic text handler. `[auto]` File location — Q: "`src/bot/handlers/profile.ts` or `src/bot/commands/profile.ts`?" → Selected: "`src/bot/handlers/profile.ts`" (recommended per SUMMARY.md line 79; matches existing handler convention).

- **D-17: Plain text only — no `parse_mode`.** Per SURF-05 requirement text + D031 codebase policy + summary.ts:23 precedent. Markdown escape complexity for user-origin content in profile JSONB fields is a footgun; visual gain is marginal.

- **D-18: Output structure — 4 dimension `ctx.reply()` calls + 1 M011-placeholder reply.** Per SUMMARY.md line 79 ("4 separate `ctx.reply()` calls") and line 176 ("4 × `ctx.reply()` plain-text"). One dimension per Telegram message keeps each reply well below the 4096-char limit even with verbose profile content; isolates rendering failures (if family-profile rendering throws, jurisdictional/capital/health still send). The 5th reply is the M011 placeholder: `"Psychological profile: not yet available — see M011"` (localized per D-19). `[auto]` Reply granularity — Q: "Single combined reply or per-dimension replies?" → Selected: "5 separate replies (4 dimensions + M011 placeholder)" (recommended per SUMMARY.md line 79; matches Telegram-message-cap discipline and per-dimension failure isolation).

- **D-19: Localization EN/FR/RU via `getLastUserLanguage(chatId.toString())`.** Same path summary.ts:37,162 uses. The `/profile` command is user-initiated (not cron-context), so the in-memory session-language cache is populated by the user's preceding message. No DB-backed fallback needed in Phase 35 (the cron-context lesson from M009 first-Sunday weekly_review is irrelevant here — `/profile` doesn't run from cron). Localized strings (section labels, M011 placeholder, "insufficient data" markers, staleness note) follow the `MSG` map shape from `summary.ts:56-82`. `[auto]` Localization source — Q: "`getLastUserLanguage` (in-memory) or `getLastUserLanguageFromDb` (DB-backed)?" → Selected: "`getLastUserLanguage` (user-initiated context)" (recommended per existing handler pattern; DB-backed lookup is for cron context where in-memory cache is cold).

- **D-20: Output framing: second person, present tense.** Per M010-07 mitigation + UX Pitfall in PITFALLS.md line 412: "Format in second person: 'You're currently in France. Residency status: French resident.'" — direct lesson from M009 weekly_review first-Sunday third-person framing incident. Verbatim phrasings the formatter MUST emit: "You're currently in...", "Your residency status:", "Your FI target:", etc. The formatter must NOT use: "Greg's...", "His...", or any third-person framing.

- **D-21: "Insufficient data" zero-confidence framing.** Per UX Pitfall in PITFALLS.md line 413: "Show a progress indicator: 'Building your operational profile — Chris has seen ~3 entries about your location; needs ~7 more before populating your jurisdictional profile.'" The formatter derives the count from `entryCount` if available, else falls back to "Chris needs more entries about your [dimension] before populating this profile." `[auto]` Zero-confidence UX — Q: "Show 'insufficient data' literal or actionable progress indicator?" → Selected: "Actionable progress indicator with entry-count gap" (recommended per UX Pitfall mitigation).

- **D-22: Staleness qualifier in `/profile` output too.** When a dimension has `last_updated > 21 days ago`, append a localized staleness note after the dimension's content: "Note: profile data from {date} — may not reflect current situation." Same threshold as D-10 (prompt-side staleness), different rendering (user-visible localized note vs. system-prompt qualifier).

- **D-23: ASCII section dividers within each reply.** Per SURF-05 — "multi-section layout with ASCII section dividers mirroring `src/bot/handlers/summary.ts` formatting". `summary.ts:94-108` uses blank lines as separators within a single reply. For `/profile`, each dimension reply uses internal blank-line separators between fields and a leading section title (e.g., `"Jurisdictional Profile (confidence 72%)"`) as the divider/header. No ASCII `---` or `===` lines — those are Markdown-flavored and `/profile` is plain-text per D-17.

### `formatProfileForDisplay` golden-output snapshot test (Plan 35-03 / SURF-04)

- **D-24: Function location: `src/bot/handlers/profile.ts`** (same file as `handleProfileCommand`). Co-location enforced by HARD CO-LOC #M10-5. Two distinct exports: `formatProfileForDisplay(dimension, profile, lang)` is a pure function (no side effects, no DB, no I/O) and is the unit under test; `handleProfileCommand(ctx)` is the integration surface that calls `getOperationalProfiles()` + iterates dimensions + calls `formatProfileForDisplay()` per dimension + sends each as `ctx.reply()`.
- **D-25: Test file: `src/bot/handlers/__tests__/profile.golden.test.ts`.** Mirror summary.ts test directory structure (`src/bot/handlers/__tests__/`).
- **D-26: Golden assertion: `toMatchInlineSnapshot`.** Per Looks-Done-But-Isn't checklist in PITFALLS.md line 427: "Verify: a test file imports `formatProfileForDisplay` and uses `toMatchInlineSnapshot` or equivalent." Inline snapshot keeps the expected output visible in the test source — any rendering change forces a deliberate snapshot update via vitest's `-u` flag, surfacing the regression to the reviewer.
- **D-27: `MOCK_PROFILES` fixture coverage matrix:** Each dimension gets 4 test cases:
  1. **Null profile** (DB error / missing row) — formatter returns localized "insufficient data" with actionable progress indicator
  2. **Zero-confidence profile** ("insufficient data" markers from Phase 33 seed) — formatter returns actionable progress indicator
  3. **Populated, fresh profile** (confidence > 0.5, `last_updated < 21 days`) — formatter returns full second-person summary
  4. **Populated, stale profile** (confidence > 0.5, `last_updated > 21 days`) — formatter returns full summary + localized staleness note
  Total snapshot count: 4 dimensions × 4 cases × 3 languages = 48 golden snapshots, or condensed to 4 × 4 × 1 (English only) = 16 snapshots with FR/RU asserted via a single language-coverage test. `[auto]` Snapshot granularity — Q: "Snapshot all 3 languages × 4 cases per dimension, or English only?" → Selected: "English only for full snapshots; FR/RU via language-coverage smoke test (assert section labels appear in expected language)" (recommended; 48 inline snapshots is unmaintainable; English-only locks the structure while a smoke test guards the FR/RU label substitution).

### Out-of-scope mode coverage (negative-space invariant)

- **D-28: JOURNAL, INTERROGATE, PRODUCE, PHOTOS, ACCOUNTABILITY do NOT receive profile injection.** Per ROADMAP success #2 verbatim. Plan 35-02 adds a regression test asserting these 5 handlers do NOT call `getOperationalProfiles()` (mock import + assert `expect(mockGetProfiles).not.toHaveBeenCalled()`). This is the negative invariant that prevents accidental wiring drift in a future phase.

### Test strategy

- **D-29: Plan 35-01 regression coverage.** All 230 lines of `src/chris/__tests__/personality.test.ts` and the 47 buildSystemPrompt-touching lines of `engine.test.ts` continue to pass post-refactor. NO new tests added in Plan 35-01 — it's a mechanical signature migration; the existing test bodies validate the new shape automatically once their call sites are migrated.
- **D-30: Plan 35-02 mode-handler injection tests.** 3 new positive-injection tests (REFLECT/COACH/PSYCHOLOGY) + 5 new negative-injection tests (JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY). Mocked `getOperationalProfiles` returns the MOCK_PROFILES fixture; assertions verify which dimensions appear in the system prompt for each mode. Plus a `PROFILE_INJECTION_MAP` unit test asserting REFLECT=4 dimensions, COACH=`capital,family`, PSYCHOLOGY=`health,jurisdictional`.
- **D-31: Plan 35-03 golden-output snapshot + handler integration.** The 4×4 inline-snapshot suite per D-27 + a handler integration test asserting `ctx.reply` called 5 times per `/profile` invocation (4 dimensions + M011 placeholder) when all profiles are populated, and asserting graceful "insufficient data" output when `getOperationalProfiles()` returns all-null. Mock the Grammy `Context.reply` via `vi.fn()` per existing summary.test.ts pattern.
- **D-32: No live tests in Phase 35.** Per D-30-03 cost discipline. PTEST-05's live 3-of-3 atomic anti-hallucination test (which asserts the operational-profile block appears in the REFLECT mode prompt against real Sonnet) ships in Phase 36, dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`.

### Claude's Discretion (for planner / executor)

- **Localized string consolidation.** `summary.ts:56-82` and `decisions.ts` each define their own `MSG` localization map inline. For `/profile`, the planner may either inline a `MSG` map in `profile.ts` (consistent with existing handlers — recommended) OR extract a shared `src/bot/handlers/_strings.ts` if duplication becomes painful. Tradeoff: shared module = DRY but adds an indirection; inline = consistent with existing pattern. Default if unsure: inline.
- **Section header phrasing for `/profile`.** D-23 says each reply leads with a section title like `"Jurisdictional Profile (confidence 72%)"`. The exact phrasing (capitalization, French/Russian rendering, percentage formatting) is the planner's call provided it remains second-person framed and golden-test-asserted.
- **Helper extraction within Plan 35-02.** If REFLECT/COACH/PSYCHOLOGY mode handlers' new injection wiring is >80% mechanically identical (call `getOperationalProfiles` → call `formatProfilesForPrompt(profiles, MODE)` → pass to `extras.operationalProfiles`), the planner MAY extract an `injectOperationalProfiles(mode)` helper in `src/chris/modes/_shared.ts` or similar. Tradeoff: helper reduces 3-line duplication × 3 handlers = 9 lines saved at the cost of one indirection. Default if unsure: inline (3 lines per handler is below the abstraction-pays-off threshold).
- **Per-dimension dimension-config object.** Each dimension's formatter (jurisdictional/capital/health/family) renders different fields. The planner MAY use a per-dimension config object (`JURISDICTIONAL_DISPLAY_CONFIG = { sectionTitle, fields, ... }`) or inline switch-case logic. Tradeoff: config object enables future locale additions and field-shape changes without code change; switch-case is simpler for v1. Default if unsure: switch-case in v1; refactor to config object only if M011/M012 add more dimensions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked phase-level context (read FIRST)
- `.planning/phases/33-profile-substrate/33-CONTEXT.md` — Phase 33's locked decisions (PROF-04 never-throw reader D-12, sentinel-row pattern D-04, schema_version dispatcher D-13, ground-truth seeding D-10 — Phase 35 consumes the reader and the seeded rows are what `/profile` displays before the first Sunday 22:00 fire)
- `.planning/phases/33-profile-substrate/33-SUMMARY.md` — what Phase 33 actually shipped (the `getOperationalProfiles()` API surface, `OperationalProfiles` interface, `JurisdictionalProfileData`/`CapitalProfileData`/`HealthProfileData`/`FamilyProfileData` types Phase 35 imports)
- `.planning/phases/33-profile-substrate/33-VERIFICATION.md` — Phase 33 success-criteria verification (confirms the substrate's contract surface is intact)
- `.planning/phases/34-inference-engine/34-CONTEXT.md` — Phase 34's locked decisions (D-21 Promise.allSettled execution model, D-26 CronRegistrationStatus.profileUpdate, D-29 write-before-upsert via profile_history — Phase 35 doesn't modify these, but the planner must understand the populated-row pipeline that feeds `/profile` output and mode-handler injection)
- `.planning/phases/34-inference-engine/34-SUMMARY.md` — Phase 34 actual ship state (the 3 plans' SUMMARY files cover the as-built generators + orchestrator + cron + /health wiring)

### M010 research (locked decisions for Phase 35)
- `.planning/research/SUMMARY.md` §Phase 35 (lines 171-187) — Phase 35 deliverables list; PROFILE_INJECTION_MAP per-mode subset locked at lines 82-86; addresses TS-6/7/8/11; avoids M010-07/08; OQ-3 pre-work flagged
- `.planning/research/SUMMARY.md` lines 80-86 — `buildSystemPrompt` `extras: ChrisContextExtras` refactor named; per-mode injection map values locked
- `.planning/research/PITFALLS.md` M010-07 (lines 202-232) — `/profile` field-leak mitigation: `formatProfileForDisplay` + golden-output snapshot test + second-person framing
- `.planning/research/PITFALLS.md` M010-08 (lines 234-273) — Mode-handler injection scope: PROFILE_INJECTION_MAP named constant + health confidence ≥ 0.5 gate + 21-day staleness qualifier
- `.planning/research/PITFALLS.md` Performance Traps (lines 401-405) — 500-token per-dimension cap; no caching in v1 single-user scale
- `.planning/research/PITFALLS.md` UX Pitfalls (lines 410-415) — second-person framing imperative; actionable progress indicator for zero-confidence; staleness qualifier text
- `.planning/research/PITFALLS.md` Looks-Done-But-Isn't checklist (lines 419-433) — verifies golden-output test present, PROFILE_INJECTION_MAP named, second-person framing — gate for plan-checker
- `.planning/research/PITFALLS.md` Recovery Strategies (lines 437-450) — M010-07 and M010-08 recovery cost is LOW; both are immediately reversible with redeploy
- `.planning/research/FEATURES.md` §2.1-2.4 — canonical per-dimension field shape; `formatProfileForDisplay` per-field rendering follows these
- `.planning/research/ARCHITECTURE.md` Q4 — reader API shape (Phase 33 baseline; Phase 35 extends with `formatProfilesForPrompt` + `PROFILE_INJECTION_MAP` named constant)

### Project specs
- `M010_Operational_Profiles.md` (project root) — original milestone spec (legacy "John" → "Greg" — all code uses Greg)
- `.planning/PROJECT.md` — Key Decisions D004 (append-only Pensieve), D005 (never-throw fire-and-forget), D008 (first-person framing — applies to /profile second-person to Greg), D031 (boundary-marker / Known-Facts pattern — Operational Profile block follows this), D041 (primed-fixture pipeline supersedes calendar wait)
- `.planning/REQUIREMENTS.md` SURF-01..05 — Phase 35 contract surface (lines 27-33); traceability table at lines 93-97 maps each REQ to plan (35-01/02/03)
- `.planning/ROADMAP.md` Phase 35 entry (lines 75-89) — success criteria 1-5 verbatim; HARD CO-LOCATIONS #M10-4 (`buildSystemPrompt` refactor atomic) and #M10-5 (`/profile` + `formatProfileForDisplay` + golden test atomic) named here; UI hint: yes

### Codebase substrate (existing patterns to mirror)

**`buildSystemPrompt` + system-prompt assembly (Plan 35-01):**
- `src/chris/personality.ts:94-177` — current `buildSystemPrompt` declaration + body; lines 84-92 IN-04 ACCOUNTABILITY overload comment block (preserved verbatim); lines 100-149 per-mode switch (extras injection happens here); lines 156-159 D-04/D-05 Known Facts injection (D-07 Operational Profile block injection mirrors this pattern); lines 161-174 language directive + declined-topics injection (migrates from positional args to extras)
- `src/chris/__tests__/personality.test.ts` — 230 lines of test coverage; 31 `buildSystemPrompt` call-sites; all migrate atomically in Plan 35-01
- `src/chris/__tests__/engine.test.ts:309-381+` — 16 additional `buildSystemPrompt` test sites; all migrate atomically in Plan 35-01

**Mode-handler injection wiring (Plan 35-02):**
- `src/chris/modes/reflect.ts:74-76` — current flow: `buildMessageHistory` → `buildSystemPrompt('REFLECT', pensieveContext, relationalContext, language, declinedTopics)`; Plan 35-02 inserts `getOperationalProfiles` + `formatProfilesForPrompt('REFLECT', profiles)` between these and migrates the call shape
- `src/chris/modes/coach.ts:73-76` — same shape as reflect; same insertion
- `src/chris/modes/psychology.ts:74-77` — same shape as reflect; same insertion
- `src/chris/modes/journal.ts:78-83` — out-of-scope mode (no profile injection); call shape migrates positional → extras only (no `getOperationalProfiles` call added)
- `src/chris/modes/interrogate.ts:113-115` — out-of-scope mode (same as journal)
- `src/chris/modes/produce.ts:70-72` — out-of-scope mode (same as journal)
- `src/chris/modes/photos.ts:180-182` — out-of-scope mode; Photos uses JOURNAL persona — no profile injection
- `src/decisions/resolution.ts:251-257` — ACCOUNTABILITY call site; preserves overload semantics; migrates positional `language` → `{ language }` extras
- `src/memory/profiles.ts:172-180` — `getOperationalProfiles()` existing reader (Phase 33 baseline); Plan 35-02 adds `PROFILE_INJECTION_MAP` constant + `formatProfilesForPrompt` function to the same file

**`/profile` Telegram command (Plan 35-03):**
- `src/bot/handlers/summary.ts` — closest handler precedent: 220 lines; `/summary` command shape (plain-text, EN/FR/RU MSG map, `getLastUserLanguage(chatId.toString())` for localization, single `ctx.reply` per response, no `parse_mode`); `formatSummary` pure function pattern (lines 86-109); error handling + logger.warn pattern (lines 209-217)
- `src/bot/handlers/decisions.ts` — alternative precedent: 8 sub-commands; localized MSG map; pull-only; same `getLastUserLanguage` + `ctx.reply` shape
- `src/bot/bot.ts:32-34` — `/summary` command registration block (`bot.command('summary', handleSummaryCommand as any)`); Plan 35-03 adds an identical line for `/profile` between the existing `/summary` line and the generic text handler at line ~36+
- `src/bot/handlers/__tests__/summary.test.ts` (if exists) — golden-output test template; mock Grammy `Context.reply` via `vi.fn()` and assert call shape
- `src/chris/language.ts` — `getLastUserLanguage(chatId)` exported function; in-memory session cache; user-initiated context (Phase 35 `/profile` uses this; cron context uses `getLastUserLanguageFromDb` instead — see D-19)

**Phase 33 substrate consumed by Phase 35:**
- `src/memory/profiles.ts:48-53` — `OperationalProfiles` interface (4 ProfileRow<T> | null fields)
- `src/memory/profiles.ts:41-46` — `ProfileRow<T>` shape: `{ data, confidence, lastUpdated, schemaVersion }`; D-09 confidence gate and D-10 staleness gate both consume `confidence` and `lastUpdated`
- `src/memory/profiles/schemas.ts` — `JurisdictionalProfileData`/`CapitalProfileData`/`HealthProfileData`/`FamilyProfileData` types (snake_case field names matching FEATURES.md §2.1-2.4); formatter accesses these field-by-field

**Phase 34 substrate consumed by Phase 35:**
- `src/memory/profile-updater.ts` — `updateAllOperationalProfiles()` orchestrator (Phase 35 doesn't call this; the Sunday 22:00 Paris cron does; Phase 35's `/profile` reads what the cron writes)
- `src/cron-registration.ts` — `CronRegistrationStatus.profileUpdate` + `runProfileUpdate` dep (Phase 35 doesn't modify)

**Test scaffolding:**
- `src/chris/__tests__/personality.test.ts` — extend with new tests for `extras.operationalProfiles` injection above `{pensieveContext}` (Plan 35-01 follow-up)
- `src/chris/modes/__tests__/reflect.test.ts` (and coach, psychology) — extend with positive injection assertions (Plan 35-02)
- `src/chris/modes/__tests__/journal.test.ts` (and interrogate, produce, photos) — extend with negative injection invariant (Plan 35-02)
- New file `src/bot/handlers/__tests__/profile.test.ts` — handler integration test (mock `getOperationalProfiles` + `ctx.reply` spy)
- New file `src/bot/handlers/__tests__/profile.golden.test.ts` — `formatProfileForDisplay` inline-snapshot test

### Tests to mirror
- `src/bot/handlers/__tests__/summary.test.ts` (if exists) — handler test scaffolding
- `src/chris/__tests__/personality.test.ts` — full coverage matrix; the existing tests are the regression net for Plan 35-01
- `src/chris/modes/__tests__/reflect.test.ts` — mode handler test pattern (mock SDK boundary, assert prompt body)
- `src/rituals/__tests__/weekly-review.test.ts` — golden-output / snapshot test template (Phase 29 first-Sunday-fire UX-regression detector that motivated M010-07)

</canonical_refs>

<deferred>
## Deferred Ideas (out of Phase 35 scope)

- **In-memory cache of `getOperationalProfiles()` with 1h TTL.** Performance Trap in PITFALLS.md line 404 suggests caching to avoid ~4ms × 4 DB queries per message. At single-user scale this is negligible; if profile-read overhead becomes measurable (large profile rows + Phase 36 fixture tests showing latency creep), v2.5.1 can add a per-process Map cache with invalidation on profile-update cron completion.
- **Helper extraction `injectOperationalProfiles(mode)` for the 3 in-scope mode handlers.** D-14 leaves this as Claude's discretion; default inline for now (3 lines × 3 handlers is below the abstraction-pays-off threshold). Revisit if M011 or M012 add additional mode-handler injection patterns that share the call shape.
- **Per-dimension display config object.** Claude's discretion item; switch-case in v1, config object only if M011/M012 add more dimensions or locale-specific rendering rules.
- **DB-backed language detection in `/profile`.** D-19 uses in-memory `getLastUserLanguage` because `/profile` is user-initiated (in-memory cache always populated). If a future entry surface invokes `/profile` from cron context (e.g., proactive "your profile updated this week" outbound), that handler needs `getLastUserLanguageFromDb` per the M009 first-Sunday lesson.
- **Sub-commands under `/profile` (e.g., `/profile jurisdictional`, `/profile history`).** ANTI-6 in REQUIREMENTS.md explicitly excludes profile-editing sub-commands. Read-only sub-commands (e.g., dimension-specific drill-down) are M013 candidates if Greg's usage suggests friction with the 5-reply default.
- **DIFF-3 user-facing time-series profile history.** M013/M014 per REQUIREMENTS.md line 48. The `profile_history` table is Phase 33's internal idempotency primitive — distinct from this user-facing feature.
- **DIFF-4 per-profile Sonnet-generated narrative summaries.** v2.5.1 candidate. M010 ships structured fields only.

</deferred>

<code_context>
## Codebase Context (from scout pass)

### Reusable assets
- **`buildSystemPrompt` declaration** (`src/chris/personality.ts:94-177`): full body present; lines 100-149 mode switch is the substitution surface for `operationalProfiles`; lines 84-92 ACCOUNTABILITY overload comment must be preserved verbatim
- **Pure-function prompt-template substitution** (`personality.ts:106-148`): Each mode replaces `{pensieveContext}` and `{relationalContext}` via `.replace()`; Plan 35-02 adds a third placeholder OR prepends the block to `contextValue` before substitution — D-07 locks "ABOVE `{pensieveContext}`" (prepend strategy preserves the existing template literals untouched)
- **Known Facts injection precedent** (`personality.ts:156-159`): `if (mode === 'JOURNAL' || mode === 'INTERROGATE') prompt += '\n\n' + buildKnownFactsBlock()` — same shape Plan 35-02 mirrors for Operational Profile injection in REFLECT/COACH/PSYCHOLOGY
- **Localized handler MSG-map pattern** (`src/bot/handlers/summary.ts:56-82`): EN/FR/RU keyed map for usage messages, error messages, section labels; Plan 35-03 mirrors this shape for `/profile`
- **`getLastUserLanguage` reader** (`src/chris/language.ts`): in-memory session cache; user-initiated handler context; same `langOf(...)` narrow-to-Lang helper pattern (`summary.ts:44-47`) reused
- **Grammy `bot.command(...)` registration** (`src/bot/bot.ts:24-34`): same `as any` pattern (Grammy type defs are loose); Plan 35-03 adds one line
- **`OperationalProfiles` reader** (`src/memory/profiles.ts:172-180`): Phase 33 shipped; never-throw; per-profile null on DB error; Phase 35 consumes — no edits to the read path itself
- **`ProfileRow<T>` shape with `lastUpdated`** (`src/memory/profiles.ts:41-46`): provides everything D-10 staleness gate needs (timestamp comparison); D-09 confidence gate also reads from this shape
- **Per-dimension type imports** (`src/memory/profiles/schemas.ts`): `JurisdictionalProfileData`/`CapitalProfileData`/`HealthProfileData`/`FamilyProfileData` snake_case shapes the formatter accesses field-by-field

### Integration points
- **`src/chris/personality.ts:94`** — signature changes from `(mode, pensieveContext?, relationalContext?, language?, declinedTopics?)` to `(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)`. ChrisContextExtras exported.
- **`src/chris/personality.ts:106-148`** — mode-switch substitutions extend to inject `extras.operationalProfiles` for REFLECT/COACH/PSYCHOLOGY (prepend to `contextValue` before the `.replace('{pensieveContext}', …)` call).
- **`src/chris/personality.ts:161-174`** — language directive and declined-topics injection read from `extras.language` and `extras.declinedTopics` instead of positional args.
- **8 call sites** — see D-06; each migrates positional args to extras shape.
- **`src/memory/profiles.ts`** — add `PROFILE_INJECTION_MAP` named constant + `formatProfilesForPrompt(profiles, mode)` function (Plan 35-02). No edits to `getOperationalProfiles()`.
- **`src/bot/handlers/profile.ts`** — new file; exports `handleProfileCommand` (handler) + `formatProfileForDisplay` (pure function); both consumed by tests in `__tests__/profile.golden.test.ts` and `__tests__/profile.test.ts`.
- **`src/bot/bot.ts`** — one new line: `bot.command('profile', handleProfileCommand as any)` between `/summary` and the generic text handler.

### Patterns to follow
- **Conventional commits**: `refactor(35-01): buildSystemPrompt accepts ChrisContextExtras across all call sites (SURF-01, HARD CO-LOC #M10-4)`, `feat(35-02): REFLECT/COACH/PSYCHOLOGY inject operational profiles via PROFILE_INJECTION_MAP (SURF-02)`, `feat(35-03): /profile command + formatProfileForDisplay + golden snapshot (SURF-03/04/05, HARD CO-LOC #M10-5)`.
- **HARD CO-LOC enforcement**: gsd-plan-checker MUST refuse: (a) Plan 35-01 split into multiple plans (M10-4 violation — `buildSystemPrompt` partial refactor breaks build); (b) Plan 35-03 if `/profile` handler, `formatProfileForDisplay`, and golden test are split across plans (M10-5 violation).
- **Plain text only on `/profile`**: no `parse_mode`. D-17 + D031 policy.
- **Second-person framing in formatter**: golden snapshot test catches third-person regressions per M010-07. NO "Greg's…" / "He…" allowed in formatter output.
- **No live LLM calls in Phase 35 tests** per D-32 and D-30-03. Mock `anthropic.messages.create` if mode-handler integration tests touch the SDK boundary.
- **OQ-3 pre-work gate (lightweight in Plan 35-01)**: re-run `grep -rn "buildSystemPrompt(" src/` immediately before writing the refactor — confirm the 8 call sites from D-06 still match (defends against drift between context-gathering and execution).

</code_context>

<test_strategy>
## Test Strategy

Three layers ship across the 3 plans (no live Sonnet calls — that's Phase 36 PTEST-05):

1. **Regression coverage (Plan 35-01)** — Existing `src/chris/__tests__/personality.test.ts` (230 lines, 31 `buildSystemPrompt` sites) and `src/chris/__tests__/engine.test.ts` (16 sites) continue to pass post-refactor with no new tests added. The existing tests validate the new signature by virtue of their migrated call sites.

2. **Mode-handler injection tests (Plan 35-02)** — Per-mode test files extended:
   - **Positive (3 tests)**: `reflect.test.ts`, `coach.test.ts`, `psychology.test.ts` each assert `getOperationalProfiles` called once and the system prompt contains `## Operational Profile (grounded context — not interpretation)` block above `{pensieveContext}` when profiles are populated. Mock `getOperationalProfiles` with the MOCK_PROFILES fixture.
   - **Negative (5 tests)**: `journal.test.ts`, `interrogate.test.ts`, `produce.test.ts`, `photos.test.ts` each assert `getOperationalProfiles` NOT called and the system prompt does NOT contain the Operational Profile block. Plus a `resolution.test.ts` (ACCOUNTABILITY) negative-injection assertion.
   - **`PROFILE_INJECTION_MAP` unit test**: REFLECT → 4 dimensions, COACH → `['capital', 'family']`, PSYCHOLOGY → `['health', 'jurisdictional']`. Plus a structural test asserting JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY are absent from the map.
   - **`formatProfilesForPrompt` unit tests**: empty string when all profiles null; empty string when in-scope dimensions all zero-confidence; non-empty when at least one in-scope dimension has confidence > 0 (+ health ≥ 0.5 gate); staleness qualifier appears when `last_updated > 21 days`; 500-char truncation when a dimension's render exceeds the cap.

3. **Golden-output snapshot test (Plan 35-03, HARD CO-LOC #M10-5)** — `src/bot/handlers/__tests__/profile.golden.test.ts`:
   - **Inline snapshot suite (16 cases)**: 4 dimensions × 4 cases (null / zero-confidence / populated-fresh / populated-stale) in English via `toMatchInlineSnapshot`. Each case includes the section title, all rendered fields in second-person framing, the localized confidence percentage, and (for the stale case) the localized staleness note.
   - **Language coverage smoke test (2 cases)**: assert FR and RU section labels appear in the expected language for the populated-fresh case (one dimension is sufficient — full snapshot in all 3 languages would balloon to 48 inline snapshots).
   - **Handler integration test** (`profile.test.ts`): mock `getOperationalProfiles` + Grammy `ctx.reply` spy; assert `reply` called exactly 5 times per `/profile` invocation when all profiles populated (4 dimensions + M011 placeholder); assert reply order matches `['jurisdictional', 'capital', 'health', 'family', 'M011 placeholder']`; assert each reply is plain-text (no `parse_mode` argument); assert per-reply localized strings appear; assert graceful fallback when `getOperationalProfiles()` returns all-null.

**Live tests are explicitly excluded** from Phase 35 per D-32 (cost discipline). PTEST-05's 3-of-3 atomic anti-hallucination test ships in Phase 36, dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`. PTEST-05 will assert (against real Sonnet) that the `## Operational Profile` block appears in the REFLECT-mode system prompt AND that Sonnet's response does not assert facts outside the fixture's profile data.

</test_strategy>

<plan_hints>
## Plan Structure Hint

Recommended plan split for Phase 35 (3 plans, matching the REQUIREMENTS SURF-01..05 traceability table at REQUIREMENTS.md:93-97):

- **Plan 35-01: `buildSystemPrompt` signature refactor + atomic call-site migration (HARD CO-LOC #M10-4 anchor)** — `src/chris/personality.ts` refactored signature; `ChrisContextExtras` interface exported; 8 call sites migrated atomically (5 modes + photos + resolution + 2 test files); ACCOUNTABILITY overload preserved verbatim; existing personality.test.ts + engine.test.ts regression tests continue to pass. Satisfies SURF-01. **~3-4 tasks.** Pre-work: confirm OQ-3 call-site inventory (D-06) still matches via `grep -rn "buildSystemPrompt(" src/` immediately before refactor begins; gsd-plan-checker refuses 35-02 if 35-01 is incomplete (M10-4 enforcement).

- **Plan 35-02: Mode-handler injection wiring + PROFILE_INJECTION_MAP + formatProfilesForPrompt** — `src/memory/profiles.ts` adds `PROFILE_INJECTION_MAP` named constant + `formatProfilesForPrompt(profiles, mode)` function; REFLECT/COACH/PSYCHOLOGY mode handlers call `getOperationalProfiles()` + `formatProfilesForPrompt()` and pass result via `extras.operationalProfiles`; 8 mode-handler tests added (3 positive, 5 negative); `PROFILE_INJECTION_MAP` + `formatProfilesForPrompt` unit tests added. Satisfies SURF-02. **~5 tasks.**

- **Plan 35-03: `/profile` command + `formatProfileForDisplay` + golden-output snapshot test + bot registration (HARD CO-LOC #M10-5 anchor)** — `src/bot/handlers/profile.ts` (handler + pure formatter); `src/bot/handlers/__tests__/profile.golden.test.ts` (16-case inline snapshot suite + 2 FR/RU language coverage cases); `src/bot/handlers/__tests__/profile.test.ts` (handler integration test); `src/bot/bot.ts` adds `bot.command('profile', handleProfileCommand as any)`. Satisfies SURF-03, SURF-04, SURF-05. **~5 tasks.** gsd-plan-checker refuses if `formatProfileForDisplay` + golden test + handler are split across plans (M10-5 enforcement).

**Total: ~13-14 tasks across 3 plans.** Plan 35-01 is mechanical-but-broad (atomic 8-site refactor); Plan 35-02 is novel-but-bounded (3 handler edits + 1 new constant + 1 new function + 9 tests); Plan 35-03 is the most novel (new file + new golden suite + Grammy registration).

**Pre-work gates:**
- **Before Plan 35-01:** re-run `grep -rn "buildSystemPrompt(" src/` and confirm D-06's 8 call sites match (defends against new call-site introduction between 2026-05-13 and execution date). Document any deviation inline before proceeding.
- **Before Plan 35-02:** verify Phase 33's `getOperationalProfiles()` returns a non-null shape for at least the jurisdictional and capital seeded rows (ground-truth seed should populate them at 0.2-0.3 confidence per Phase 33 D-10); if both return null, the integration test cannot exercise the populated-path code (degrades to all-null negative case only).
- **Before Plan 35-03:** confirm the first Sunday 22:00 Paris cron has fired (2026-05-17 22:00 Paris) OR proceed with the MOCK_PROFILES fixture as the source of truth (Phase 35 doesn't strictly require live cron output — the golden test mocks the data).

**Open Questions for Phase 35 planner to confirm:**
- **OQ-3 reconfirmation:** D-06 lists 8 call sites at 2026-05-13. Planner re-runs the grep immediately before Plan 35-01 begins.
- **`/profile` placeholder text for M011 dimension:** D-19 says "Psychological profile: not yet available — see M011" — planner finalizes exact phrasing including FR/RU translations during Plan 35-03 task expansion.
- **`MOCK_PROFILES` fixture content:** D-27 specifies 4 cases per dimension; planner finalizes the exact field values per case (planner may borrow from Phase 33 ground-truth seed for the "populated-fresh" case and synthesize plausible values for "populated-stale").

</plan_hints>

---

*Phase: 35-surfaces*
*Context gathered: 2026-05-13*
