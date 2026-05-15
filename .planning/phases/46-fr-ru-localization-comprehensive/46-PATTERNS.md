# Phase 46: FR/RU Localization Comprehensive — Pattern Map

**Mapped:** 2026-05-14
**Source:** 46-CONTEXT.md (7 gray areas auto-resolved) + Phase 26/28/29/35/39 REVIEW.md catalogs + direct source-file inspection.

---

## Files To Be Created Or Modified

| File | Role | Operation | Analog |
|------|------|-----------|--------|
| `src/chris/locale/strings.ts` | NEW shared locale register module (cross-file strings + `qualifierFor` canonical home) | CREATE | `src/chris/language.ts` (sibling co-location) + `src/chris/refusal.ts:180-184` (register shape) |
| `src/chris/locale/__tests__/strings.test.ts` | NEW unit tests for `qualifierFor(c, lang)` + `normalizeForInterrogativeCheck(s)` | CREATE | `src/chris/__tests__/language.test.ts` (sibling) |
| `src/bot/handlers/profile.ts` | L10N-01 — localize 21 sites (qualifier strings, HEXACO/Schwartz dim labels, score-line `/ 5.0` + `confidence` tokens) | MODIFY (extend `MSG`, replace `qualifierForPsych`, replace dim-label const maps) | Self (existing `MSG` at :120-443 is gold-standard register) |
| `src/memory/profiles.ts` | L10N-05 — remove local `qualifierFor` (676-679); import canonical from `chris/locale/strings.ts` | MODIFY (delete + import) | N/A — extraction |
| `src/rituals/weekly-review.ts` | L10N-02 (header → Record<Lang>), L10N-03 (regex tightening + normalize call), L10N-06 (templated fallback → Record<Lang>) | MODIFY | Self (`WeeklyReviewPromptInput.language` already plumbed) + `voice-decline.ts:22-49` (DECLINE_MESSAGES Record shape) |
| `src/rituals/journal.ts` | L10N-04 — `PROMPTS` → `Record<Lang, readonly string[]>`; `fireJournal` adds `getLastUserLanguageFromDb` call | MODIFY | `src/rituals/weekly-review.ts:580-583` (cron-context language fetch pattern) |
| `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` | Add FR + RU snapshot scenarios for populated HEXACO + Schwartz | MODIFY | Self (Scenario 4 already stubs the locale-hook slot per D-25; Phase 46 fills it) |
| `src/rituals/__tests__/weekly-review.test.ts` | Update :195 `typeof string` + :800-801 exact-text assertions to per-Lang; add L10N-03 regex tests (curly/straight/gibberish); add L10N-06 fallback per-Lang test | MODIFY | Self |
| `src/rituals/__tests__/journal.test.ts` | Add per-locale prompt-selection test (seeded RNG → FR PROMPTS array used when `getLastUserLanguageFromDb` returns French) | MODIFY | Self + `journal-handler.test.ts` (cron-firing test) |
| `src/rituals/__tests__/journal-handler.test.ts` | Update `fireJournal` mock setup to mock `getLastUserLanguageFromDb` | MODIFY | Self |

---

## Closest Analog Excerpts (for executor `<read_first>` orientation)

### Analog 1: `MSG`-shape register — `src/bot/handlers/profile.ts:120-187`

```typescript
const MSG = {
  sectionTitle: {
    jurisdictional: {
      English: 'Jurisdictional Profile',
      French: 'Profil juridictionnel',
      Russian: 'Юрисдикционный профиль',
    },
    // ...
  },
  confidence: {
    English: 'confidence',
    French: 'confiance',
    Russian: 'уверенность',
  },
  insufficientData: {
    English: (dim: Dimension): string =>
      `Chris needs more entries about your ${MSG.dimensionHint[dim].English} before populating this profile.`,
    // ...
  },
} as const;
```

**Replicate this shape exactly** for every new register in this phase. Nested-record + arrow functions inside `Record<Lang, T>` slots are the canonical pattern. `as const` lock is mandatory (TS narrows the literal types; widening to `string` reintroduces drift class).

### Analog 2: Acknowledgments-style fallback — `src/chris/refusal.ts:180-184`

```typescript
const ACKNOWLEDGMENTS: Record<string, string[]> = {
  English: ['Got it — moving on.', 'Understood.', "No problem, we'll skip that."],
  French: ['Compris — on passe à autre chose.', 'Pas de souci.', "D'accord, on laisse ça."],
  Russian: ['Понял — идём дальше.', 'Хорошо.', 'Без проблем, пропустим это.'],
};
```

**Use this shape for L10N-04** — `PROMPTS` becomes `Record<Lang, readonly string[]>` with the same cardinality across all three locales (6 prompts each; CAP-01 discipline). Note: `refusal.ts` uses `Record<string, string[]>` (looser); Phase 46 tightens to `Record<Lang, readonly string[]>` per D-05.

### Analog 3: Cron-context language fetch — `src/rituals/weekly-review.ts:580-583`

```typescript
// inside fireWeeklyReview (cron handler)
const detectedLanguage = await getLastUserLanguageFromDb(BigInt(chatId));
const language = detectedLanguage ?? 'French'; // Greg's primary locale
```

**Replicate this in `fireJournal`** before `bot.api.sendMessage` at journal.ts:374. The cron handler MUST use `getLastUserLanguageFromDb` (NOT `getLastUserLanguage` in-memory) per M009 first-Sunday lesson.

NOTE: 29-REVIEW.md BL-02 documents a known short-message bug in `getLastUserLanguageFromDb` (returns 'English' for content < 15 chars). This bug is OUT of scope for Phase 46 — track separately, do not block on it.

### Analog 4: D-08 verbatim seed text (CONTEXT.md decision)

```typescript
const WEEKLY_REVIEW_HEADER: Record<Lang, string> = {
  English: 'Observation (interpretation, not fact):',
  French: 'Observation (interprétation, pas un fait) :',
  Russian: 'Наблюдение (интерпретация, не факт):',
};

const TEMPLATED_FALLBACK: Record<Lang, { observation: string; question: string }> = {
  English: { observation: 'Reflecting on this week.', question: 'What stood out to you about this week?' },
  French: { observation: 'Réflexion sur cette semaine.', question: "Qu'est-ce qui t'a marqué cette semaine ?" },
  Russian: { observation: 'Размышление об этой неделе.', question: 'Что вам запомнилось на этой неделе?' },
};
```

Both verbatim from 29-REVIEW.md BL-03 + WR-01 (CONTEXT.md D-08). Planner DOES NOT need to draft these.

### Analog 5: Existing FR/RU snapshot-test hook — `src/bot/handlers/__tests__/profile-psychological.golden.test.ts:18-23`

```text
Coverage per D-24 (4 scenarios) × D-25 (EN baseline + FR + RU language hook variants):
  - Scenario 1: all-populated (HEXACO 6 dims + Schwartz 10 values + Attachment deferred)
  ...
  - Scenario 4: FR + RU language hook slots (locks structural shape for v2.6.1 polish)
```

The test file ALREADY has Scenario 4 stubbed for FR/RU. Phase 46 Plan 46-02 fills out the actual FR + RU snapshot content for Scenarios 1-3. No new test file needed.

### Analog 6: Golden-snapshot update workflow — `src/bot/handlers/__tests__/profile-psychological.golden.test.ts:10-12`

```
On test failure (rendering changed):
  npx vitest run -u src/bot/handlers/__tests__/profile-psychological.golden.test.ts
```

**Standard `-u` snapshot update flow** — executor regenerates snapshots once, reviewer (Greg) inspects diff at `/gsd-verify-work`.

---

## Data Flow Diagram (for executor orientation)

```
User-initiated /profile handler:
  getLastUserLanguage(chatId) → langOf(raw) → Lang
    → formatPsychologicalProfileForDisplay(type, profile, lang)
      → MSG.psychologicalSections.{type}.{branch}[lang]      [already done — Phase 39]
      → HEXACO_DIM_DISPLAY_LABELS[key][lang]                  [NEW — L10N-01]
      → SCHWARTZ_DIM_DISPLAY_LABELS[key][lang]                [NEW — L10N-01]
      → qualifierForPsych(c, lang)  ← import canonical from chris/locale/strings.ts  [NEW — L10N-01 + L10N-05]
      → score-line template uses MSG.scoreLine[lang](label, score, conf, qual)  [NEW — L10N-01]

Cron-fired weekly review (fireWeeklyReview):
  getLastUserLanguageFromDb(chatId) → langOf(raw) → Lang
    → generateWeeklyObservation({...input, language})
      → on retry-cap-exhaust: return TEMPLATED_FALLBACK[lang]  [CHANGED — L10N-06]
    → userFacingMessage = `${WEEKLY_REVIEW_HEADER[lang]}\n\n${observation}\n\n${question}`  [CHANGED — L10N-02]

Cron-fired daily journal (fireJournal):
  [NEW path] getLastUserLanguageFromDb(chatId) → langOf(raw) → Lang   [NEW — L10N-04]
    → PROMPTS[lang][promptIdx]    [CHANGED shape — L10N-04]
    → bot.api.sendMessage(chatId, prompt)

Stage-1 question gate:
  question → normalizeForInterrogativeCheck(question)   [NEW — L10N-03 helper from chris/locale/strings.ts]
    → INTERROGATIVE_REGEX.test(normalized)              [CHANGED — drop `e` from class: qu'?est-ce que]
```

---

## Established Patterns Repeated In This Phase

1. **Per-language register, `Record<Lang, T>`, declared `as const`** — `MSG` (profile.ts), `DECLINE_MESSAGES` (voice-decline.ts), `ACKNOWLEDGMENTS` (refusal.ts), `DATE_LOCALES` (profile.ts).
2. **Fallback-to-English on lookup miss** — `MSG.feature[lang] ?? MSG.feature['English']` (already used in `voice-decline.ts:35-45`). All Phase 46 new lookups inherit this.
3. **`langOf(getLastUserLanguage[FromDb](chatId))` two-step narrowing** — used in `summary.ts`, `profile.ts`, `weekly-review.ts:580-583`. Repeat in journal.ts.
4. **Golden snapshots for display-formatter regression detection** — Phase 35 `profile.golden.test.ts` + Phase 39 `profile-psychological.golden.test.ts`. Phase 46 extends both with FR/RU.
5. **CAP-01 cardinality discipline** — when array data is replicated per-locale, a `.length` equality CI assertion runs (see `triggers-fixtures.ts:25-36` ABORT_PHRASES_*).
6. **Cron handler reads DB, user handler reads memory** — M009 first-Sunday boundary. `getLastUserLanguageFromDb` for `fireJournal` + `fireWeeklyReview`; `getLastUserLanguage` for `/profile`, `/summary`.
7. **NFC + apostrophe normalization at input boundary** (NEW for this phase, repeated downstream) — `normalizeForInterrogativeCheck` lives in `chris/locale/strings.ts` so future FR regex consumers (refusal.ts FR_PATTERNS, future weekly-review extensions) can opt in.

---

## Anti-Patterns To Avoid

1. **Do NOT create a parallel `src/i18n/` or `src/lang/` package** (CONTEXT.md D-01 / D-02). One detection layer = `src/chris/language.ts`. One register convention = co-located `MSG`-shape (or `chris/locale/strings.ts` for cross-file).
2. **Do NOT translate the LLM SYSTEM prompts** for L10N-04 / L10N-06. System prompts stay EN; output language is directed via the existing `Write in ${language}` clause in `weekly-review-prompt.ts`. Only USER-FACING text is translated.
3. **Do NOT touch already-localized strings** — `MSG.confidence`, `MSG.dimensionHint`, all 4 `MSG.fields.*`, all 3 `MSG.psychologicalSections.{type}.sectionTitle/insufficientData/neverFired/notYetActive` ALREADY ship FR + RU. Phase 39 D-19 explicitly deferred only the qualifier + dim-label + score-line tokens — those 21 sites are L10N-01's full scope.
4. **Do NOT bump `PROMPT_SET_VERSION`** unless the array LENGTHS diverge across locales. Per CAP-01 discipline: all 3 locales have 6 prompts → index stays valid → no bump → existing `prompt_bag` rows in production survive. Bump only if a translation forces a different cardinality (it should not).
5. **Do NOT widen `Record<Lang, T>` to `Record<string, T>`** in new registers. The `as const` + `Lang` union is the compile-time regression detector for future locale additions.
6. **Do NOT add the apostrophe variants to the regex itself** ("character class fix") — CONTEXT.md D-15 rejected this. The systemic fix is pre-input NFC + canonical-apostrophe replacement via `normalizeForInterrogativeCheck`.

---

## Cross-Phase Coordination Notes

- **Phase 41 (ADJ-03) running in parallel.** Per CONTEXT.md D-09: both orderings work. If Phase 46 ships first, Phase 41 imports `langOf` + `Lang` from already-shipped `chris/language.ts` and adopts the in-file `MSG`-shape locally. If Phase 41 ships first, Phase 46 EXPANDS the same shape across journal/weekly-review/profile. Phase 46 does not create infrastructure that Phase 41 must wait for — D-01 = no new locale layer.
- **Phase 47 (DISP-01, DISP-02) depends on Phase 46.** The locale-aware `qualifierFor` is consumed by Phase 47's HEXACO×Schwartz cross-validation observations. Phase 47 reads `qualifierFor(c, lang)` from `chris/locale/strings.ts` once Phase 46 lands it.

---

## PATTERN MAPPING COMPLETE

6 requirements → 4 plans (per CONTEXT.md D-23 recommended split). All 10 files identified above have at least one existing analog in the codebase; no green-field invention. Greg's verbatim copy seeds (CONTEXT.md D-08) cover the highest-stakes new strings.
