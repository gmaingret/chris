// Ground-truth reference module — Phase 6 (D-03) + 2026-05-11 dynamic refactor
//
// Authoritative facts about Greg for use in:
//   - Memory audit (Phase 6 / src/scripts/audit-pensieve.ts)
//   - Structured fact injection into system prompts (Phase 8 /
//     src/chris/personality.ts:buildKnownFactsBlock)
//   - Live integration tests (Phase 10 / src/chris/__tests__/live-integration.test.ts)
//
// 2026-05-11 refactor — "nothing should be hardcoded":
//   Stable facts (identity, business, property, financial) remain
//   straightforward constants — they don't decay with time. Locations were
//   previously hardcoded `current_location: "Saint Petersburg until 2026-04-28"`
//   style entries that went stale the moment today's date crossed the
//   embedded boundary. Replaced with a dated LOCATION_LOG + getter functions
//   that pick the live entry based on `at`. Phase 34 will eventually replace
//   even this with Pensieve-derived profile inference, but the log is the
//   right interim shape (matches Phase 33's profile_history table model).

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
 * LocationEntry — one stay in Greg's location timeline.
 *   - `from`:       ISO date when Greg arrives / arrived (inclusive).
 *   - `until`:      ISO date when Greg leaves (exclusive). null = open-ended.
 *   - `place`:      Human-readable place name with country.
 *   - `permanent`:  true means this is the long-term home (no planned move
 *                   after). Used to phrase next_move correctly.
 */
export interface LocationEntry {
  from: string;
  until: string | null;
  place: string;
  permanent?: boolean;
}

/**
 * LOCATION_LOG — chronological log of Greg's stays and planned moves.
 *
 * Source of truth: M006_Trustworthy_Chris.md § Memory audit ground truth +
 * Greg's confirmed plans as of 2026-05-11.
 *
 * Maintenance contract: append-only-shaped. When plans change:
 *   - Don't mutate past entries (history is observed in Pensieve).
 *   - Add new entries for new plans.
 *   - Adjust `until` on the entry that the plan supersedes.
 *
 * Entries are ordered chronologically. The first entry whose `from <= at`
 * and (`until` is null OR `at < until`) is the current location at `at`.
 */
const LOCATION_LOG: LocationEntry[] = [
  { from: '2026-01-01', until: '2026-04-28', place: 'Saint Petersburg, Russia' },
  { from: '2026-04-28', until: '2026-05-16', place: 'Batumi, Georgia' },
  { from: '2026-05-16', until: '2026-09-01', place: 'Antibes, France' },
  { from: '2026-09-01', until: null,         place: 'Batumi, Georgia', permanent: true },
];

/**
 * Get the current LocationEntry for a given date. Returns null only if
 * `at` falls before the first entry (shouldn't happen in normal usage).
 */
export function getCurrentLocation(at: Date = new Date()): LocationEntry | null {
  const isoNow = at.toISOString().slice(0, 10);
  for (const entry of LOCATION_LOG) {
    const afterFrom = entry.from <= isoNow;
    const beforeUntil = entry.until === null || isoNow < entry.until;
    if (afterFrom && beforeUntil) return entry;
  }
  return null;
}

/**
 * Get the next-move LocationEntry after the current one. Returns null when
 * the current entry is `permanent: true` or no further entries exist.
 */
export function getNextMove(at: Date = new Date()): LocationEntry | null {
  const current = getCurrentLocation(at);
  if (!current || current.permanent) return null;
  const idx = LOCATION_LOG.indexOf(current);
  return LOCATION_LOG[idx + 1] ?? null;
}

function renderLocationFact(entry: LocationEntry, kind: 'current' | 'next'): string {
  if (entry.permanent) {
    return `${entry.place} (permanent, from ${entry.from})`;
  }
  if (entry.until) {
    if (kind === 'current') return `${entry.place} (until ${entry.until})`;
    return `${entry.place} (from ${entry.from} to ${entry.until})`;
  }
  return entry.place;
}

/**
 * Stable, time-independent facts.
 *
 * These don't decay — Greg's nationality, birthplace, and business
 * registrations don't change with the calendar. Location entries are
 * derived dynamically from LOCATION_LOG and injected by getGroundTruth.
 */
const STABLE_FACTS: GroundTruthEntry[] = [
  // identity (3)
  { key: 'nationality', value: 'French', category: 'identity' },
  { key: 'birth_date', value: '1979-06-15', category: 'identity' },
  { key: 'birth_place', value: 'Cagnes-sur-Mer, France', category: 'identity' },

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
 * Get the full GROUND_TRUTH list, with location facts derived from
 * LOCATION_LOG at time `at`. Default `at = new Date()` so callers can ignore
 * the parameter for "right now" semantics.
 *
 * Returned array is freshly constructed on each call — callers may safely
 * mutate or filter without affecting future calls.
 */
export function getGroundTruth(at: Date = new Date()): GroundTruthEntry[] {
  const current = getCurrentLocation(at);
  const next = getNextMove(at);
  const locations: GroundTruthEntry[] = [];
  if (current) {
    locations.push({
      key: 'current_location',
      value: renderLocationFact(current, 'current'),
      category: 'location_history',
    });
  }
  if (next) {
    locations.push({
      key: 'next_move',
      value: renderLocationFact(next, 'next'),
      category: 'location_history',
    });
  }
  return [
    ...STABLE_FACTS.filter((f) => f.category === 'identity'),
    ...locations,
    ...STABLE_FACTS.filter((f) => f.category !== 'identity'),
  ];
}

/**
 * Backward-compat const — evaluated once at module load using current `Date`.
 * Stale by definition: any code that reads `GROUND_TRUTH` after the
 * application has been running long enough to cross a location boundary
 * gets a snapshot from startup, not "right now". For freshness-sensitive
 * call sites (system-prompt injection, recent audits), prefer
 * `getGroundTruth(new Date())`.
 *
 * Still exported because:
 *   - Phase 6 audit script can tolerate startup-snapshot semantics
 *     (operator runs it interactively; restart is cheap).
 *   - Tests that import this const continue to compile; behavior changes
 *     only when the log boundary shifts during a long-running test process.
 */
export const GROUND_TRUTH: GroundTruthEntry[] = getGroundTruth();

/**
 * Flat map for quick key lookups. Same backward-compat caveat as GROUND_TRUTH.
 * Use `getGroundTruthMap(at)` for freshness.
 */
export const GROUND_TRUTH_MAP: Record<string, string> = Object.fromEntries(
  GROUND_TRUTH.map((e) => [e.key, e.value]),
);

/**
 * Date-aware variant of GROUND_TRUTH_MAP.
 */
export function getGroundTruthMap(at: Date = new Date()): Record<string, string> {
  return Object.fromEntries(getGroundTruth(at).map((e) => [e.key, e.value]));
}
