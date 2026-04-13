// Ground-truth reference module — Phase 6 (D-03)
// Authoritative facts about Greg for use in memory audit (Phase 6),
// structured fact injection (Phase 8), and live integration tests (Phase 10).

export type FactCategory =
  | 'identity'
  | 'location_history'
  | 'property'
  | 'business'
  | 'financial';

export interface GroundTruthEntry {
  key: string;
  value: string;
  category: FactCategory;
}

/**
 * Authoritative ground-truth facts about Greg, categorized.
 * Total: 13 entries (identity: 3, location_history: 4, property: 2, business: 3, financial: 1)
 *
 * Source: M006_Trustworthy_Chris.md § Memory audit ground truth
 */
export const GROUND_TRUTH: GroundTruthEntry[] = [
  // identity (3)
  { key: 'nationality', value: 'French', category: 'identity' },
  { key: 'birth_date', value: '1979-06-15', category: 'identity' },
  { key: 'birth_place', value: 'Cagnes-sur-Mer, France', category: 'identity' },

  // location_history (4) — ordered chronologically
  {
    key: 'current_location',
    value: 'Saint Petersburg, Russia (until 2026-04-28)',
    category: 'location_history',
  },
  {
    key: 'next_move',
    value: 'Batumi, Georgia (~1 month, from 2026-04-28)',
    category: 'location_history',
  },
  {
    key: 'after_batumi',
    value: 'Antibes, France (June through end of August 2026)',
    category: 'location_history',
  },
  {
    key: 'permanent_relocation',
    value: 'Batumi, Georgia (permanent, from ~September 2026)',
    category: 'location_history',
  },

  // property (2)
  { key: 'rental_property', value: 'Golfe-Juan, France', category: 'property' },
  { key: 'rental_manager', value: 'Citya (since October 2022)', category: 'property' },

  // business (3)
  { key: 'business_us', value: 'MAINGRET LLC (New Mexico)', category: 'business' },
  { key: 'business_georgia', value: 'Georgian Individual Entrepreneur', category: 'business' },
  { key: 'residency_panama', value: 'Panama permanent residency', category: 'business' },

  // financial (1)
  { key: 'fi_target', value: '$1,500,000', category: 'financial' },
];

/**
 * Flat map for quick key lookups.
 * Used by the audit script (Phase 6) and structured fact injection (Phase 8).
 */
export const GROUND_TRUTH_MAP: Record<string, string> = Object.fromEntries(
  GROUND_TRUTH.map((e) => [e.key, e.value]),
);
