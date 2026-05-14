# Phase 46: FR/RU Localization Comprehensive — Context

**Gathered:** 2026-05-14
**Mode:** `--auto` (single-pass, recommended-option selection — auto-selected all gray areas)
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the six v2.6.1 BLOCKER/WARNING-class localization defects surfaced by the Phase 26/28/29/39 code-review sweep. Each defect is a user-facing EN string that reaches Greg's FR/RU Telegram surface on a fire path that already has a viable language signal (`getLastUserLanguage` in-memory or `getLastUserLanguageFromDb` for cron contexts):

1. **L10N-01** — `/profile` Telegram output: 21 EN-only sites in `src/bot/handlers/profile.ts` (qualifier strings at 705-707, HEXACO dim labels at 715-720, Schwartz dim labels at 728-737, `/ 5.0` + `confidence` template tokens at 791 + 806). Folds in v2.5 WR-02 EN-token leak class.
2. **L10N-02** — `WEEKLY_REVIEW_HEADER` (`src/rituals/weekly-review.ts:68` + consumption at `:621`). Currently a single English `const`; first M009 weekly fire (2026-05-10 20:00 Paris) shipped EN header above FR body.
3. **L10N-03** — Weekly-review FR regex `qu['e]?est-ce que` in `INTERROGATIVE_REGEX` (`src/rituals/weekly-review.ts:93-94`; also re-exercised in `weekly-review-sources.ts` via `stage1Check`). Currently matches `queest-ce que` gibberish AND misses curly-apostrophe `qu'est-ce que` keyboards produce on macOS.
4. **L10N-04** — Daily journal `PROMPTS` array in `src/rituals/journal.ts:51-58`. Six EN literal prompts sent via `bot.api.sendMessage` at fire time with no language consultation.
5. **L10N-05** — `qualifierFor` duplicated at `src/memory/profiles.ts:675-679` (prompt-side, byte-identical) and `src/bot/handlers/profile.ts:704-708` (display-side, renamed `qualifierForPsych`). Both return EN-only band strings.
6. **L10N-06** — `TEMPLATED_FALLBACK_EN` at `src/rituals/weekly-review.ts:357-360`. v2.4 deliberate EN-only deferral; the v2.4 carry-forward comment block IS the boundary marker. Returned from `generateWeeklyObservation` at retry-cap exhaustion regardless of `language` already plumbed into `WeeklyReviewPromptInput`.

Out of scope: any new locale beyond EN/FR/RU; replacing the `franc` detection layer; persisting locale per-user in DB (DB-backed fallback already exists for cron via `getLastUserLanguageFromDb`); RU dimension labels in scientific contexts where transliteration vs Cyrillic naming is unsettled (use the existing per-MSG translation register established by `MSG.psychologicalSections.*.sectionTitle`).

</domain>

<decisions>
## Implementation Decisions

### Locale-detection layer — location & shape

- **D-01:** **No new locale layer.** Reuse the existing `src/chris/language.ts` module — it already exposes `getLastUserLanguage` (in-memory, user-initiated context), `getLastUserLanguageFromDb` (cron context, M009 first-Sunday lesson), `langOf` narrowing helper, and the `Lang = 'English' | 'French' | 'Russian'` union. Do NOT create `src/lang/`, `src/i18n/`, `src/chris/locale/`, or any sibling. The existing module is the canonical detection surface; this phase consumes it from new call sites only.
- **D-02:** Rationale for rejecting alternatives:
  - **`src/i18n/` package** — creates a parallel detection surface that drifts from `chris/language.ts`. Two sources of truth for the same `Lang` union is the exact drift pattern L10N-05 closes; not creating a second instance of it. Rejected.
  - **Inline per-handler `detectLanguage` calls** — every consumer would re-grow `franc` invocations and re-implement the LANG-02 short-message-stickiness rule. Defeats the M009 first-Sunday lesson (DB-backed fallback exists for a reason). Rejected.
  - **A typed schema framework (i18next, zod-based)** — overkill for 3 languages and ~50 strings. No pluralization rules, no date/number formatting library needed beyond the existing `DATE_LOCALES` in profile.ts. Rejected.

### String storage — register shape

- **D-03:** **TypeScript `const` map per locale, co-located with the call site.** Follow the established `ACKNOWLEDGMENTS` pattern (`src/chris/refusal.ts:180-184`), the `DECLINE_MESSAGES` pattern (`src/bot/handlers/voice-decline.ts:22-32`), and the most authoritative precedent — the `MSG` object at `src/bot/handlers/profile.ts:120-443` (Phase 39 D-19, 35-PATTERNS.md MSG-map shape). New strings land in the same `MSG`-shape, branched by `Lang`, in the same file as the consumer (or in a per-feature shared module — see D-04). NO JSON files (Greg signs off on TS-typed objects in code review, not opaque JSON), NO module-per-locale dirs (creates churn proportional to locale count, not string count — wrong axis).
- **D-04:** Cross-file shared registers go in `src/chris/locale/strings.ts` ONLY for strings consumed in 2+ files (e.g., qualifier bands consumed by both prompt-side `profiles.ts` AND display-side `profile.ts` — L10N-05's natural home). Single-file strings stay co-located. This is the same boundary discipline the M009/M010 codebase already uses for `DATE_LOCALES` (profile.ts-local) vs `LANGUAGE_NAMES` (language.ts-shared).
- **D-05:** **Shape lock — `Record<Lang, T>` with `Lang` from `src/chris/language.ts`.** Every new locale map uses the existing union; no `Record<string, ...>` with runtime fallback to English. The `langOf` helper handles narrowing at the boundary. Compile-time exhaustiveness is the regression detector when a future locale (e.g., German) is added — every map becomes a TS error that must be filled in.

### Translation source — author + review

- **D-06:** **Hybrid — Sonnet-generated FR/RU candidates from EN source strings, then Greg reviews/approves at `/gsd-verify-work` before milestone-archive.** The Phase 39 D-19 pattern explicitly used "machine-translate-quality FR + RU; reviewed at /gsd-verify-work; v2.6.1 polish pass replaces with proper translations without snapshot churn" — Phase 46 IS that v2.6.1 polish pass. Sonnet drafts each string in FR + RU; the planner stages them in a translation table; Greg reads through during verify-work and corrects any tonal/idiomatic misses. Pre-existing translations already in `MSG` (profile.ts, voice-decline.ts) are kept verbatim unless Greg flags them — no churn on already-shipped strings.
- **D-07:** Tone register matches the existing surface:
  - **FR:** `tu`-form (informal, second-person singular). Matches profile.ts (`Ta phase FI`, `Tes traitements`), voice-decline.ts (`essaie l'icône`), refusal.ts (`Compris — on passe à autre chose`).
  - **RU:** `ты`-form (informal). Matches profile.ts (`Твой статус`, `Ты сейчас в`), voice-decline.ts (`попробуй`), refusal.ts (`Понял — идём дальше`).
- **D-08:** Reviewer's BL-03 suggested copy in `29-REVIEW.md:60-71` is the seed for L10N-02:
  ```ts
  const WEEKLY_REVIEW_HEADER: Record<Lang, string> = {
    English: 'Observation (interpretation, not fact):',
    French: 'Observation (interprétation, pas un fait) :',
    Russian: 'Наблюдение (интерпретация, не факт):',
  };
  ```
  Reviewer's WR-01 suggested copy in `29-REVIEW.md:80` is the seed for L10N-06:
  ```ts
  const TEMPLATED_FALLBACK: Record<Lang, { observation: string; question: string }> = {
    English: { observation: 'Reflecting on this week.', question: 'What stood out to you about this week?' },
    French: { observation: 'Réflexion sur cette semaine.', question: "Qu'est-ce qui t'a marqué cette semaine ?" },
    Russian: { observation: 'Размышление об этой неделе.', question: 'Что вам запомнилось на этой неделе?' },
  };
  ```
  Both verbatim from reviewer; Greg confirms at verify-work.

### Phase 41 ADJ-03 dependency resolution

- **D-09:** **Phase 46 lands the shared locale infrastructure FIRST; Phase 41 consumes it (D-04's `src/chris/locale/strings.ts` for any cross-file register, plus the in-file `MSG` pattern for adjustment-dialogue-local strings).** Per ROADMAP.md Phase 46's "Depends on: Phase 41 — ADJ-03 lives in the adjustment-dialogue cluster; the shared locale infrastructure built in this phase is consumed by Phase 41's localization criterion as well — sequence Phase 46 to land the infra, but if Phase 41 ships urgently first, ADJ-03 may be split out and merged into this phase's surface". Operationally: Phase 41 is running in parallel (live-bug priority); the contract between them is:
  - **Phase 46 ships first / before Phase 41 reaches ADJ-03 task:** Phase 41 imports `langOf` + `Lang` from `src/chris/language.ts` (already shipped) and adopts the `MSG`-shape pattern locally in `adjustment-dialogue.ts`. No new infra needed because D-01 = "reuse existing layer".
  - **Phase 41 ships ADJ-03 first (live bug forced merge order):** Phase 41 lands a minimal `MSG`-shape in `adjustment-dialogue.ts` covering the 8 sendMessage sites + Haiku judge prompt — exactly the same shape this phase would land. Phase 46 then EXPANDS by adopting the same shape across journal.ts, weekly-review.ts, profile.ts. No retrofit needed.
  - **Either ordering works** because D-01 says no new locale layer exists — both phases consume the already-shipped `Lang` + `langOf` + `getLastUserLanguage[FromDb]` API. ADJ-03 is a SURFACE adoption of an existing infrastructure, not a NEW infrastructure dependency.
- **D-10:** Cross-phase coordination point: if Phase 41 lands a Haiku-judge-prompt locale variant for ADJ-03 (the Haiku prompt itself, not just user-facing copy), Phase 46's L10N-04 (journal prompts) and L10N-06 (templated fallback) follow the same prompt-localization pattern — i.e., the prompt text shown TO Greg is localized; the SYSTEM prompt sent to the LLM stays in English unless the model's output language must match (then the system prompt specifies the output locale). This is the same discipline `WeeklyReviewPromptInput` already carries (`language` field plumbed through, system prompt remains EN with a `Write the observation in ${language}.` directive).

### L10N-05 — `qualifierFor` consolidation ownership

- **D-11:** **Canonical location: `src/chris/locale/strings.ts`** (new file per D-04). Both `src/memory/profiles.ts` and `src/bot/handlers/profile.ts` import from there. Rationale:
  - Neither current location is a natural canonical owner — `profiles.ts` is the prompt-side label register (operational, not psychological), and `profile.ts` is the display-side handler. The function is genuinely cross-cutting locale data, not memory-domain logic and not display-domain logic.
  - `chris/locale/strings.ts` is the natural home: it is the same boundary the existing `chris/language.ts` already occupies (locale detection lives there → locale STRINGS live alongside). Pattern matches how `chris/refusal.ts` co-locates detection + acknowledgments.
- **D-12:** Signature: `qualifierFor(confidence: number, lang: Lang): string` — takes a `Lang` parameter. The two existing copies (currently `(c: number): string`) become thin re-exports for the deprecation transition. After migration, both call sites pass `lang` explicitly. The reviewer's WR-07 suggestion (option-a: shared module; option-b: byte-equality test) — choose option-a per the planner's standard "single source of truth" preference. Drop the byte-equality test in favor of a single canonical implementation.
- **D-13:** Band thresholds (≥0.6 substantial, ≥0.3 moderate, else limited) are locked verbatim per CONTEXT.md D-07 of Phase 35 + Phase 39. Re-banding requires a separate phase + CONTEXT update — out of scope for this consolidation.

### L10N-03 — FR regex apostrophe normalization

- **D-14:** **Pre-input NFC unicode normalize + canonical apostrophe replacement.** Add a `normalizeForInterrogativeCheck(s: string): string` helper that runs:
  ```ts
  s.normalize('NFC').replace(/[‘’ʼ′]/g, "'");
  ```
  Then `stage1Check` and any FR regex consumer runs against the normalized form. Regex stays simple — `qu'est-ce que` matches only the canonical straight apostrophe (U+0027) AFTER normalization.
- **D-15:** Rationale for rejecting "accept both in regex" alternative: a character class `qu['’]?est-ce que` works for this regex but every FUTURE FR pattern in the codebase (refusal.ts FR_PATTERNS, decisions/triggers-fixtures.ts ABORT_PHRASES_FR, future weekly-review FR regex extensions) needs the same fix. Centralizing the normalization at the input boundary closes the entire class. The reviewer's WR-03 fix `qu['’]?est-ce que` is the minimal patch but D-14 is the systemic fix; Phase 46 ships the systemic fix.
- **D-16:** Also fix the existing bug — `qu['e]?est-ce que` matches `queest-ce que` gibberish. After D-14's normalization the regex becomes `qu'?est-ce que` (no `e` in the class). One-character regex edit + the normalize helper.
- **D-17:** Helper location: `src/chris/locale/strings.ts` co-located with `qualifierFor` and the new FR/RU registers. Single import from weekly-review-sources.ts and refusal.ts (refusal.ts may opt-in later — not in this phase's scope).

### Test strategy

- **D-18:** **Golden-output snapshots per locale, run against real fixture rows from a real Docker postgres.** Three snapshot variants per consumer (EN/FR/RU); diffs surface in `git diff` review at `/gsd-verify-work`. Pattern follows existing `profile.golden.test.ts` (Phase 35 SURF-05 / M010-07 regression gate). Snapshot file shape: `profile.golden.test.ts.snap` already has EN snapshots; this phase adds FR + RU sibling snapshots. NO runtime locale-injection harness — D-04's `MSG`-shape pattern is already injection-tested via the existing `formatProfileForDisplay(dimension, profile, lang)` signature. Pass `lang: 'French' | 'Russian'` to the formatter, snapshot the result.
- **D-19:** Per the user's "Always run full Docker tests" memory rule — every snapshot test runs against the live local Docker postgres. NO mock DB. The fixture rows come from the same primed fixtures the v2.6.1 milestone gate consumes (M010 + M011); locale snapshots run during normal `pnpm test` + during CI.
- **D-20:** Regression detector for L10N-04 (journal prompts): the existing prompt-rotation unit tests (`journal.test.ts` covering `chooseNextPromptIndex`) get a per-locale assertion that `fireJournal` sends a string from the correct-locale PROMPTS array. NOT a snapshot — the prompt rotation is RNG-dependent so seeded inputs assert per-locale content.
- **D-21:** Regression detector for L10N-02 (header) + L10N-06 (templated fallback): unit tests in `weekly-review.test.ts` already assert `userFacingMessage` starts with `WEEKLY_REVIEW_HEADER`; this phase EXPANDS those assertions to three variants (`startsWith(WEEKLY_REVIEW_HEADER.English)` / `.French` / `.Russian`) keyed on `language`. The fallback path gets a parallel three-variant test.
- **D-22:** Regression detector for L10N-03 (FR regex normalization): unit tests in `weekly-review.test.ts` add cases for curly-apostrophe `qu’est-ce que`, straight-apostrophe `qu'est-ce que`, and gibberish `queest-ce que` — assert the first two pass `stage1Check` (single interrogative match) and the gibberish case is NOT matched. Closes the WR-03 false-match class.

### Sequencing within Phase 46

- **D-23:** Plans (planner decides exact split — recommended):
  - **Plan 46-01:** L10N-05 + locale-strings infrastructure (`src/chris/locale/strings.ts` created with `qualifierFor` + `LANG_QUALIFIER_BANDS` + the FR/RU registers needed cross-file). Phase 41 can import from here whether it ships before or after.
  - **Plan 46-02:** L10N-01 (`/profile` 21 sites localized; existing `MSG` extended with `psychologicalScoreLine` template + `confidenceLabel` already mostly present via `MSG.confidence`). Golden snapshots added for FR + RU.
  - **Plan 46-03:** L10N-02 (`WEEKLY_REVIEW_HEADER` → `Record<Lang, string>`) + L10N-06 (`TEMPLATED_FALLBACK` → `Record<Lang, ...>`) + L10N-03 (normalize helper + regex tightening). All in `weekly-review.ts` / `weekly-review-sources.ts` cluster.
  - **Plan 46-04:** L10N-04 (journal PROMPTS → `Record<Lang, readonly string[]>` with same v1 shuffled-bag rotation; `fireJournal` reads `getLastUserLanguageFromDb` for cron context). Locale-aware prompt-bag invariants preserved (PROMPT_SET_VERSION bumped to v2 if rotation invariants change — verify with the planner).

### Claude's Discretion

- Exact file split inside `src/chris/locale/strings.ts` vs leaving per-domain registers co-located. Planner may choose to put `WEEKLY_REVIEW_HEADER` map in weekly-review.ts directly (single consumer) rather than the shared file — D-04 boundary applies.
- Whether to bump `PROMPT_SET_VERSION` from `v1` to `v2` for the locale-aware journal PROMPTS. If the bag indices remain integer indices into a SHARED array shape (just localized text), no bump needed. If the array becomes per-locale with different lengths, bump required. Planner determines by reading the bag-rotation invariants in `chooseNextPromptIndex`.
- Whether L10N-03's `normalizeForInterrogativeCheck` should also normalize French ligatures (`œ`, `æ`) — not in the documented attack surface but trivial to fold in. Planner may include if zero-cost.

</decisions>

<specifics>
## Specific Ideas

- **`MSG`-shape verbatim pattern** — `src/bot/handlers/profile.ts:120-443` is the gold-standard register. Every new register in this phase mirrors that shape:
  ```ts
  const MSG = {
    feature: {
      English: 'text',
      French: 'texte',
      Russian: 'текст',
    },
  } as const;
  ```
  Functions go inline: `confidence: { English: (n) => `confidence ${n}%`, French: (n) => `confiance ${n}%`, Russian: (n) => `уверенность ${n}%` }`.
- **Tone reference for new FR strings** — the existing `tu`-form throughout profile.ts (`Ta`, `Tes`, `Tu es`) sets the register. Adjustment-dialogue (Phase 41's surface) follows the same register; this phase locks the convention for journal + weekly-review.
- **Don't break existing translations** — `MSG.confidence`, `MSG.dimensionHint`, `MSG.staleNote`, all 4 `MSG.fields.*`, all 3 `MSG.psychologicalSections.*` already ship FR + RU. They are GOOD enough for this phase — no churn. L10N-01's 21 sites are SPECIFICALLY the qualifier strings + dim labels that were Phase 39 D-20 explicit-deferrals + the `/ 5.0` + `confidence` score-line tokens. Anything already localized in MSG stays untouched unless Greg flags it.
- **D-08 verbatim text** — both reviewer-suggested strings are pre-locked seeds; the planner doesn't need to invent these.
- **`getLastUserLanguageFromDb` is the cron-context API** — M009 first-Sunday lesson: in-memory `sessionLanguage` is empty on first cron fire after process restart. Journal fires daily at 21:00 Paris (cron context); weekly-review fires Sunday 20:00 Paris (cron context). Both MUST use `getLastUserLanguageFromDb`, not `getLastUserLanguage`. Adjustment-dialogue (Phase 41) is also cron-fired (the every-minute scheduler) — same rule applies. Default fallback when DB returns null: `'French'` (Greg's primary locale per project memory + ROADMAP Phase 41 success criterion).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements

- `.planning/REQUIREMENTS.md` §L10N-01..06 — the 6 lock requirements (lines 51-56)
- `.planning/ROADMAP.md` §"Phase 46: FR/RU Localization Comprehensive" — goal + success criteria + Phase 41 dependency note (lines 134-146)
- `.planning/milestones/v2.6.1-REVIEW-SYNTHESIS.md` §T6 — cluster-level scope + line-by-line site catalog (lines 71-83)

### Code-review source findings

- `.planning/milestones/v2.4-phases/26-daily-voice-note-ritual/26-REVIEW.md` §WR-03 — journal PROMPTS EN-only defect, recommended fix path (lines 79-84)
- `.planning/milestones/v2.4-phases/28-skip-tracking-adjustment-dialogue/28-REVIEW.md` §BL-03 — adjustment-dialogue EN-only sites catalog (lines 89-103). NOTE: Phase 41 implements ADJ-03 against this finding; Phase 46 expands the same pattern.
- `.planning/milestones/v2.4-phases/29-weekly-review/29-REVIEW.md` §BL-03 + §WR-01 + §WR-03 — `WEEKLY_REVIEW_HEADER` EN-leak, `TEMPLATED_FALLBACK_EN` EN-leak, FR regex bug (lines 55-94 with verbatim seed strings)
- `.planning/milestones/v2.6-phases/39-psychological-surfaces/39-REVIEW.md` §WR-01..07 + §"Comprehensive EN-only Literals" table — 21-site catalog with file:line for every leak (lines 41-118)

### Implementation surfaces (read before editing)

- `src/chris/language.ts` — existing locale detection layer. The `Lang` union (`'English' | 'French' | 'Russian'`), `langOf` narrowing helper, `getLastUserLanguage` (in-memory), `getLastUserLanguageFromDb` (cron). This module is the canonical detection surface — DO NOT duplicate.
- `src/chris/refusal.ts:178-193` — `ACKNOWLEDGMENTS` register + `generateRefusalAcknowledgment` consumer. The pre-existing locale-register pattern; new registers in this phase mirror its shape.
- `src/bot/handlers/voice-decline.ts:22-49` — `DECLINE_MESSAGES` + `LANG_TO_KEY` register pattern. Another precedent for the `MSG`-shape.
- `src/bot/handlers/profile.ts:120-443` — `MSG` register (gold-standard reference for shape). `qualifierForPsych` at `:704-708` is L10N-05's display-side copy. `HEXACO_DIM_DISPLAY_LABELS` at `:714-721` + `SCHWARTZ_DIM_DISPLAY_LABELS` at `:727-738` + the score-line templates at `:791` + `:806` are the L10N-01 surfaces.
- `src/memory/profiles.ts:675-679` — `qualifierFor` (prompt-side, byte-identical duplicate of display-side). L10N-05's other copy. `HEXACO_DIM_LABELS` at `:684-691` and `SCHWARTZ_DIM_LABELS` at `:693+` are the prompt-side counterparts — NOT in scope for this phase (prompt-side stays English per D-08 of Phase 35; only display-side gets FR/RU).
- `src/rituals/weekly-review.ts:68` — `WEEKLY_REVIEW_HEADER` constant. L10N-02 surface. Consumption at `:621` builds `userFacingMessage`.
- `src/rituals/weekly-review.ts:93-94` + `:114-119` — `INTERROGATIVE_REGEX` and `stage1Check`. L10N-03 surface.
- `src/rituals/weekly-review.ts:357-360` + `:472` — `TEMPLATED_FALLBACK_EN` + return site. L10N-06 surface.
- `src/rituals/weekly-review-sources.ts` — FR regex consumer (cross-reference per requirements doc). Verify whether this file also runs the curly-apostrophe surface; the normalize helper from D-14 may need to be wired here too.
- `src/rituals/journal.ts:51-58` — `PROMPTS` array + `PROMPT_SET_VERSION`. L10N-04 surface. `fireJournal` at lines 289-365 (per file structure comment) is the consumer that sends prompt text via `bot.api.sendMessage`.
- `src/decisions/triggers-fixtures.ts:68-70` — `ABORT_PHRASES_EN/FR/RU` shared-fixture pattern. The CAP-01 D-03 cardinality CI guard. Reference for how cross-locale equivalence is asserted at compile time.

### Test surfaces

- `src/bot/handlers/__tests__/profile.test.ts` — existing handler tests. FR + RU snapshot variants get added here (or in a sibling `profile.golden.test.ts` per Phase 35 D-15 precedent).
- `src/rituals/__tests__/weekly-review.test.ts` — existing weekly-review tests at `:121-127` ("user-facing message starts with WEEKLY_REVIEW_HEADER"). Three-variant expansion per D-21.
- `src/rituals/__tests__/journal.test.ts` (verify path) — existing journal/PROMPTS tests. Per-locale assertion expansion per D-20.
- `src/chris/__tests__/language.test.ts` — language-detection tests. The detection layer itself isn't modified — these tests are NOT changed by this phase.

### Project-level discipline

- `.planning/codebase/CONVENTIONS.md` — module layout conventions; locale module discipline.
- `.planning/codebase/ARCHITECTURE.md:31, 35-36, 109, 232, 340` — references to `src/chris/language.ts` as the existing detection layer + reply-path fallback discipline.
- `.planning/PROJECT.md` — append-only Pensieve invariant; the `MSG`-shape locale register pattern is project-canonical (Phase 35 D-19 lock + Phase 39 inheritance).
- User memory: `feedback_always_run_docker_tests.md` — never skip integration tests; locale snapshot tests run against real Docker postgres.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/chris/language.ts` detection module** — fully shipped. `getLastUserLanguage` (in-memory), `getLastUserLanguageFromDb` (cron-context, Phase 32 follow-up 2026-05-11), `langOf` narrowing, `Lang` union. Every new locale call site imports from here; no duplication.
- **`MSG`-shape register pattern** — gold-standard at `src/bot/handlers/profile.ts:120-443`. Already typed-as-`Record<Lang, T>` (or its nested equivalent), already exercised in production, already has FR + RU translations for ~40 strings. New registers extend this shape.
- **`ACKNOWLEDGMENTS` + `generateRefusalAcknowledgment` pattern** (`refusal.ts:180-193`) — smaller-scale locale register precedent. Demonstrates fallback-to-English when `Lang` lookup misses (use `?? ACKNOWLEDGMENTS['English']!`).
- **`DATE_LOCALES` BCP-47 map** (`profile.ts:104-108`) — already maps `Lang` → date locale tag. Reuse for any date-formatting needs in localized strings (e.g., weekly-review header date insertion).
- **`generateWeeklyObservation` plumbing** — `WeeklyReviewPromptInput` already carries `language` per `weekly-review-prompt.ts`. The fallback branch (L10N-06) and header (L10N-02) just need to consume the value that's already flowing.
- **CAP-01 cardinality discipline** (`decisions/triggers-fixtures.ts:25`) — `EN_POSITIVES.length === FR_POSITIVES.length === RU_POSITIVES.length === 4` CI guard. The same discipline applies to per-locale arrays (e.g., L10N-04 journal PROMPTS where all three locales must have 6 prompts).
- **`profile.golden.test.ts` snapshot pattern** (Phase 35 SURF-05 / M010-07) — golden-output test framework already in use; FR + RU snapshots slot in alongside the existing EN snapshots.

### Established Patterns

- **In-memory cache for user-initiated handlers, DB-backed for cron handlers** (M009 first-Sunday lesson) — `/profile` uses `getLastUserLanguage`; weekly-review + journal + adjustment-dialogue use `getLastUserLanguageFromDb`. This phase preserves the boundary; no handler crosses it.
- **System prompts stay EN, output locale is directed via `Write in ${language}` system-prompt clause** — established in `weekly-review-prompt.ts`. L10N-04 + L10N-06 do NOT translate LLM system prompts; they translate user-facing prompt TEXT only.
- **Cardinality CI guard** — when an array is replicated across locales (`ABORT_PHRASES_*`, journal `PROMPTS`), a `.length` equality assertion runs at module load / in tests. The L10N-04 PROMPTS replication adopts this pattern.
- **`as const` register lock** — every existing `MSG` / `DECLINE_MESSAGES` / `ACKNOWLEDGMENTS` is declared `as const`. TS narrowing prevents accidental string-literal-widen-to-string regressions at the consumer.
- **Fallback to English** — every locale lookup defaults to English when the `Lang` value is missing or unexpected (matches `langOf` behavior). Pattern: `MSG.feature[lang] ?? MSG.feature['English']`. Avoids runtime throws on locale lookup misses.

### Integration Points

- **Phase 41 ADJ-03** consumes the same `Lang` + `langOf` + `getLastUserLanguageFromDb` API as this phase. No infrastructure handshake required — both phases adopt the existing layer independently. D-09 documents the parallel-merge ordering options.
- **Phase 47 Display Polish** depends on Phase 46 (per ROADMAP) — DISP-02 cross-validation observations need the locale-aware `qualifierFor` from L10N-05.
- **No DB migration required** — locale storage is in-code constants. The `psychological_profile_history` data_consistency column added by Phase 43 is unrelated.
- **No prompt-content schema change** — `WeeklyReviewSchema` / `WeeklyReviewSchemaV4` continue to accept `observation` + `question` strings; the strings just happen to be in FR/RU. Sonnet's system prompt already directs output language via `language` field.
- **PROMPT_SET_VERSION bag-rotation invariant** — the shuffled-bag stores integer indices into a fixed-length array. If L10N-04 changes the array shape to a `Record<Lang, ...>`, indices remain valid only if all locales have the same length (CAP-01 cardinality guard). Otherwise PROMPT_SET_VERSION bumps to `v2` and existing bag state is invalidated. D-23 calls this out for the planner.

</code_context>

<deferred>
## Deferred Ideas

- **Replacing `franc` with a per-user persisted locale preference** — would close the short-message-stickiness edge case more cleanly but requires a DB schema change + onboarding flow. Out of v2.6.1 cleanup scope; M013 (Monthly/Quarterly Rituals) is a more natural home for user-preference plumbing.
- **Localizing prompt-side `HEXACO_DIM_LABELS` + `SCHWARTZ_DIM_LABELS` in `src/memory/profiles.ts`** — these labels are shown TO Sonnet in the operational + psychological inference prompts, not to Greg. They stay English by design (Sonnet's English-trained vocabulary works best with English label keys). Cross-language testing not needed.
- **Prompt rotation bag invariants across locale switching** — if Greg switches from FR to RU mid-cycle (rare; in practice he's mostly FR), the bag-rotation guarantees become less meaningful. Not solved in this phase; the prompt rotation is a per-user state, locale is a per-message detection. Future work if Greg's locale starts oscillating.
- **Localizing the v1 templated fallback's `isFallback: true` metadata field** — the field name itself is observability metadata, not user-facing. Stays English.
- **CIRC-01 Schwartz circumplex ordering + CROSS-VAL-01 HEXACO×Schwartz cross-validation** — Phase 47 surface; depends on Phase 46 strings but is not in scope here.
- **Refactoring `src/chris/refusal.ts` `FR_PATTERNS` to use the same NFC-normalize input from D-14** — defense-in-depth follow-on; the existing FR_PATTERNS don't have a curly-apostrophe defect documented in any REVIEW.md, so leaving them as-is. Picked up later if a real refusal regression emerges.
- **`ru-RU` Cyrillic-vs-transliteration register decisions for psychological dim labels** — the Russian translations for "Honesty-Humility" etc. are open (`Честность-Скромность` vs `Honesty-Humility` transliterated). Greg signs off at verify-work per D-06.
- **Phase 24 fixture-pipeline locale assertions** — primed fixtures don't carry locale-tagged Pensieve entries currently. Out of scope; T7/Phase 45 handles fixture pipeline, this phase doesn't touch fixtures.

</deferred>

---

*Phase: 46-fr-ru-localization-comprehensive*
*Context gathered: 2026-05-14 (auto mode, single-pass; all 7 gray areas auto-selected, recommended option chosen for each)*
