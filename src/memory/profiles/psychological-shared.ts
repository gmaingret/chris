/**
 * src/memory/profiles/psychological-shared.ts — Phase 37 Plan 37-02 Task 2
 *                                                (PSCH-07 + PSCH-08)
 *
 * M011 psychological-profile substrate loader. Mirrors the structural shape
 * of M010's `src/memory/profiles/shared.ts:loadProfileSubstrate` but with
 * five locked divergences (37-CONTEXT.md D-15..D-20):
 *
 *   1. Source filter (D-17): SQL `WHERE source='telegram'` instead of the
 *      M010 no-source-filter approach. Pitfall 3 mitigation — speech-source
 *      contamination prevented at the Drizzle WHERE clause, NOT a JS
 *      post-filter. Gmail/Immich/Drive rows are provably absent from the
 *      substrate.
 *   2. RITUAL_RESPONSE exclusion (D-17): SQL `(epistemic_tag IS NULL OR
 *      epistemic_tag != 'RITUAL_RESPONSE')` — psychological profiles must
 *      not be inferred from prompted ritual responses (those are interaction
 *      artifacts, not free-form speech).
 *   3. Calendar-month boundary (D-15): Luxon `DateTime.fromJSDate(now,
 *      { zone: 'Europe/Paris' }).startOf('month').minus({ months: 1 })`
 *      instead of M010's 60-day rolling sliding window. Matches Phase 38's
 *      "1st of month 09:00 Paris" cron semantics; DST-safe.
 *   4. Word counting (D-18): inline `text.trim().split(/\s+/).filter(s =>
 *      s.length > 0).length` per entry, summed. NOT token-based counting
 *      (Pitfall 2 — Russian token inflation 1.5–2.5× would bias the floor
 *      against Cyrillic substrates; we deliberately do not import
 *      messages-API token helpers here).
 *   5. Discriminated-union return (D-16): below-threshold short-circuit
 *      returns BEFORE any second query, so Phase 38 generators narrow on
 *      `belowThreshold` before accessing `corpus`.
 *
 * Pitfall 2 mitigation: this module imports MIN_SPEECH_WORDS ONLY from
 * confidence.ts. It deliberately does NOT import the M010 entry-count gate
 * helper — the word-count gate and the entry-count gate are independent
 * (composing both would incorrectly reject a 5,200-word + 8-entry substrate).
 *
 * NO hash computation here — Phase 38 owns substrate-hash logic.
 * NO `decisions` table query — M011 substrate is corpus-only (D-20).
 *
 * Tests:
 *   - src/memory/profiles/__tests__/psychological-shared.test.ts
 *     (real Docker postgres: source filter, RITUAL_RESPONSE exclusion,
 *      calendar-month boundary, below/above-threshold branches, Russian
 *      word counting, prevHistorySnapshot lookup)
 */
import { and, desc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  profileHistory,
} from '../../db/schema.js';
import { getEpisodicSummariesRange } from '../../pensieve/retrieve.js';
import { MIN_SPEECH_WORDS } from '../confidence.js';

// ── Public types ────────────────────────────────────────────────────────

/**
 * The 3 M011 psychological profile dimensions. Exported for Phase 38 cron
 * dispatcher to import as the canonical profile-type union. Re-exported
 * from `src/memory/profiles.ts` so Phase 39+ consumers have a stable import
 * path from the same module that exports `getPsychologicalProfiles`.
 */
export type PsychologicalProfileType = 'hexaco' | 'schwartz' | 'attachment';

/**
 * Discriminated-union substrate result per D-16. Two branches keyed on
 * `belowThreshold: true | false`.
 *
 *   - `belowThreshold: true` — caller MUST NOT proceed to Sonnet call.
 *     `neededWords` is `MIN_SPEECH_WORDS - wordCount` (always positive when
 *     belowThreshold is true).
 *   - `belowThreshold: false` — caller has the full corpus, episodic
 *     summaries, and prior-history snapshot needed to invoke Sonnet.
 *     `prevHistorySnapshot` is `null` on the very first psychological-profile
 *     fire (no profile_history row exists yet).
 *
 * TypeScript enforces narrowing: a generator that accesses `corpus` without
 * first checking `belowThreshold` is a compile-time error.
 */
export type PsychologicalSubstrate<T> =
  | {
      belowThreshold: true;
      wordCount: number;
      neededWords: number;
    }
  | {
      belowThreshold: false;
      corpus: (typeof pensieveEntries.$inferSelect)[];
      episodicSummaries: (typeof episodicSummaries.$inferSelect)[];
      wordCount: number;
      prevHistorySnapshot: T | null;
    };

// ── Module-private helpers ──────────────────────────────────────────────

/**
 * Map each psychological profile type to its `profile_table_name`
 * discriminator value in the polymorphic `profile_history` table. Phase 38's
 * write path inserts history rows with one of these literal values; this
 * loader's read path filters by the same string.
 */
const PROFILE_TYPE_TO_TABLE_NAME: Record<PsychologicalProfileType, string> = {
  hexaco: 'profile_hexaco',
  schwartz: 'profile_schwartz',
  attachment: 'profile_attachment',
} as const;

/**
 * Inline whitespace-split word counter per 37-CONTEXT.md D-18. Returns
 * `text.trim().split(/\s+/).filter(s => s.length > 0).length`.
 *
 * Pitfall 2 mitigation: This is the substrate's source-of-truth word count.
 * It is deliberately whitespace-based, not token-based — Russian token
 * inflation (1.5–2.5× vs English under cl100k_base) would bias the
 * 5000-word floor against Cyrillic substrates, making it disproportionately
 * easy for an English speaker and disproportionately hard for a Russian
 * speaker to cross the gate.
 *
 * Private (not exported): there is exactly one site that counts words in
 * the substrate (this module) and Phase 37/38 should not duplicate the
 * helper elsewhere.
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((s) => s.length > 0).length;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Load the M011 psychological-profile substrate for `profileType` over the
 * previous calendar month in Europe/Paris. Returns a discriminated union:
 * below-threshold short-circuit (no second query) OR full substrate +
 * episodic summaries + prior-history snapshot.
 *
 * Query shape per D-17:
 *   SELECT * FROM pensieve_entries
 *   WHERE source = 'telegram'
 *     AND (epistemic_tag IS NULL OR epistemic_tag != 'RITUAL_RESPONSE')
 *     AND deleted_at IS NULL
 *     AND created_at >= <startOfMonth(now-1mo, 'Europe/Paris')>
 *     AND created_at <= <endOfMonth(now-1mo, 'Europe/Paris')>
 *
 * Calendar-month boundary per D-15:
 *   monthStart = Luxon(now, Europe/Paris).startOf('month').minus({ months: 1 })
 *   monthEnd   = monthStart.endOf('month')
 *
 * Gate per D-19 + M009 lt→lte lesson:
 *   if (wordCount < MIN_SPEECH_WORDS) → return below-threshold branch
 *   else → load episodic summaries + prevHistorySnapshot, return above branch
 *
 * `wordCount === MIN_SPEECH_WORDS` falls into the above-threshold branch
 * (`<` not `<=`); matches the `isAboveWordThreshold` helper's `>=` semantics.
 *
 * @param profileType which of the 3 psychological profile types to load
 *                    (used only for `prevHistorySnapshot` lookup; the corpus
 *                    query is identical across profile types)
 * @param now         reference instant — defaults to `new Date()`; tests
 *                    pin to assert calendar-month boundary deterministically
 */
export async function loadPsychologicalSubstrate<T = unknown>(
  profileType: PsychologicalProfileType,
  now: Date = new Date(),
): Promise<PsychologicalSubstrate<T>> {
  // D-15: calendar-month boundary in Europe/Paris (DST-safe).
  const nowParis = DateTime.fromJSDate(now, { zone: 'Europe/Paris' });
  const monthStart = nowParis.startOf('month').minus({ months: 1 });
  const monthEnd = monthStart.endOf('month');
  const windowStart = monthStart.toJSDate();
  const windowEnd = monthEnd.toJSDate();

  // D-17: corpus query with SQL-level source filter + RITUAL_RESPONSE
  // exclusion + deletedAt + calendar-month window.
  // Pitfall 3 mitigation: source filter at WHERE clause, NOT JS post-filter.
  const corpus = await db
    .select()
    .from(pensieveEntries)
    .where(
      and(
        eq(pensieveEntries.source, 'telegram'),
        or(
          isNull(pensieveEntries.epistemicTag),
          ne(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'),
        ),
        isNull(pensieveEntries.deletedAt),
        gte(pensieveEntries.createdAt, windowStart),
        lte(pensieveEntries.createdAt, windowEnd),
      ),
    );

  // D-18: inline whitespace word count, NOT token-based — Pitfall 2
  // mitigation against Cyrillic token-inflation bias.
  const wordCount = corpus.reduce(
    (sum, entry) => sum + countWords(entry.content),
    0,
  );

  // D-19: gate using `<` so wordCount === MIN_SPEECH_WORDS is "above"
  // (M009 lt→lte lesson; matches isAboveWordThreshold's `>=`).
  if (wordCount < MIN_SPEECH_WORDS) {
    return {
      belowThreshold: true,
      wordCount,
      neededWords: MIN_SPEECH_WORDS - wordCount,
    };
  }

  // D-20 above-threshold branch: load episodic summaries + prior-history
  // snapshot in parallel. `getEpisodicSummariesRange` is the same helper
  // M010's loadProfileSubstrate uses; Phase 38 generators thread
  // `prevHistorySnapshot` into the Sonnet prompt as the "before" state.
  const [summaries, prevSnapshotRow] = await Promise.all([
    getEpisodicSummariesRange(windowStart, windowEnd),
    db
      .select()
      .from(profileHistory)
      .where(
        eq(
          profileHistory.profileTableName,
          PROFILE_TYPE_TO_TABLE_NAME[profileType],
        ),
      )
      .orderBy(desc(profileHistory.recordedAt))
      .limit(1),
  ]);

  return {
    belowThreshold: false,
    corpus,
    episodicSummaries: summaries,
    wordCount,
    prevHistorySnapshot:
      (prevSnapshotRow[0]?.snapshot as T | undefined) ?? null,
  };
}
