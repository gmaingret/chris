// ── src/chris/locale/strings.ts ─────────────────────────────────────────────
//
// Cross-file locale registers + helpers (Phase 46 L10N-05 + L10N-03).
//
// SCOPE: this module ONLY hosts locale REGISTERS and INPUT-NORMALIZATION
// helpers that are consumed in 2+ files. Per CONTEXT.md D-01 / D-04 this is
// NOT a detection layer (detection stays in `../language.ts`) and NOT a
// catch-all for single-file strings (those stay co-located with their
// consumer per the `MSG`-shape precedent at
// `src/bot/handlers/profile.ts:120-443`).
//
// The single-source-of-truth (`qualifierFor`) replaces the byte-identical
// duplicates that previously lived at:
//   - `src/memory/profiles.ts:705-709`     (prompt-side)
//   - `src/bot/handlers/profile.ts:704-708` (display-side, was `qualifierForPsych`)
//
// The `LANG_QUALIFIER_BANDS` band thresholds are locked verbatim from
// Phase 35 D-07 + Phase 39 CONTEXT.md D-07 — re-banding requires a
// CONTEXT update + a dedicated phase, NOT a drive-by edit here.
//
// FR + RU translations are seed values (CONTEXT.md D-06) — Greg reviews at
// `/gsd-verify-work` and any single string is a one-line patch.

import type { Lang } from '../language.js';

/**
 * Per-locale confidence-band labels for the qualifier function.
 *
 * Bands are locked: `>=0.6` substantial / `>=0.3` moderate / else limited
 * (CONTEXT.md D-13, inherited from Phase 35 D-07 + Phase 39 CONTEXT.md D-07).
 *
 * Greg reviews FR + RU at `/gsd-verify-work`; replacement is a single-line
 * edit per band with no shape churn.
 */
export const LANG_QUALIFIER_BANDS: Readonly<
  Record<Lang, { substantial: string; moderate: string; limited: string }>
> = {
  English: {
    substantial: 'substantial evidence',
    moderate: 'moderate evidence',
    limited: 'limited evidence',
  },
  French: {
    substantial: 'preuves substantielles',
    moderate: 'preuves modérées',
    limited: 'preuves limitées',
  },
  Russian: {
    substantial: 'существенные данные',
    moderate: 'умеренные данные',
    limited: 'ограниченные данные',
  },
} as const;

/**
 * Map a confidence value in `[0, 1]` to its band label for the given locale.
 *
 * Replaces the duplicates at `src/memory/profiles.ts:705-709` and
 * `src/bot/handlers/profile.ts:704-708` (Phase 46 L10N-05). The thresholds
 * (`>=0.6`, `>=0.3`) are byte-identical to the prior implementations and
 * locked verbatim from Phase 35 D-07 + Phase 39 CONTEXT.md D-07.
 *
 * @param c       Confidence value (0..1).
 * @param lang    Locale union from `../language.ts`.
 * @returns       Locale-appropriate band label.
 */
export function qualifierFor(c: number, lang: Lang): string {
  if (c >= 0.6) return LANG_QUALIFIER_BANDS[lang].substantial;
  if (c >= 0.3) return LANG_QUALIFIER_BANDS[lang].moderate;
  return LANG_QUALIFIER_BANDS[lang].limited;
}

/**
 * NFC-normalize input + canonicalize curly/smart apostrophes to the straight
 * ASCII apostrophe (U+0027) BEFORE running locale regex matches.
 *
 * Phase 46 L10N-03 / CONTEXT.md D-14: the macOS keyboard emits a curly
 * apostrophe (U+2019) for French questions like `qu’est-ce que ...`. The
 * previous `INTERROGATIVE_REGEX` only matched the straight apostrophe AND
 * had a broken character class `qu['e]?est-ce que` that false-matched the
 * gibberish `queest-ce que`. The fix is a single normalization step at the
 * regex-input boundary so the consumer regex (`stage1Check` in
 * `weekly-review.ts`) can stay simple.
 *
 * Covered curly variants:
 *   - U+2018 LEFT SINGLE QUOTATION MARK     ‘
 *   - U+2019 RIGHT SINGLE QUOTATION MARK    ’  (macOS default for FR apostrophe)
 *   - U+02BC MODIFIER LETTER APOSTROPHE     ʼ
 *   - U+2032 PRIME                          ′
 *
 * Future FR regex consumers (`refusal.ts` `FR_PATTERNS`,
 * `decisions/triggers-fixtures.ts` `ABORT_PHRASES_FR`) MAY opt-in by calling
 * this helper at their input boundary — NOT migrated in Phase 46 per
 * CONTEXT.md D-17 (defense-in-depth, no live defect documented).
 */
export function normalizeForInterrogativeCheck(s: string): string {
  return s.normalize('NFC').replace(/[‘’ʼ′]/g, "'");
}
