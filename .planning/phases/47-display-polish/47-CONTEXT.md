# Phase 47: Display Polish - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** `--auto` (recommended-option selections; user can audit decisions inline)

<domain>
## Phase Boundary

Add the two user-visible v2.6.1 surface improvements to `/profile`:

1. **DISP-01 (CIRC-01):** Schwartz values rendered in circumplex order (opposing values adjacent — `self_direction ↔ conformity / tradition`, etc.) so Greg reads the section as a tradeoff structure rather than an alphabetical list.
2. **DISP-02 (CROSS-VAL-01):** HEXACO × Schwartz cross-validation observations rendered on `/profile` (e.g. "high openness + high self-direction → consistent" / "low conscientiousness + high tradition → uncommon"), giving Greg a coherence signal across the two psychological profiles.

Both changes touch exactly one user-facing file: `src/bot/handlers/profile.ts`, inside or adjacent to `formatPsychologicalProfileForDisplay` (lines 740-819). The HEXACO + Schwartz value arrays themselves (`psychological-shared.ts`, schema, generators) are NOT modified — this phase is rendering-only.

Out of scope: NARR-01 narrative summary, CONS-01 inter-period consistency math, ATT-POP-01 attachment population, qualifier-band re-thresholding, score color/emoji styling, attachment cross-validation.

</domain>

<decisions>
## Implementation Decisions

### Circumplex ordering (DISP-01)

- **D-01:** Use a **canonical clockwise circumplex order** as a fixed array constant — NOT top-to-bottom by score. The reader value is the structural pairing, not the magnitude ranking; sort-by-score destroys the "opposing values adjacent" property the requirement asks for.
- **D-02:** Canonical order (clockwise from self_direction): `self_direction → universalism → benevolence → tradition → conformity → security → power → achievement → hedonism → stimulation`. Adjacent pairs across the 10-element ring form Schwartz's documented oppositions: `self_direction ↔ conformity`, `stimulation ↔ security`, `hedonism ↔ tradition`, `achievement ↔ benevolence`, `power ↔ universalism`. The ring wraps at index 9 → index 0 (stimulation ↔ self_direction completes the circle).
- **D-03:** Replace the existing `SCHWARTZ_DIM_DISPLAY_LABELS` `Readonly<Record<...>>` iteration (`profile.ts:727-738`, consumed at `:798`) with an ordered `const SCHWARTZ_CIRCUMPLEX_ORDER: readonly (keyof SchwartzProfileData)[] = [...]` array. Iterate the array; look up the label per-key. Label map remains a `Record<...>` keyed by dim name.
- **D-04:** **No visual separator** between opposing values on first pass (no `——` divider, no blank line between pairs). The adjacency in the rendered list IS the visual structure. Reassess if Greg requests it during UAT — captured as a deferred polish item.
- **D-05:** Per-dim filter (`if (!dim) continue; if (dim.score === null) continue; if (dim.confidence === 0) continue;`) preserved verbatim from current code. A filtered-out dim leaves a "gap" in the circumplex — that's the correct signal ("we don't have evidence for this value") and matches the existing D-09 contract.

### Cross-validation observations (DISP-02)

- **D-06:** **Hardcoded rule table** at module scope — NOT Sonnet-generated, NOT computed at inference time. Rationale:
  - **Why not Sonnet at /profile call:** Greg's `/profile` is a synchronous read; adding a Sonnet call (300-800ms + cost + failure surface) for a read-only display is a contract violation against the existing reader-is-never-throw discipline (Phase 39 D-22). A Sonnet failure here would either degrade `/profile` silently or block it — both worse than no observations.
  - **Why not at inference time:** Cross-validation is a function of (HEXACO state, Schwartz state). The two profiles fire from the same monthly cron but as separate Sonnet calls; cross-state inference at write-time would require either a third Sonnet call or post-hoc rule application on persisted state. Post-hoc rule application is exactly what the display-side rule table does — moving it to write-time adds a column without changing the logic. Defer the "persist observations" optimization to v2.7 if Greg asks for stability across reads.
  - **Why hardcoded rules win here:** The 5-7 canonical correlations cited in the requirements (openness↔self_direction/stimulation/universalism; conscientiousness↔achievement/security/conformity; honesty_humility↔benevolence/universalism / NEG power; agreeableness↔benevolence/universalism; extraversion↔stimulation/hedonism/achievement; emotionality↔tradition/security) are well-documented HEXACO/Schwartz literature findings. Encoding them as a static table is auditable, free of LLM hallucination risk, and trivially testable.
- **D-07:** Rule shape:
  ```ts
  type CrossValRule = {
    hexacoDim: keyof HexacoProfileData;
    schwartzDim: keyof SchwartzProfileData;
    direction: 'positive' | 'negative';  // expected correlation sign
    observationKey: 'consistent' | 'uncommon';
    // localized strings retrieved via MSG.psychologicalSections.crossValidation[observationKey][lang](hexacoLabel, schwartzLabel)
  };
  ```
  Rules table lives in `src/bot/handlers/profile.ts` adjacent to the existing dim-label maps. ~12-15 rules total covering the documented HEXACO × Schwartz pairs.
- **D-08:** **Match criterion:** A rule matches when BOTH `hexacoDim` and `schwartzDim` are populated (not filtered out by D-09 per-dim filter) AND both are at the "high" end (score ≥ 3.5 of 5.0 for HEXACO, score ≥ 5.0 of 7.0 for Schwartz). The HEXACO band uses 5.0 max scale; Schwartz uses 7.0 max scale (per the substrate-loader gates). For `direction: 'negative'` rules, "match" means high HEXACO + LOW Schwartz (Schwartz score ≤ 3.0 of 7.0). Single threshold per scale on first pass — no graduated "very high"/"high" buckets.
- **D-09:** **Confidence floor:** Show an observation only when BOTH dim confidences ≥ 0.3 (matches the existing qualifier-band's `moderate evidence` threshold — anything below is `limited evidence` and the observation would be reading noise). Below the floor: silently omit. This is stricter than "always show with a qualifier" because cross-validation noise compounds — two limited-evidence dims combined give worse-than-coin-flip signal.
- **D-10:** **Confidence qualifier on the observation line:** Use the MINIMUM of the two dim confidences via the **locale-aware `qualifierFor` from L10N-05** (Phase 46). Format: `"high openness + high self-direction → consistent (moderate evidence)"`. Min-of-two is correct: an observation is only as strong as its weakest input.
- **D-11:** **Number of observations:** Show **all matching rules** that pass the confidence floor. Empirically with the 12-15-rule table and Greg's expected HEXACO + Schwartz profile, this caps at ~3-5 observations — small enough to not bloat `/profile`, large enough to be informative. No top-N ranking on first pass.
- **D-12:** **Negative-direction observations ("uncommon"):** **Show them.** Phase 46's L10N work owns the wording — render in a non-judgmental observational tone ("uncommon pattern" not "this is wrong"). The "low conscientiousness + high tradition" example from the requirements is explicitly an "uncommon" case and Greg already signed off on it as in-scope. Use neutral observational phrasing in EN/FR/RU.
- **D-13:** **Display order in /profile:** Cross-validation section renders **AFTER both HEXACO and Schwartz sections** (i.e. last in `formatPsychologicalProfileForDisplay`-equivalent flow, or appended in the caller that composes the full `/profile` reply). Rationale: the observations reference both profiles by label, so the reader has already seen the underlying scores when they hit the cross-val section. Section title via `MSG.psychologicalSections.crossValidation.sectionTitle[lang]`.
- **D-14:** **Empty cross-val state:** If zero rules match (e.g. all dims below confidence floor, or one of HEXACO/Schwartz never-fired), **omit the cross-validation section entirely** (NOT "no observations available"). Matches Phase 39 WR-06's recommended fix pattern — empty section bodies are user-hostile noise.
- **D-15:** **Localization:** Cross-validation observation strings are FR/RU localized at `MSG.psychologicalSections.crossValidation.{consistent,uncommon}[lang]: (hexacoLabel, schwartzLabel, qualifier) => string`. Coordinated with Phase 46 L10N infrastructure — the dim labels passed in are already-localized (from the new locale-aware HEXACO/Schwartz label maps Phase 46 ships).

### Phase 46 dependency contract

- **D-16:** This phase **must not start before Phase 46 ships** the following Phase-46-owned artifacts:
  1. Locale-aware `qualifierFor(c: number, lang: Lang)` consolidated from `profiles.ts:675-679` + `profile.ts:704-708` (L10N-05).
  2. Locale-aware `HEXACO_DIM_DISPLAY_LABELS` and `SCHWARTZ_DIM_DISPLAY_LABELS` as `Record<Lang, Record<...>>` (L10N-01 / WR-02).
  3. Locale-aware score-line template `MSG.psychologicalSections.scoreLine[lang]` (L10N-01 / WR-03).
- **D-17:** If Phase 46 ships these as a unified `MSG.psychologicalSections.*` block, Phase 47 extends that block with `crossValidation.{sectionTitle, consistent, uncommon}[lang]` keys. The Phase 47 plan must read the post-Phase-46 `profile.ts` to confirm shape before coding.

### Testing

- **D-18:** **Unit tests** for the circumplex-order array (assert all 10 keys present, no duplicates, opposing pairs at expected distances) and the rule table (assert no duplicate `(hexacoDim, schwartzDim, direction)` triples, every rule references valid dim keys).
- **D-19:** **Golden-snapshot tests** for `formatPsychologicalProfileForDisplay` (or its successor) covering: (a) populated HEXACO + Schwartz → expected circumplex-ordered Schwartz block + expected cross-val observations, (b) one profile never-fired → cross-val section omitted, (c) all dims below confidence floor → cross-val section omitted, (d) FR locale → all strings localized. Snapshots checked in for visual review.
- **D-20:** **No live Sonnet test required** — this phase is rendering-only; no LLM call surface added.

### Claude's Discretion

- Exact wording of EN cross-val observation strings (e.g. "consistent with values pattern" vs "consistent" vs "aligns") — Phase 46 wording authority extends here; pick the most observational phrasing.
- Whether to use an arrow glyph (`↔`, `→`, `+`) in observation lines — pick one consistent glyph; current `formatPsychologicalProfileForDisplay` uses no glyphs so favor `+` and `→` (plain ASCII to avoid Telegram parse-mode interactions per D-17 invariant).
- Internal helper extraction in `profile.ts` — fine to add `computeCrossValidationObservations(hexaco, schwartz, lang)` as a module-private function.
- Whether to add a `MSG.psychologicalSections.crossValidation.sectionTitle` decorator (e.g. "Cross-pattern" vs "Consistency check") — pick one, hold it.

</decisions>

<specifics>
## Specific Ideas

- Cross-val observation tone reference: the existing operational `formatProfileForDisplay` insufficient-data messages ("inferring requires N more words of speech") are observational, not judgmental — match that register. The substrate-loader log messages (`chris.psychological.${profileType}.skipped_below_threshold`) are similarly observational. NO product copy that tells Greg "your profile is inconsistent" — frame as "we noticed this pattern is uncommon in the literature."
- Greg has not requested score-magnitude prominence; the circumplex ordering deliberately drops the existing alphabetical-by-declaration ordering, which is fine because no UAT user has reported relying on the alphabetical order.
- 5.0-of-7.0 Schwartz threshold for "high" matches the populated-section confidence floor convention in adjacent code; no Schwartz literature-based threshold imposed.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 47 scope source
- `/home/claude/chris/.planning/REQUIREMENTS.md` §DISP — DISP-01 + DISP-02 wording (the only two requirements this phase carries).
- `/home/claude/chris/.planning/ROADMAP.md` "Phase 47: Display Polish" — goal + success criteria + Phase 46 dependency.
- `/home/claude/chris/.planning/milestones/v2.6.1-REVIEW-SYNTHESIS.md` — original CIRC-01 / CROSS-VAL-01 in-scope confirmation (lines 131-132).

### Existing surface code (what gets modified)
- `/home/claude/chris/src/bot/handlers/profile.ts:699-819` — `formatPsychologicalProfileForDisplay`, the HEXACO/Schwartz dim-label maps, `qualifierForPsych`. This phase modifies the Schwartz iteration order AND adds a sibling cross-validation render.
- `/home/claude/chris/.planning/milestones/v2.6-phases/39-psychological-surfaces/39-REVIEW.md` §WR-01..07 — catalogue of EN-only literals + the existing display contract; WR-06 "empty section body" rule informs D-14; WR-07 `qualifierFor` duplication informs D-16 (Phase 46 dependency).

### Substrate / schema (read-only, do not modify)
- `/home/claude/chris/src/memory/profiles/psychological-shared.ts` — HEXACO + Schwartz substrate loader, `PsychologicalProfileType`, the gate-threshold (MIN_SPEECH_WORDS) backing the populated-section branch.
- `/home/claude/chris/src/memory/profiles/psychological-schemas.ts` (referenced from Phase 39 WR-05) — the `hexacoSchwartzDimensionSchemaV3` typing that locks `score` non-nullable per-dim; cross-val computation assumes this contract.

### Phase 46 dependency (must land first)
- `/home/claude/chris/.planning/ROADMAP.md` "Phase 46: FR/RU Localization Comprehensive" — L10N-05 (consolidated locale-aware `qualifierFor`), L10N-01 (locale-aware HEXACO/Schwartz labels). The Phase 47 plan reads `src/bot/handlers/profile.ts` AFTER Phase 46 ships to confirm shape.

### Project conventions (always consult)
- `/home/claude/chris/.planning/PROJECT.md` — locale convention (EN/FR/RU detection), display contract (no parse_mode chars in `/profile` output per D-17 invariant), reader-never-throw discipline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `qualifierForPsych(c: number): string` at `profile.ts:704-708` — replaced by Phase 46's locale-aware consolidated `qualifierFor`; this phase consumes the new version.
- `HEXACO_DIM_DISPLAY_LABELS`, `SCHWARTZ_DIM_DISPLAY_LABELS` at `profile.ts:714-738` — Phase 46 converts these to per-lang maps; Phase 47 consumes the post-Phase-46 shape AND adds a `SCHWARTZ_CIRCUMPLEX_ORDER` array for iteration order.
- `formatPsychologicalProfileForDisplay` at `profile.ts:740-819` — Phase 47 modifies the Schwartz `switch` branch (iterate ordered array, not the `Object.entries` of the label map). The cross-validation observations are rendered by a NEW sibling function called by the caller composing the `/profile` reply, OR appended after the HEXACO + Schwartz sections by the same composer.
- `MSG.psychologicalSections.*` (referenced throughout `profile.ts` and elsewhere) — Phase 47 extends with `crossValidation.{sectionTitle,consistent,uncommon}[lang]`.

### Established Patterns
- D-07 confidence-band semantics (substantial / moderate / limited) at `qualifierForPsych`; the moderate/limited boundary at 0.3 is the cross-val confidence floor (D-09).
- D-09 per-dim filter: skip null dim, skip `score === null`, skip `confidence === 0`. Cross-val computation reuses the same filter — a filtered-out dim cannot participate in a rule match.
- D-17 invariant (plain text only — no parse_mode chars) at `profile.ts:695-697`. Cross-val observation strings inherit this constraint; no `*`, `_`, backtick, `===`, `---`.
- Reader-never-throw (Phase 39 D-22, three-layer Zod defense); the rule-table approach respects this — no Sonnet failure surface.

### Integration Points
- `/profile` Telegram handler composes operational profiles + 3 psychological profiles' display strings. Cross-val section attaches AFTER the HEXACO + Schwartz blocks (D-13). Check the actual call site in `profile.ts` once Phase 46 lands to confirm whether `formatPsychologicalProfileForDisplay` is the composer or just renders one section.
- Cross-val helper signature: `computeCrossValidationObservations(hexaco: HexacoProfileData | null, schwartz: SchwartzProfileData | null, lang: Lang): string` — returns `''` when section should be omitted (D-14), else the localized section title + observation lines joined by `\n`.

</code_context>

<deferred>
## Deferred Ideas

- **Persisted cross-val observations** — write rule-table output to a `psychological_cross_validation` cache table at HEXACO/Schwartz inference time so subsequent `/profile` reads are read-once. Defer to v2.7 if Greg reports observable read-time latency.
- **Top-N ranking of observations** — if Greg reports the rendered observations feel bloated, add a confidence-weighted top-3 cap on a follow-on phase.
- **Visual divider between opposing pairs in the Schwartz block** (e.g. `——` between value pairs 1+2 / 3+4 / ...) — D-04 omits this on first pass; reassess after UAT feedback.
- **Attachment-dimension cross-validation** — out of scope until ATT-POP-01 (v2.7+) populates the attachment profile.
- **Cross-validation in the prompt-side `formatPsychologicalProfilesForPrompt`** (i.e. tell Sonnet about coherence) — this phase is display-only; prompt-side coherence inference would be its own design (CONS-01 / CONS-02 territory in v2.7+).
- **Graduated thresholds for "very high" / "high" buckets** in rule matching — D-08 uses a single binary threshold; bucketed thresholds can be added if a future phase calibrates them against empirical Sonnet output distributions.

</deferred>

---

## Auto-mode Decision Log

The `--auto` mode selected the recommended option for every gray area. Inline log per `modes/auto.md`:

```
[auto] Circumplex layout — Q: "Canonical clockwise circumplex or top-to-bottom by score?" → Selected: "Canonical clockwise" (recommended — preserves opposing-values-adjacent property)
[auto] Cross-val generation — Q: "Hardcoded rule table vs Sonnet-at-call-time vs persist-at-inference?" → Selected: "Hardcoded rule table" (recommended — reader-never-throw, no LLM failure surface, auditable)
[auto] Confidence floor — Q: "Both dims >0.3, >0.5, or always with qualifier?" → Selected: "Both ≥ 0.3" (recommended — matches qualifier-band moderate floor; below = noise)
[auto] Number of observations — Q: "Top-3, all matches, or all above threshold?" → Selected: "All above floor" (recommended — ~3-5 expected with current rule table)
[auto] Negative observations — Q: "Show 'uncommon' observations or skip?" → Selected: "Show with observational tone" (recommended — Greg pre-approved 'uncommon' case in requirements)
[auto] FR/RU coordination — Q: "Localize cross-val strings via Phase 46 infra?" → Selected: "Extend MSG.psychologicalSections.crossValidation block" (recommended — single L10N path)
[auto] Display order — Q: "Cross-val before, between, or after HEXACO+Schwartz?" → Selected: "After both sections" (recommended — observations reference already-rendered labels)
[auto] Phase 46 dependency — Q: "Wait for Phase 46 ship before planning?" → Selected: "Hard dependency on Phase 46 ship" (recommended — Phase 46 owns qualifierFor + labels)
```

---

*Phase: 47-display-polish*
*Context gathered: 2026-05-14*
*Mode: --auto (recommended-option auto-selection; single-pass per modes/auto.md cap)*
