/**
 * src/rituals/display-names.ts — Phase 41 ADJ-02
 *
 * Locale-aware display-name maps for ritual slugs + config-field labels.
 *
 * Per Phase 41 CONTEXT.md D-41-03: a TS constant map (not a DB column) is the
 * source of truth for user-facing names. Three rituals exist today; M013 will
 * add monthly/quarterly rows here, not in DB. Matches the existing
 * `ACKNOWLEDGMENTS` exemplar at `src/chris/refusal.ts:180-184` exactly — same
 * `Record<Lang, string>` shape, same `?? fallback-to-key` semantics.
 *
 * Why "evening journal" not "daily journal" (English slot for daily_journal):
 * CLAUDE.md feedback_evening_journal_naming — the slug was renamed in
 * migration 0011 (voice_note → daily_journal), but the user-facing copy must
 * continue to call it "evening journal". This module is the surface where
 * that rename is honored for Greg.
 *
 * Plan 41-01 only consumes the `English` slot of these maps (EN-only ship
 * for the P0 live-fix). Plan 41-02 begins consuming the FR/RU slots via
 * locale detection at the adjustment-dialogue boundary.
 */
import type { Lang } from '../chris/language.js';

// ── RITUAL_DISPLAY_NAMES ───────────────────────────────────────────────────

/**
 * RITUAL_DISPLAY_NAMES — keyed by the literal `rituals.name` slug (the column
 * value in the DB), valued by per-locale display strings.
 *
 * Three rituals exist in M009/M010/M011: daily_journal, daily_wellbeing,
 * weekly_review. M013 (monthly/quarterly retros) will add rows here without
 * a migration.
 */
export const RITUAL_DISPLAY_NAMES: Record<string, Record<Lang, string>> = {
  daily_journal: {
    English: 'evening journal',
    French: 'journal du soir',
    Russian: 'вечерний журнал',
  },
  daily_wellbeing: {
    English: 'wellbeing check',
    French: 'check bien-être',
    Russian: 'проверка состояния',
  },
  weekly_review: {
    English: 'weekly review',
    French: 'bilan hebdo',
    Russian: 'еженедельный обзор',
  },
};

// ── CONFIG_FIELD_LABELS ────────────────────────────────────────────────────

/**
 * CONFIG_FIELD_LABELS — keyed by config-field name (the literal `proposedChange.field`
 * value Haiku emits), valued by per-locale display strings.
 *
 * Exactly three keys matching the post-ADJ-05 Haiku field whitelist:
 *   fire_at, fire_dow, skip_threshold.
 *
 * `mute_until` is NOT included — Plan 41-02 removes it from the Haiku whitelist,
 * so a label for a field the user can no longer reach via the adjustment
 * dialogue is dead code. The `routeRefusal` not-now path writes
 * adjustment_mute_until directly without Haiku input.
 */
export const CONFIG_FIELD_LABELS: Record<string, Record<Lang, string>> = {
  fire_at: {
    English: 'fire time',
    French: 'heure de déclenchement',
    Russian: 'время срабатывания',
  },
  fire_dow: {
    English: 'day of week',
    French: 'jour de la semaine',
    Russian: 'день недели',
  },
  skip_threshold: {
    English: 'skip threshold',
    French: 'seuil de saut',
    Russian: 'порог пропусков',
  },
};

// ── Lookup helpers ─────────────────────────────────────────────────────────

/**
 * displayName — look up the localized display name for a ritual slug.
 *
 * Falls back to the raw slug when the slug is unknown (parity with
 * `generateRefusalAcknowledgment` at refusal.ts:190-191). This means an
 * unknown ritual still produces *something* downstream — never a crash, never
 * `undefined` leaking into a Telegram message.
 */
export function displayName(slug: string, locale: Lang): string {
  return RITUAL_DISPLAY_NAMES[slug]?.[locale] ?? slug;
}

/**
 * configFieldLabel — look up the localized label for a config-field name.
 *
 * Same fallback semantics as displayName: unknown field → return the raw key.
 */
export function configFieldLabel(field: string, locale: Lang): string {
  return CONFIG_FIELD_LABELS[field]?.[locale] ?? field;
}
