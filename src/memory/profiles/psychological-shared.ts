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
import { createHash } from 'node:crypto';
import { and, desc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { DateTime } from 'luxon';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { db } from '../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  profileHistory,
} from '../../db/schema.js';
import { getEpisodicSummariesRange } from '../../pensieve/retrieve.js';
import { MIN_SPEECH_WORDS } from '../confidence.js';
import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import {
  assemblePsychologicalProfilePrompt,
  type PsychologicalProfilePromptType,
  type PsychologicalProfileSubstrateView,
} from '../psychological-profile-prompt.js';
import { logger } from '../../utils/logger.js';

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

// ── Public helpers (Plan 38-02 — RESEARCH Finding 2 + Finding 3) ────────

/**
 * Map each psychological profile type to its `profile_table_name`
 * discriminator value in the polymorphic `profile_history` table. Phase 38's
 * write path inserts history rows with one of these literal values; this
 * loader's read path filters by the same string.
 *
 * Exported in Plan 38-02 (RESEARCH Finding 2) — generators import this to
 * write `profile_history` rows; centralizing the discriminator prevents the
 * 'typo in migration vs application code' silent-failure class flagged in
 * PITFALLS.md (a typo would cause profile_history INSERTs to use a string
 * that no reader filter ever matches, silently dropping the audit trail).
 */
export const PROFILE_TYPE_TO_TABLE_NAME: Record<PsychologicalProfileType, string> = {
  hexaco: 'profile_hexaco',
  schwartz: 'profile_schwartz',
  attachment: 'profile_attachment',
} as const;

/**
 * Discriminated outcome union for the Plan 38-02 generators (D-14).
 *
 * Three cases — note the deliberate ABSENCE of `'skipped_no_change'`
 * (M010's 4-outcome union has it; M011's 3-outcome union DOES NOT). Per
 * PGEN-06 UNCONDITIONAL FIRE, a matching prior substrate hash does NOT
 * short-circuit the Sonnet call — substrate_hash is recorded on every fire
 * but ignored for skip. The hash-skip branch from M010 shared.ts:399-409
 * is DELETED in the Plan 38-02 generator helper. Surfacing a
 * `'skipped_no_change'` outcome here would imply a hash-skip code path
 * exists, which it intentionally does not.
 *
 * Outcome semantics:
 *   - `updated` — Sonnet call succeeded, row upserted, profile_history row
 *     written. `wordCount` reflects the substrate that was inferred from;
 *     `overallConfidence` is the Sonnet-emitted value stored verbatim into
 *     the row (D-08).
 *   - `skipped_below_threshold` — substrate.belowThreshold === true.
 *     Generator short-circuited BEFORE the Sonnet call; no row mutation;
 *     no profile_history row. `wordCount` is the (sub-floor) substrate
 *     count for logging context.
 *   - `error` — anything from "currentRow missing" through Sonnet
 *     rejection, Zod re-validate failure, DB write error. The orchestrator
 *     (Plan 38-03) reads `error` for the partial-failure aggregation.
 *     `durationMs` is set even on error so the cron alert can include it.
 */
export type PsychologicalProfileGenerationOutcome = {
  profileType: 'hexaco' | 'schwartz';
  outcome: 'updated' | 'skipped_below_threshold' | 'error';
  error?: string;
  wordCount?: number;
  overallConfidence?: number;
  durationMs: number;
};

/**
 * Compute the substrate hash for the M011 psychological-profile fire.
 *
 * Sibling of M010's `computeSubstrateHash` (src/memory/profiles/shared.ts:298-311)
 * with an M011-appropriate input shape per RESEARCH Finding 3 (Path A):
 *   - NO `decisionIds` — Phase 37 substrate is corpus-only per PSCH-07
 *     (D-20 divergence from M010); resolved decisions are NOT part of the
 *     psychological substrate.
 *   - Canonical JSON over {pensieveIds.sort(), episodicDates.sort(),
 *     schemaVersion}; SHA-256 → 64-char lowercase hex string.
 *   - ID-and-date-only (NOT content) — matches M010 D-15 discipline. Text
 *     mutation on an existing pensieve row leaves the ID set unchanged →
 *     hash matches. PGEN-06 UNCONDITIONAL FIRE renders this acceptable: the
 *     hash is audit-trail-only; Sonnet is invoked regardless.
 *
 * Used by Plan 38-02 generators to record `substrate_hash` on every fire.
 * The generator does NOT short-circuit on a matching prior hash (PGEN-06 /
 * D-17) — the hash is persisted but not used for skip.
 */
export function computePsychologicalSubstrateHash(
  corpus: ReadonlyArray<{ id: string }>,
  episodicSummariesArg: ReadonlyArray<{ summaryDate: string }>,
  schemaVersion: number,
): string {
  const canonicalJson = JSON.stringify({
    episodicDates: episodicSummariesArg.map((s) => s.summaryDate).sort(),
    pensieveIds: corpus.map((r) => r.id).sort(),
    schemaVersion,
  });
  return createHash('sha256').update(canonicalJson).digest('hex');
}

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

// ── Per-generator runner helper (Plan 38-02 — D-11, D-14, PGEN-02, PGEN-03) ──

/**
 * Per-generator config consumed by `runPsychologicalProfileGenerator`. Each
 * of the 2 generator files (hexaco.ts + schwartz.ts) declares one as a
 * module-private constant and passes it into the runner.
 *
 * `flattenSonnetOutput` maps the Sonnet-emitted v3-parsed object (keyed by
 * snake_case schema field names) to the Drizzle camelCase column names for
 * the upsert. Each generator's column set differs (6 HEXACO dims vs 10
 * Schwartz values), so each file declares its own flattener.
 *
 * Top-level boundary fields `data_consistency` + `overall_confidence` are
 * NOT returned from `flattenSonnetOutput` — the runner writes them to
 * dedicated row columns (`overallConfidence`) separately.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PsychologicalProfileGeneratorConfig<TBoundaryData extends { data_consistency: number; overall_confidence: number }> = {
  profileType: PsychologicalProfilePromptType;
  v3SchemaBoundary: z.ZodType<TBoundaryData>;
  // The v4 boundary schema — accepted as `any` because zod/v4 type-imports
  // collide with the @anthropic-ai/sdk helper's expected ZodType<T> input;
  // every call site locally tightens. Pattern mirrors M010 shared.ts:169.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  v4SchemaBoundary: any;
  // The Drizzle profile table. Loose PgTable shape because each profile
  // table has a different column set; the runner only reads universal
  // columns (id, name, substrateHash, schemaVersion) and writes via
  // onConflictDoUpdate on the name='primary' sentinel.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable & { name: PgColumn<any, any, any>; [key: string]: any };
  profileTableName: 'profile_hexaco' | 'profile_schwartz';
  flattenSonnetOutput: (parsed: TBoundaryData) => Record<string, unknown>;
};

/**
 * Generic per-generator runner for the 2 M011 psychological profiles. The
 * 11-step body per RESEARCH Finding 3 (Plan 38-02 "runPsychologicalProfileGenerator
 * body"). Mirrors the structural shape of M010's runProfileGenerator with
 * FOUR locked divergences:
 *
 *   1. Discriminated-union threshold narrow (RESEARCH Finding 4) — uses
 *      `if (substrate.belowThreshold)` rather than M010's loose
 *      `isAboveThreshold(entryCount)` check. TypeScript narrows substrate
 *      to the above-threshold branch below the early-return, so `.corpus`
 *      access is type-safe.
 *
 *   2. NO HASH-SKIP BRANCH (Pitfall 1 + PGEN-06 UNCONDITIONAL FIRE) —
 *      substrate_hash is computed via `computePsychologicalSubstrateHash`
 *      and persisted, but the M010 `if (currentRow.substrateHash ===
 *      computedHash) return skip` branch (shared.ts:399-409) is DELETED.
 *      Sonnet is invoked on every fire regardless of hash match. The
 *      regression detector for any future "fix" that re-introduces
 *      hash-skip is the 3-cycle integration test in Task 3.
 *
 *   3. NO `.refine()` CEILING (D-33) — M010's closure-captured volume-weight
 *      `.refine()` overlay is absent. M011's word-count gating is upstream
 *      in `loadPsychologicalSubstrate` (PSCH-08); the prompt-level
 *      r ≈ .31–.41 empirical-limits framing is the only ceiling enforcement.
 *
 *   4. Host-injects `last_updated: new Date().toISOString()` per dim BETWEEN
 *      the v4 parse and v3 re-validate (Pitfall 7). Phase 37 v4 dim schema
 *      declares `last_updated: zV4.string()` (NOT `.datetime()`) but v3 dim
 *      schema declares `last_updated: z.string().datetime().strict()` — a
 *      Sonnet output with an invalid datetime would pass v4 but fail v3 and
 *      return 'error'. The host-inject prevents this by overwriting the
 *      per-dim `last_updated` with a server-side ISO string AFTER v4 parse,
 *      BEFORE v3 re-validate.
 *
 * NO `computeProfileConfidence` call (D-08; PGEN-07) — Sonnet emits
 * `overall_confidence` directly at the SDK boundary, and the host stores it
 * verbatim into the row's overall_confidence column. NO host-side stddev /
 * inter-period math (deferred to v2.6.1 / CONS-01 per D-20).
 *
 * Body order (Steps 1-11 per RESEARCH Finding 3 — fixed; do not reorder):
 *   1. Discriminated-union threshold narrow (Finding 4)
 *   2. Read current row by name='primary' sentinel
 *   3. Compute substrate hash via computePsychologicalSubstrateHash
 *   4. NO hash-skip branch (PGEN-06)
 *   5. NO `.refine()` ceiling (D-33)
 *   6. Build prompt with substrate.prevHistorySnapshot (Finding 3, D-09)
 *   7. anthropic.messages.parse + zodOutputFormat(v4SchemaBoundary)
 *   8. Host-inject `last_updated` per dim (Pitfall 7)
 *   9. v3 boundary re-validate
 *  10. Write profile_history row with prior currentRow snapshot
 *  11. Upsert via name='primary' sentinel + log outcome
 *
 * Steps 7-11 are wrapped in try/catch — any throw inside the call chain is
 * captured as outcome `'error'` with the message in `error`, then logged
 * via `chris.psychological.${profileType}.error`. The orchestrator (Plan
 * 38-03) calls both generators via `Promise.allSettled` for outer
 * isolation; this inner catch ensures a single generator's failure produces
 * a deterministic outcome rather than a rejected promise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runPsychologicalProfileGenerator<TBoundaryData extends { data_consistency: number; overall_confidence: number; [k: string]: any }>(
  config: PsychologicalProfileGeneratorConfig<TBoundaryData>,
  substrate: PsychologicalSubstrate<unknown>,
): Promise<PsychologicalProfileGenerationOutcome> {
  const startMs = Date.now();
  const { profileType, v3SchemaBoundary, v4SchemaBoundary, table, profileTableName, flattenSonnetOutput } = config;

  // Step 1 — discriminated-union threshold narrow (RESEARCH Finding 4).
  // NOT a loose `isAboveThreshold(entryCount)` check (M010 pattern) — the
  // word-count gate already fired at substrate load (PSCH-08); this narrow
  // simply unboxes the discriminated union for the above-threshold branch
  // so `.corpus`, `.episodicSummaries`, `.prevHistorySnapshot` access is
  // type-safe below.
  if (substrate.belowThreshold) {
    logger.info(
      { profileType, wordCount: substrate.wordCount, neededWords: substrate.neededWords, threshold: MIN_SPEECH_WORDS },
      `chris.psychological.${profileType}.skipped_below_threshold`,
    );
    return {
      profileType: profileType as 'hexaco' | 'schwartz',
      outcome: 'skipped_below_threshold',
      wordCount: substrate.wordCount,
      durationMs: Date.now() - startMs,
    };
  }

  // Step 2 — read current row by name='primary' sentinel (mirror M010
  // shared.ts:386-391). The migration 0013 cold-start INSERT seeds this row
  // with substrate_hash='' and dim values as jsonb null; if the row is
  // missing the migration didn't run (or someone deleted it manually),
  // which is an unrecoverable error class — surface it as outcome 'error'.
  let currentRow: Record<string, unknown> | null;
  try {
    const rows = await db.select().from(table).where(eq(table.name, 'primary')).limit(1);
    currentRow = (rows[0] ?? null) as Record<string, unknown> | null;
    if (!currentRow) {
      throw new Error(`${profileType}.psychological.generate: no 'primary' row found (cold-start seed missing — check migration 0013)`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { profileType, err: errMsg, durationMs: Date.now() - startMs },
      `chris.psychological.${profileType}.error`,
    );
    return {
      profileType: profileType as 'hexaco' | 'schwartz',
      outcome: 'error',
      error: errMsg,
      durationMs: Date.now() - startMs,
    };
  }

  // Step 3 — compute substrate hash. Uses the M011-appropriate sibling
  // helper computePsychologicalSubstrateHash (RESEARCH Finding 3 Path A);
  // sorts pensieveIds + episodicDates, includes schemaVersion, omits any
  // decisionIds (substrate is corpus-only per PSCH-07 / D-20).
  const computedHash = computePsychologicalSubstrateHash(
    substrate.corpus,
    substrate.episodicSummaries,
    (currentRow.schemaVersion as number | undefined) ?? 1,
  );

  // Step 4 — PGEN-06 (D-17): UNCONDITIONAL FIRE. substrate_hash is recorded
  // below but does NOT short-circuit the Sonnet call. The M010 hash-skip
  // branch (src/memory/profiles/shared.ts:399-409, the
  // `if (currentRow.substrateHash === computedHash) return skip` block) is
  // DELETED here. Sonnet is invoked on every fire regardless of hash match.
  // See psychological-profile-updater.ts (Plan 38-03) for the rationale
  // comment at the orchestrator level. The 3-cycle integration test in
  // src/memory/__tests__/psychological-profile-updater.integration.test.ts
  // is the regression detector — Cycle 2 asserts cumulative 4 Sonnet calls
  // on IDENTICAL substrate (NOT 2 — direct inverse of M010 PTEST-03).

  // Step 5 — NO `.refine()` ceiling (D-33). The M010 closure-captured
  // volume-weight overlay (shared.ts:417-420) is absent — M011's
  // word-count gating already fired upstream at substrate load (PSCH-08);
  // the prompt-level r ≈ .31–.41 empirical-limits framing is the only
  // ceiling enforcement on the boundary schema.

  // Step 6 — build prompt with substrate.prevHistorySnapshot threaded
  // directly (RESEARCH Finding 3 + D-09; NO extractPrevState — that helper
  // is M010-specific). PsychologicalProfileSubstrateView is the narrow
  // structural type the prompt builder consumes; the substrate's full
  // corpus rows are mapped to it preserving (id, epistemicTag, content,
  // createdAt).
  const view: PsychologicalProfileSubstrateView = {
    corpus: substrate.corpus.map((e) => ({
      id: e.id,
      epistemicTag: e.epistemicTag,
      content: e.content,
      // createdAt is timestamp().defaultNow() in the schema — non-null at
      // runtime even though Drizzle infers Date|null due to default-inference.
      createdAt: e.createdAt ?? new Date(0),
    })),
    episodicSummaries: substrate.episodicSummaries.map((s) => ({
      summaryDate: s.summaryDate,
      summary: s.summary,
    })),
    wordCount: substrate.wordCount,
  };
  const prompt = assemblePsychologicalProfilePrompt(
    profileType,
    view,
    substrate.prevHistorySnapshot,
    substrate.wordCount,
  );

  // Steps 7-11 wrapped in try/catch for D-21 error isolation. The
  // orchestrator (Plan 38-03) wraps the runner in Promise.allSettled for
  // outer isolation; this inner catch ensures a single failure produces a
  // deterministic 'error' outcome rather than a rejected promise.
  try {
    // Step 7 — anthropic.messages.parse with SONNET_MODEL + zodOutputFormat
    // on the v4 boundary schema (mirror M010 shared.ts:457-480 verbatim).
    // max_tokens: 4000 (M010 uses 2000) — HEXACO emits 6 dim objects ×
    // {score, confidence, last_updated} + 2 top-level fields; Schwartz
    // emits 10 dim objects + 2 top-level — at the upper bound of M010
    // single-profile output.
    const response = await anthropic.messages.parse({
      model: SONNET_MODEL,
      max_tokens: 4000,
      system: [
        {
          type: 'text' as const,
          text: prompt.system,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [
        {
          role: 'user' as const,
          content: prompt.user,
        },
      ],
      output_config: {
        // SDK type/runtime mismatch per src/episodic/consolidate.ts:156 +
        // src/rituals/weekly-review.ts:392 — same cast pattern.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        format: zodOutputFormat(v4SchemaBoundary as unknown as any),
      },
    });
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(`${profileType}.psychological.sonnet: parsed_output is null`);
    }

    // Step 8 — host-inject `last_updated` per dim BEFORE v3 re-validate
    // (Pitfall 7). Phase 37 v4 dim schema declares
    // `last_updated: zV4.string()` (NOT `.datetime()`) but v3 dim schema
    // declares `last_updated: z.string().datetime().strict()`. A Sonnet
    // output with an invalid datetime (or missing `last_updated`) would
    // pass v4 but fail v3 and return 'error'. The host-inject overwrites
    // per-dim `last_updated` with a server-side ISO string AFTER v4 parse,
    // BEFORE v3 re-validate. The top-level boundary fields
    // (`data_consistency`, `overall_confidence`) are NOT mutated — only
    // per-dim objects.
    const nowIso = new Date().toISOString();
    const parsedRaw = response.parsed_output as Record<string, unknown>;
    for (const dimKey of Object.keys(parsedRaw)) {
      if (dimKey === 'data_consistency' || dimKey === 'overall_confidence') continue;
      const dimValue = parsedRaw[dimKey];
      if (dimValue !== null && typeof dimValue === 'object' && !Array.isArray(dimValue)) {
        (dimValue as Record<string, unknown>).last_updated = nowIso;
      }
    }

    // Step 9 — v3 boundary re-validate (M008/M009 D-29-02 discipline; v4
    // emits at the SDK boundary, v3 is the contract source-of-truth).
    const sonnetOut = v3SchemaBoundary.parse(parsedRaw);

    // Step 10 — write profile_history row with prior currentRow snapshot
    // BEFORE the upsert (mirror M010 shared.ts:495-501). PGEN-06: written
    // on EVERY successful fire (not only on outcome 'updated' — M010 wrote
    // only on update). Plan 38-02 D-14: the only paths that skip
    // profile_history are 'skipped_below_threshold' (early return at Step 1
    // before reaching here) and 'error' (caught below). The cold-start row
    // from migration 0013 carries dim values as jsonb null; that null
    // snapshot is written verbatim on the first fire as the "prior state"
    // record.
    if (currentRow.id) {
      await db.insert(profileHistory).values({
        profileTableName: profileTableName,
        profileId: currentRow.id as string,
        snapshot: currentRow as Record<string, unknown>,
      });
    }

    // Step 11 — upsert via name='primary' sentinel (mirror M010
    // shared.ts:514-541 with M011 column substitutions). jsonb encoding
    // follows the M010 pattern: each dim value is JSON-stringified +
    // SQL-cast to jsonb via `${serialized}::jsonb` to handle JS null
    // correctly (the jsonb columns are .notNull() with default
    // `'null'::jsonb` — Drizzle serializing JS null sends SQL NULL which
    // violates the NOT NULL constraint).
    const flat = flattenSonnetOutput(sonnetOut);
    const flatEncoded: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(flat)) {
      const serialized = v === undefined ? 'null' : JSON.stringify(v);
      flatEncoded[k] = sql`${serialized}::jsonb`;
    }

    // PGEN-06: substrate_hash is recorded on every fire (audit-trail only;
    // NOT used for skip — see Step 4 comment). The host stores Sonnet's
    // overall_confidence verbatim per D-08 / PGEN-07.
    const upsertValues: Record<string, unknown> = {
      name: 'primary',
      schemaVersion: (currentRow.schemaVersion as number | undefined) ?? 1,
      substrateHash: computedHash,
      overallConfidence: sonnetOut.overall_confidence,
      // Phase 43 CONTRACT-03 / D-14: persist Sonnet's emitted data_consistency
      // to the new column on every fire. sonnetOut.data_consistency is a
      // typed number from the v4 boundary parse (psychological-schemas.ts:166).
      // profile_history snapshots auto-capture this via the polymorphic
      // full-row copy at shared.ts:495-501 (no separate history wiring).
      dataConsistency: sonnetOut.data_consistency,
      wordCount: substrate.wordCount,
      wordCountAtLastRun: substrate.wordCount,
      ...flatEncoded,
      lastUpdated: new Date(),
    };
    await db
      .insert(table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(upsertValues as any)
      .onConflictDoUpdate({
        target: table.name,
        set: upsertValues,
      });

    logger.info(
      {
        profileType,
        wordCount: substrate.wordCount,
        overallConfidence: sonnetOut.overall_confidence,
        dataConsistency: sonnetOut.data_consistency,
        substrateHash: computedHash,
        durationMs: Date.now() - startMs,
      },
      `chris.psychological.${profileType}.updated`,
    );
    return {
      profileType: profileType as 'hexaco' | 'schwartz',
      outcome: 'updated',
      wordCount: substrate.wordCount,
      overallConfidence: sonnetOut.overall_confidence,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { profileType, err: errMsg, durationMs: Date.now() - startMs },
      `chris.psychological.${profileType}.error`,
    );
    return {
      profileType: profileType as 'hexaco' | 'schwartz',
      outcome: 'error',
      error: errMsg,
      durationMs: Date.now() - startMs,
    };
  }
}
