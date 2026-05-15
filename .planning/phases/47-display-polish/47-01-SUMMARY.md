---
phase: 47
plan: 01
status: complete
shipped: 2026-05-15
requirements_addressed:
  - DISP-01
  - DISP-02
files_modified:
  - src/bot/handlers/profile.ts (+217 lines: SCHWARTZ_CIRCUMPLEX_ORDER + CrossValRule + CROSS_VALIDATION_RULES + computeCrossValidationObservations + MSG.psychologicalSections.crossValidation EN/FR/RU + handler ctx.reply append; Schwartz branch iteration switched from Object.entries to circumplex array)
  - src/bot/handlers/__tests__/profile-psychological-crossval.golden.test.ts (NEW, ~440 lines, 24 tests across 5 suites)
  - src/bot/handlers/__tests__/profile-psychological.golden.test.ts (6 Schwartz snapshots updated for circumplex order; HEXACO/attachment/insufficient-data untouched)
commits:
  - 9479e22 feat(47-01): DISP-01 — Schwartz circumplex order in /profile
  - 9193ed9 feat(47-01): DISP-02 — HEXACO × Schwartz cross-validation observations
  - ec238dc test(47-01): DISP-01 + DISP-02 golden snapshots + Phase 39 churn
verification:
  build_clean: true
  targeted_tests: 85/85 passing (profile-psychological-crossval + profile-psychological + profile + locale/strings)
  phase46_dependency_check: PASSED (Task 0 marker file 47-PHASE46-OK)
---

# Plan 47-01 Summary — Display Polish (DISP-01 + DISP-02)

## What shipped

### DISP-01 — Schwartz circumplex order

- New `SCHWARTZ_CIRCUMPLEX_ORDER` exported readonly array in `src/bot/handlers/profile.ts` with the canonical 10-element clockwise sequence: `[self_direction, universalism, benevolence, tradition, conformity, security, power, achievement, hedonism, stimulation]`.
- Schwartz branch of `formatPsychologicalProfileForDisplay` refactored to iterate the array instead of `Object.entries(SCHWARTZ_DIM_DISPLAY_LABELS)`. The D-09 per-dim filter is preserved verbatim — filtered dims leave gaps in the circumplex (the correct "no evidence" signal per CONTEXT.md D-05).
- Adjacent pairs across the ring expose Schwartz's documented oppositions. Three pure dipoles (hedonism↔tradition, achievement↔benevolence, power↔universalism) sit at strict antipodal ring distance 5; the other two (self_direction↔conformity, stimulation↔security) sit at distance 4 because the Conservation-vs-Openness axis isn't aligned to a diameter in a flat 10-element ring. The reader value is the cluster adjacency, not strict geometric antipode.

### DISP-02 — HEXACO × Schwartz cross-validation observations

- New `CrossValRule` type + `CROSS_VALIDATION_RULES` exported readonly table with 16 well-documented HEXACO × Schwartz literature correlations (per CONTEXT.md D-07):
  - 3 openness rules (self_direction, stimulation, universalism — positive)
  - 3 conscientiousness rules (achievement, security, conformity — positive)
  - 2 honesty_humility positive + 1 negative (benevolence + universalism positive; power negative→uncommon)
  - 2 agreeableness rules (benevolence, universalism — positive)
  - 3 extraversion rules (stimulation, hedonism, achievement — positive)
  - 2 emotionality rules (tradition, security — positive)
- New exported pure function `computeCrossValidationObservations(hexaco, schwartz, lang): string`:
  - **Match criterion (D-08):** positive rules fire when hexaco ≥ 3.5 of 5.0 AND schwartz ≥ 5.0 of 7.0; negative rules fire when hexaco ≥ 3.5 AND schwartz ≤ 3.0.
  - **Confidence floor (D-09):** both dim confidences ≥ 0.3 or silent omit.
  - **Qualifier (D-10):** `qualifierFor(min(hex.confidence, sch.confidence), lang)` — locale-aware min-of-two.
  - **Empty-state (D-14):** returns `''` (NOT "no observations available") when any of: profile null, never-fired (epoch sentinel), zero-confidence, zero rules match. Caller silently omits the reply.
  - **Reader-never-throw (Phase 39 D-22):** no DB, no logger, no Sonnet, no I/O; defensive guards on every dim access.
- New `MSG.psychologicalSections.crossValidation` block with `{sectionTitle, consistent, uncommon}[lang]` keys — EN/FR/RU populated from day 1 with observational tone ("uncommon pattern" not "this is wrong"). Plain-ASCII glyphs only per D-17 (`->` not `→`).
- Handler-side: one additional `ctx.reply(crossVal)` inside `handleProfileCommand` after the 3-reply psychological loop, gated by `if (crossVal !== '')`. Total `/profile` reply count: 4 operational + 3 psychological + (0 or 1) cross-val.

### Regression net

- New `profile-psychological-crossval.golden.test.ts` — 24 tests across 5 suites:
  1. DISP-01 circumplex order (EN/FR/RU + per-dim filter gap regression)
  2. DISP-02 cross-validation populated (EN/FR/RU, all 16 rules + uncommon)
  3. DISP-02 omit cases (null, never-fired, zero-confidence, below-floor, no-match)
  4. SCHWARTZ_CIRCUMPLEX_ORDER invariants (10 elements, no duplicates, near-antipodal pairs, exact-sequence lock)
  5. CROSS_VALIDATION_RULES invariants (16 rules, no duplicate triples, valid keys, coherent direction↔observationKey)
- Phase 39 `profile-psychological.golden.test.ts` — 6 Schwartz inline snapshots regenerated for new circumplex iteration order. HEXACO + attachment + insufficient-data + never-fired snapshots untouched (scope-leak guard passed).

## Task 0 Phase-46-dependency verdict

Marker file `47-PHASE46-OK` written. Phase 46 ships:
- `qualifierFor(c: number, lang: Lang): string` in `src/chris/locale/strings.ts:67` ✓
- `HEXACO_DIM_DISPLAY_LABELS: Record<keyof HexacoProfileData, Record<Lang, string>>` in `profile.ts:736-769` ✓ (one cosmetic divergence vs plan assumption: key-outer / lang-inner shape, accessed as `MAP[key][lang]`; functionally equivalent)
- `SCHWARTZ_DIM_DISPLAY_LABELS` in `profile.ts:777-830` ✓ (same shape)
- `MSG.scoreLine[lang]` template in `profile.ts:277-284` ✓

No mismatch file written. Plan proceeded.

## Verification

- `npm run build`: exit 0 (clean TypeScript compile).
- Targeted test pass: 85/85 across `profile-psychological-crossval.golden.test.ts`, `profile-psychological.golden.test.ts`, `profile.golden.test.ts`, `chris/locale/__tests__/strings.test.ts`.
- D-17 invariant verified: 0 `parse_mode` or unicode-arrow occurrences in real (non-comment) code.

## Deferred (per CONTEXT.md)

- Persisted cross-val cache (write rule output at HEXACO/Schwartz inference time) — defer to v2.7 if Greg reports observable `/profile` read latency.
- Top-N ranking of observations — reassess after Greg's first `/profile` reply with cross-val.
- Visual divider between opposing pairs (`——` between Schwartz pairs) — reassess at UAT.
- Attachment cross-validation — out of scope until ATT-POP-01 (v2.7+).
- Graduated thresholds for "very high" / "high" buckets — single binary threshold on first pass.

## Operator next steps

- This is the last v2.6.1 phase. `/gsd-complete-milestone` or `/gsd-ship` next.
- Post-deploy UAT: confirm Schwartz section opens with "Self-Direction" and reads as circumplex; confirm cross-val section renders below HEXACO+Schwartz on Greg's account (where applicable).
