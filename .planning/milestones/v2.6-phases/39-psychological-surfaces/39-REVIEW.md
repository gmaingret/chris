---
phase: 39-psychological-surfaces
reviewed_at: 2026-05-14
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/memory/profiles.ts
  - src/chris/personality.ts
  - src/chris/modes/reflect.ts
  - src/chris/modes/psychology.ts
  - src/chris/modes/coach.ts
  - src/bot/handlers/profile.ts
  - src/memory/psychological-profile-prompt.ts (read-only, footer source-of-truth verification)
blocker_count: 0
warning_count: 7
status: issues_found
---

# Phase 39: Psychological Surfaces — Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found (0 BLOCKER, 7 WARNING)

## Summary

Phase 39 prompt-side and display-side surfaces are structurally sound. The D027 mitigation chain is intact:

- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` correctly excludes COACH at the type-key union level (compile-time error if `MAP['COACH']` is accessed).
- `formatPsychologicalProfilesForPrompt` IMPORTS `PSYCHOLOGICAL_HARD_RULE_EXTENSION` from `src/memory/psychological-profile-prompt.ts:144` — verified single source of truth via grep; the footer is NEVER redeclared in `profiles.ts`.
- COACH handler (`src/chris/modes/coach.ts`) contains zero `psychological`/`getPsychologicalProfiles`/`formatPsychologicalProfilesForPrompt` references — negative-invariant respected.
- All 6 silent-drop modes (JOURNAL, INTERROGATE, PRODUCE, PHOTOS, ACCOUNTABILITY, COACH) confirmed: none pass `psychologicalProfiles` in their `extras` to `buildSystemPrompt`. Personality.ts COACH case destructures the field but never references it.
- Drizzle reads in `readOnePsychologicalProfile` are parameterized via `eq(table.name, 'primary')` — no injection surface.
- Reader is never-throw (3-layer Zod defense: schema_mismatch → parse_failed → unknown_error).

**No BLOCKER-class defects found.** The 7 WARNING items below all concern the deferred D-20 localization debt (FR/RU EN-token leak in user-facing `/profile` output) and a few maintainability concerns (hardcoded magic numbers, dead code).

## Warnings

### WR-01: EN-only confidence qualifier leaks into FR/RU /profile output (D-20 known-deferred)

- **File:** `src/bot/handlers/profile.ts:704-708` (function `qualifierForPsych`) consumed at `:791` and `:806`.
- **Issue:** When `lang='French'` or `lang='Russian'`, every populated HEXACO/Schwartz score line ends with English text: `(confidence 0.6 — substantial evidence)`. The qualifier strings (`'substantial evidence'`/`'moderate evidence'`/`'limited evidence'`) and the word `confidence` inside the score line are hardcoded English regardless of `lang`. The function signature `qualifierForPsych(c: number)` does not accept a `lang` parameter.
- **Impact:** Greg's FR/RU /profile output emits sentences that switch language mid-line — the same M010-07 regression class WR-02 in `formatProfileForDisplay` was specifically designed to prevent. Acknowledged by inline comment at `:699-703` as "v2.6.1 polish item," but per Phase 39 D-20 guardrail, every such placeholder must be flagged.
- **Fix:** Extend `qualifierForPsych(c, lang)` and add `MSG.psychologicalSections.qualifierBands.{substantial,moderate,limited}[lang]` + `MSG.psychologicalSections.confidenceLabel[lang]`. Reuse `MSG.confidence[lang]` (already exists at `:143-147`) for the score-line label.

### WR-02: EN-only HEXACO + Schwartz dimension labels leak into FR/RU output (D-20)

- **File:** `src/bot/handlers/profile.ts:714-721` (`HEXACO_DIM_DISPLAY_LABELS`) and `:727-738` (`SCHWARTZ_DIM_DISPLAY_LABELS`), consumed at `:791` and `:806`.
- **Issue:** Per-dim labels (`'Honesty-Humility'`, `'Self-Direction'`, `'Openness'`, `'Power'`, etc.) are exported as Title-Case English constants regardless of `lang`. The score line `${label}: ${score} / 5.0 ...` therefore renders `"Honesty-Humility: 4.2 / 5.0 ..."` in FR/RU output instead of e.g. `"Honnêteté-Humilité: 4,2 / 5,0 ..."` or the agreed Russian equivalent.
- **Impact:** Combined with WR-01, the entire populated-section body (lines 778-816) is English-only in FR/RU, with only the section title (`MSG.psychologicalSections.{hexaco,schwartz}.sectionTitle[lang]`) localized. The mixed-language output is visually jarring and inconsistent with the WR-02 invariant explicitly codified for operational profiles (see `:273` "yourLegalEntities" pattern — all field labels are localized).
- **Fix:** Convert the two `_DIM_DISPLAY_LABELS` constants into per-lang maps (`Record<Lang, Record<keyof HexacoProfileData, string>>`), mirroring the `MSG.fields.health.wellbeingLabels` shape at `:379-401`.

### WR-03: EN-only score-line "/ 5.0" + "confidence" tokens (D-20)

- **File:** `src/bot/handlers/profile.ts:791,806`.
- **Issue:** The score-line template `` `${label}: ${dim.score.toFixed(1)} / 5.0 (confidence ${dim.confidence.toFixed(1)} — ${qualifierForPsych(dim.confidence)})` `` embeds the literals `"/ 5.0"` and `"confidence"` directly. FR speakers expect `"/ 5,0"` (comma decimal) and the existing `MSG.confidence.French = 'confiance'` key would round-trip cleanly.
- **Impact:** Same family as WR-01/WR-02. `Number.toFixed(1)` always emits a dot decimal; in FR-FR locale convention this is incorrect formatting.
- **Fix:** Externalize the score-line template into `MSG.psychologicalSections.scoreLine[lang]: (label, score, conf, qual) => string`. Use `.toLocaleString(DATE_LOCALES[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 })` for the decimals.

### WR-04: Hardcoded "5000" threshold drifted from `MIN_SPEECH_WORDS` constant

- **File:** `src/bot/handlers/profile.ts:770`.
- **Issue:** `const N = Math.max(0, 5000 - wc);` hardcodes the word-count floor inline rather than importing `MIN_SPEECH_WORDS` (exported at `src/memory/confidence.ts:99`). Same magic number appears in two comment locations (`:195`, `:685`) — three drift surfaces in one file.
- **Impact:** If product decides to lower the floor (e.g. relaxing to 3,000 words for testing or raising to 7,500 in v2.6.1), this surface will silently disagree with the substrate-loader gate (`confidence.ts` MIN_SPEECH_WORDS) and produce an off-by-N "need N more words" message. The guard rail's "hardcoded thresholds" flag.
- **Fix:** `import { MIN_SPEECH_WORDS } from '../../memory/confidence.js';` then `const N = Math.max(0, MIN_SPEECH_WORDS - wc);`. Update comments to reference the constant name.

### WR-05: `dim.score === null` is dead code at lines 788, 803

- **File:** `src/bot/handlers/profile.ts:788, 803`.
- **Issue:** The Zod schema `hexacoSchwartzDimensionSchemaV3` at `src/memory/profiles/psychological-schemas.ts:43-50` types `score` as `z.number().min(1).max(5)` (non-nullable). The `.nullable()` is applied at the parent-dimension level (e.g. `honesty_humility: HexacoDimension | null`), already handled by the preceding `if (!dim) continue;` at lines 787/802. Therefore `if (dim.score === null) continue;` can never be true under the typed contract.
- **Impact:** Dead defensive code creates the false impression that score nullability is a real failure mode. Future schema refactors that legitimately introduce per-field nullability will assume this is the guard and may not add additional checks.
- **Fix:** Either delete lines 788/803, OR change the schema to model `score: z.number().nullable()` and document why per-field nullability matters. Recommend delete + add a clarifying comment that score-nullability is contractually impossible.

### WR-06: `formatPsychologicalProfileForDisplay` produces zero score lines but still renders title + blank line when all dims filter out

- **File:** `src/bot/handlers/profile.ts:777-818`.
- **Issue:** D-19 branch 4 (populated) builds `lines = [title, '']` unconditionally. If `profile.confidence > 0` AND `lastUpdated !== epoch` AND `profileType !== 'attachment'` BUT every individual dim is filtered (all `dim === null` OR `dim.confidence === 0`), the function returns just `"HEXACO Personality\n"` — a section header followed by a blank line and nothing else. The operational `formatProfileForDisplay` at `:478-480` short-circuits to `MSG.insufficientData[lang](dimension)` when there's no body to render; this psychological analog does not.
- **Impact:** Greg sees an empty-section message that conveys no information. Combined contract gap with WR-04: when overall_confidence > 0 but per-dim confidence is all zero, the user sees `"HEXACO Personality\n"` instead of the actionable "need N more words" message.
- **Fix:** After the switch/for-loop, if `lines.length === 2` (just title + blank), return the localized `insufficientData[lang](N)` message instead — same fallback path as branch 3. Add a golden-snapshot test for this edge case.

### WR-07: Duplicate `qualifierFor` logic — prompt-side and display-side drift risk

- **File:** `src/memory/profiles.ts:675-679` (prompt-side `qualifierFor`) AND `src/bot/handlers/profile.ts:704-708` (display-side `qualifierForPsych`). Two near-identical implementations of the D-07 confidence-band mapping.
- **Issue:** The CONTEXT inline comment at `profile.ts:710-713` explicitly defends this duplication as an "Architectural Responsibility Map" choice, but the two functions are byte-identical English-only strings. A future re-banding (e.g. lowering the substantial threshold from 0.6 to 0.55) requires two coordinated edits with no compile-time link.
- **Impact:** Latent drift surface. PMT-06's anti-hallucination gate inspects the prompt-side text; manual UAT reads the display-side text. If they diverge silently, Greg might see "substantial evidence" in /profile while the prompt says "moderate evidence" for the same score — eroding trust.
- **Fix:** Either (a) move `qualifierFor` to a shared module like `src/memory/profiles/psychological-shared.ts` and re-export from both, OR (b) keep the boundary but add a test in `profiles.test.ts` that imports both and asserts byte-equality of return values across 10 sampled confidence values.

## Comprehensive EN-only Literals in User-Facing Paths (Phase 39 D-20 deferred items)

Per the guard-rail directive — every EN-only string reachable by Greg's FR/RU `/profile` output:

| File | Line | Literal | Reachable Lang |
|------|------|---------|----------------|
| `src/bot/handlers/profile.ts` | 705 | `'substantial evidence'` | FR, RU |
| `src/bot/handlers/profile.ts` | 706 | `'moderate evidence'` | FR, RU |
| `src/bot/handlers/profile.ts` | 707 | `'limited evidence'` | FR, RU |
| `src/bot/handlers/profile.ts` | 715 | `'Honesty-Humility'` (HEXACO_DIM_DISPLAY_LABELS) | FR, RU |
| `src/bot/handlers/profile.ts` | 716 | `'Emotionality'` | FR, RU |
| `src/bot/handlers/profile.ts` | 717 | `'Extraversion'` | FR, RU |
| `src/bot/handlers/profile.ts` | 718 | `'Agreeableness'` | FR, RU |
| `src/bot/handlers/profile.ts` | 719 | `'Conscientiousness'` | FR, RU |
| `src/bot/handlers/profile.ts` | 720 | `'Openness'` | FR, RU |
| `src/bot/handlers/profile.ts` | 728 | `'Self-Direction'` (SCHWARTZ_DIM_DISPLAY_LABELS) | FR, RU |
| `src/bot/handlers/profile.ts` | 729 | `'Stimulation'` | FR, RU |
| `src/bot/handlers/profile.ts` | 730 | `'Hedonism'` | FR, RU |
| `src/bot/handlers/profile.ts` | 731 | `'Achievement'` | FR, RU |
| `src/bot/handlers/profile.ts` | 732 | `'Power'` | FR, RU |
| `src/bot/handlers/profile.ts` | 733 | `'Security'` | FR, RU |
| `src/bot/handlers/profile.ts` | 734 | `'Conformity'` | FR, RU |
| `src/bot/handlers/profile.ts` | 735 | `'Tradition'` | FR, RU |
| `src/bot/handlers/profile.ts` | 736 | `'Benevolence'` | FR, RU |
| `src/bot/handlers/profile.ts` | 737 | `'Universalism'` | FR, RU |
| `src/bot/handlers/profile.ts` | 791 | `"${label}: ${score} / 5.0 (confidence ${conf} — ${qual})"` template — embeds `"/ 5.0"` and `"confidence"` tokens | FR, RU |
| `src/bot/handlers/profile.ts` | 806 | Same template as above (Schwartz branch) | FR, RU |

**Total: 21 EN-only literals reachable in FR/RU user-facing output.** All concentrated in lines 704-820 of `src/bot/handlers/profile.ts` (`formatPsychologicalProfileForDisplay` + its private label maps + qualifier function). Localizing in v2.6.1 requires touching this single function — well-bounded refactor.

Prompt-side (`src/memory/profiles.ts:653-815`) intentionally emits English-only since the LLM (not Greg) consumes that text; that's correct and not flagged.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
