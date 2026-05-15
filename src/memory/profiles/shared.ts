/**
 * src/memory/profiles/shared.ts — Phase 34 Plan 02 (M010)
 *
 * Shared substrate loader + SHA-256 substrate-hash + generic generator helper
 * for the 4 operational-profile dimensions (jurisdictional, capital, health,
 * family). Sits between Plan 34-01's pure-function prompt builder and the 4
 * per-dimension generator files.
 *
 * HARD CO-LOC #M10-3: the substrate-hash logic ships HERE in the SAME plan as
 * the two-cycle regression test (src/memory/profiles/__tests__/generators.two-cycle.test.ts).
 * gsd-plan-checker refuses if the hash logic and the second-fire-blindness
 * regression detector are split across plans. M009 `lt→lte` second-fire bug
 * (commit c76cb86, 2026-05-10) is the direct precedent class.
 *
 * Satisfies (per 34-CONTEXT.md):
 *   - D-08 — uniform per-dimension generator body (extracted into
 *            runProfileGenerator helper; the 4 dimension files collapse to
 *            ~15-line dispatchers)
 *   - D-09 — dimension config object shape
 *   - D-10 — Sonnet model = SONNET_MODEL import (never hardcoded)
 *   - D-11 — discriminated ProfileGenerationOutcome union
 *   - D-12, D-13, D-14 — loadProfileSubstrate called ONCE per fire; pulls
 *            tag-filtered Pensieve + episodic-summary + resolved-decision
 *            substrate over the 60-day rolling window
 *   - D-15 — SHA-256 over canonical JSON of {pensieveIds.sort,
 *            episodicDates.sort, decisionIds.sort, schemaVersion}; ID-only,
 *            NOT content
 *   - D-16 — schemaVersion participates in the hash (cache-bust on schema bump)
 *   - D-17 — per-dimension hash comparison (each generator independently
 *            compares its own substrate_hash; Promise.allSettled isolation)
 *   - D-18 — Phase 33 seed-row substrate_hash='' never matches; first fire
 *            ALWAYS proceeds to Sonnet
 *   - D-19 — threshold check FIRST (cheaper short-circuit; below 10 entries
 *            → log 'chris.profile.threshold.below_minimum' verbatim, no
 *            Sonnet call, return 'profile_below_threshold')
 *   - D-20 — entryCount = pensieveEntries.length (NOT aggregate; episodic
 *            summaries are derived, not facts-of-record)
 *   - D-29 — write-before-upsert: snapshot current row to profile_history
 *            BEFORE the onConflictDoUpdate (success path ONLY)
 *   - D-30 — full-row snapshot (NOT diff)
 *   - D-32 — closure-captured volume-weight ceiling .refine() OVERLAY on the
 *            v4 schema, constructed INSIDE runProfileGenerator function body
 *            (RESEARCH.md residual risk lines 938-941 — entryCount is
 *            per-fire substrate-dependent; module-scope construction would
 *            silently capture a stale value)
 *
 * Tests:
 *   - src/memory/profiles/__tests__/shared.test.ts (substrate loader + hash)
 *   - src/memory/profiles/__tests__/refine.test.ts (closure-capture pattern)
 *   - src/memory/profiles/__tests__/generators.sparse.test.ts (threshold)
 *   - src/memory/profiles/__tests__/generators.two-cycle.test.ts (HARD CO-LOC #M10-3)
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { z as z4 } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { db } from '../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  decisions,
  profileHistory,
} from '../../db/schema.js';
import { getEpisodicSummariesRange } from '../../pensieve/retrieve.js';
import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import {
  assembleProfilePrompt,
  type ProfilePromptDimension,
  type ProfileSubstrateView,
} from '../profile-prompt.js';
import { computeProfileConfidence, isAboveThreshold, MIN_ENTRIES_THRESHOLD } from '../confidence.js';
import { logger } from '../../utils/logger.js';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * 60-day rolling substrate window per D-13. Claude's Discretion (CONTEXT.md
 * "Substrate window length") locked at 60 — matches the rolling-context
 * horizon used elsewhere in M008/M009. Can be widened to 90d in v2.5.1 if
 * Phase 33 ground-truth seed coverage proves 60 too narrow.
 */
export const SUBSTRATE_WINDOW_DAYS = 60;

/**
 * D-13: case-sensitive Pensieve tag union for substrate filtering. These are
 * the 4 "facts-of-record" tag types — INSTRUCTION/INSIGHT/RITUAL_RESPONSE/
 * EMOTION/BELIEF/etc. are excluded (they are not facts about Greg's
 * operational profile, they are interaction artifacts or derived signal).
 *
 * Verbatim match against `epistemicTagEnum` values at
 * src/db/schema.ts:31-46. The tag-filter strategy is OQ-1 resolved (CONTEXT.md
 * D-12) — tag-only, no keyword/semantic. Per-dimension filtering happens
 * inside the prompt's dimensionSpecificDirective (Sonnet ignores irrelevant
 * entries); per-dimension substrate views are deferred to v2.5.1.
 */
export const PROFILE_SUBSTRATE_TAGS = ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'] as const;

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Full DB-typed substrate slice loaded once per fire. Wider than the
 * structural `ProfileSubstrateView` declared in profile-prompt.ts: this type
 * IS-A ProfileSubstrateView (structural assignability — fields can be wider).
 * The generator code passes the full ProfileSubstrate where
 * `assembleProfilePrompt` expects ProfileSubstrateView — TS accepts.
 *
 * `entryCount` is `pensieveEntries.length` per D-20 (Pensieve count gates the
 * threshold, NOT aggregate across all 3 sources — episodic summaries are
 * derived from past Pensieve entries, not new facts).
 */
export type ProfileSubstrate = {
  pensieveEntries: (typeof pensieveEntries.$inferSelect)[];
  episodicSummaries: (typeof episodicSummaries.$inferSelect)[];
  decisions: (typeof decisions.$inferSelect)[];
  entryCount: number;
};

/**
 * Slim row metadata participating in the substrate hash (D-15 + D-16). Read
 * off the current profile table row before computing the hash; the
 * schema_version field is the cache-bust knob — bumping it invalidates all
 * prior hashes and forces regen on next fire.
 */
export type PrevStateMeta = {
  substrate_hash: string;
  schema_version: number;
};

/**
 * Discriminated outcome union per D-11. Each generator returns exactly one of
 * these four shapes; the orchestrator (Plan 34-03) aggregates them via
 * Promise.allSettled with per-dimension isolation (D-21).
 *
 * Log key shape: `chris.profile.<outcome>` for the three non-threshold cases;
 * `chris.profile.threshold.below_minimum` verbatim for the threshold case
 * (REQUIREMENTS GEN-06 names this verbatim).
 */
export type ProfileGenerationOutcome =
  | { dimension: ProfilePromptDimension; outcome: 'profile_updated'; entryCount: number; confidence: number; durationMs: number }
  | { dimension: ProfilePromptDimension; outcome: 'profile_skipped_no_change'; durationMs: number }
  | { dimension: ProfilePromptDimension; outcome: 'profile_below_threshold'; entryCount: number; durationMs: number }
  | { dimension: ProfilePromptDimension; outcome: 'profile_generation_failed'; error: string; durationMs: number };

/**
 * Per-dimension config consumed by `runProfileGenerator`. Each of the 4
 * dimension files declares one of these as a module-private constant and
 * passes it in.
 *
 * `flattenSonnetOutput` maps the Sonnet-emitted v3-parsed object (keyed by
 * snake_case schema field names) to the Drizzle camelCase column names for
 * the upsert. Each dimension's column set differs, so each file declares its
 * own flattener.
 *
 * `extractPrevState` extracts the prior-fire jsonb fields from a current-row
 * SELECT into a shape the prompt's previous-state block can render. May
 * return `null` to indicate the prior state is "effectively empty" (e.g.,
 * Phase 33 seed row with `substrate_hash=''` and confidence-zero defaults).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProfileGeneratorConfig<TData extends { data_consistency: number }> = {
  dimension: ProfilePromptDimension;
  v3Schema: z.ZodType<TData>;
  // The v4 schema type. We accept `any` here because zod/v4 type-imports
  // collide with the @anthropic-ai/sdk helper's expected ZodType<T> input;
  // every call site is locally tightened.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  v4Schema: any;
  // The Drizzle profile table. We use a loose PgTable shape because each
  // dimension table has a different column set; the generator only reads
  // the universal columns (id, name, substrateHash, schemaVersion) plus
  // calls `eq(table.name, 'primary')` on the name column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable & { name: PgColumn<any, any, any>; [key: string]: any };
  profileTableName: string;
  flattenSonnetOutput: (parsed: TData) => Record<string, unknown>;
  extractPrevState: (row: Record<string, unknown> | null) => unknown | null;
};

// ── Substrate loader (D-12, D-13, D-14) ─────────────────────────────────────

/**
 * Load the rolling-60d substrate ONCE per fire. The 4 generators all receive
 * the SAME substrate object (D-14) — per-dimension filtering happens inside
 * the prompt builder via `dimensionSpecificDirective` (OQ-1 simplification;
 * per-dimension substrate views are a v2.5.1 candidate).
 *
 * Pensieve filter: tag IN (FACT, RELATIONSHIP, INTENTION, EXPERIENCE) AND
 *                  deleted_at IS NULL AND created_at >= now-60d
 *                  ORDER BY created_at ASC.
 *                  Pattern from src/pensieve/retrieve.ts:208-214 (the
 *                  inArray-on-epistemicTag idiom) — OQ-1 Resolution lines
 *                  609-619 in 34-RESEARCH.md instructs us to inline this
 *                  query rather than add a helper to pensieve/retrieve.ts.
 *
 * Episodic filter: getEpisodicSummariesRange(windowStart, now) — M008 helper,
 *                  same pattern as src/rituals/weekly-review-sources.ts:222.
 *
 * Decisions filter: status='resolved' AND resolved_at IN [windowStart, now].
 *                   Same shape as weekly-review-sources.ts:223-232.
 *
 * @param now reference instant — defaults to `new Date()`; tests pass a
 *            pinned value to assert the 60-day window boundary deterministically
 */
export async function loadProfileSubstrate(now: Date = new Date()): Promise<ProfileSubstrate> {
  const windowStart = new Date(now.getTime() - SUBSTRATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [pensieveRows, episodicRows, decisionRows] = await Promise.all([
    db
      .select()
      .from(pensieveEntries)
      .where(
        and(
          isNull(pensieveEntries.deletedAt),
          // PROFILE_SUBSTRATE_TAGS is a readonly const-tuple of enum
          // literals; Drizzle's `inArray` 2nd overload requires a mutable
          // array of the column's exact literal union. Spreading to a fresh
          // `[...]` mutable copy + casting to the column's literal-union
          // type satisfies both at zero runtime cost. Pattern mirrors
          // src/pensieve/retrieve.ts:212.
          inArray(
            pensieveEntries.epistemicTag,
            [...PROFILE_SUBSTRATE_TAGS] as unknown as (typeof pensieveEntries.epistemicTag.enumValues)[number][],
          ),
          gte(pensieveEntries.createdAt, windowStart),
          lte(pensieveEntries.createdAt, now),
        ),
      )
      .orderBy(asc(pensieveEntries.createdAt)),
    getEpisodicSummariesRange(windowStart, now),
    db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.status, 'resolved'),
          gte(decisions.resolvedAt, windowStart),
          lte(decisions.resolvedAt, now),
        ),
      )
      .orderBy(asc(decisions.resolvedAt)),
  ]);

  return {
    pensieveEntries: pensieveRows,
    episodicSummaries: episodicRows,
    decisions: decisionRows,
    // D-20: threshold gates on Pensieve count, not aggregate. Episodic
    // summaries are derived (not new facts) so they don't count toward the
    // M010 substrate volume.
    entryCount: pensieveRows.length,
  };
}

// ── Substrate hash (D-15, D-16) ─────────────────────────────────────────────

/**
 * Deterministic canonical JSON for the substrate hash input. Sort the three
 * ID/date arrays alphabetically, declare object keys in alphabetical order,
 * stringify. Hand-rolled per 34-RESEARCH.md §Standard Stack — we do NOT add
 * fast-json-stable-stringify since this is the only deterministic-JSON site
 * in the codebase.
 */
function canonicalSubstrateJson(input: {
  pensieveIds: string[];
  episodicDates: string[];
  decisionIds: string[];
  schemaVersion: number;
}): string {
  const ordered = {
    decisionIds: [...input.decisionIds].sort(),
    episodicDates: [...input.episodicDates].sort(),
    pensieveIds: [...input.pensieveIds].sort(),
    schemaVersion: input.schemaVersion,
  };
  return JSON.stringify(ordered);
}

/**
 * Compute the substrate hash. Pure function (no I/O); deterministic across
 * processes given the same input.
 *
 * D-15 explicit choice: hash is over IDs/dates, NOT content. Rationale:
 * ID-stability is more reliable than content-canonicalization for deterministic
 * skipping. RESEARCH.md residual risk lines 931-935: text mutation on an
 * existing Pensieve entry leaves the ID set unchanged → hash matches → skip
 * path. The Cycle 3 two-cycle test MUST INSERT a new entry (changing the
 * ID set), NOT mutate existing entry text — the test exists to catch the
 * silently-wrong-semantics class.
 *
 * D-16: schemaVersion participates → bumping invalidates all prior hashes →
 * forces regen on next fire (cache-bust on migration).
 *
 * D-18: Phase 33 seed-row substrate_hash='' never matches a real SHA-256 hex
 * → first fire ever for each profile always calls Sonnet.
 */
export function computeSubstrateHash(
  substrate: ProfileSubstrate,
  prevStateMeta: PrevStateMeta,
): string {
  const json = canonicalSubstrateJson({
    pensieveIds: substrate.pensieveEntries.map((e) => e.id),
    // summary_date is a 'YYYY-MM-DD' string (date column); already a stable
    // canonical form for sorting.
    episodicDates: substrate.episodicSummaries.map((s) => s.summaryDate),
    decisionIds: substrate.decisions.map((d) => d.id),
    schemaVersion: prevStateMeta.schema_version,
  });
  return createHash('sha256').update(json).digest('hex');
}

// ── Substrate sanitization (Phase 43 Plan 01 — INJ-01 / D-01..D-04) ─────────

/**
 * Defense-in-depth escape for user-controlled substrate strings before they
 * are interpolated into a Sonnet system prompt. Closes the Phase 34 BL-01
 * (operational) and Phase 38 WR-01 (psychological, fenced-directive) injection
 * classes documented in
 * `.planning/milestones/v2.5-phases/34-inference-engine/34-REVIEW.md` and
 * `.planning/milestones/v2.6-phases/38-psychological-inference-engine/38-REVIEW.md`.
 *
 * Two transforms applied in order (D-01 + D-02):
 *   1. `(^|\n)(#+\s)` → `$1\$2` — every line-start markdown header sequence is
 *      prefixed with a literal backslash. The hash remains visible in the
 *      audit trail (`\## CURRENT PROFILE STATE`) but no longer parses as a
 *      section anchor that Sonnet would treat as authoritative framing.
 *   2. ` ``` ` → `'''` — triple-backtick fences are rewritten so a Pensieve
 *      entry cannot delimit a synthetic fenced-code block containing forged
 *      directives.
 *
 * Contract (locked by 43-01-PLAN.md Task 2 contract tests):
 *   - Total: every string input returns a string. Never throws.
 *   - Idempotent: `f(f(x)) === f(x)`. The first pass produces `\##` (backslash
 *     before hash) which does NOT match the source pattern again (the regex
 *     requires the hash to be at line-start or immediately after a newline;
 *     `\##` has a backslash before the hash so the second pass is a no-op).
 *
 * Boundary rule (D-04 + D047): the psychological prompt assembler
 * `src/memory/psychological-profile-prompt.ts` MUST NOT import this helper.
 * D047 (Phase 38 WR-05) forbids cross-vocabulary imports between the
 * operational and psychological boundaries; psychological-profile-prompt.ts
 * re-implements the same regex pair locally. Three lines of regex is below
 * the cost of a shared abstraction.
 */
export function sanitizeSubstrateText(text: string): string {
  return text
    .replace(/(^|\n)(#+\s)/g, '$1\\$2')
    .replace(/```/g, "'''");
}

// ── Generic per-dimension generator helper (D-08 / Claude's Discretion) ─────

/**
 * Strip the table-metadata columns from a SELECT row so what remains is the
 * jsonb-field set (matches the v3 schema shape with `data_consistency` at
 * top level). Mirrors `stripMetadataColumns` in src/memory/profiles.ts —
 * duplicated here because that helper is module-private to profiles.ts.
 */
function stripMetadataColumns(row: Record<string, unknown>): Record<string, unknown> {
  const {
    id, name, schemaVersion, substrateHash,
    confidence: _confidence, dataConsistency: _dataConsistency,
    lastUpdated, createdAt,
    ...rest
  } = row;
  void id; void name; void schemaVersion; void substrateHash;
  void _confidence; void _dataConsistency; void lastUpdated; void createdAt;

  // Drizzle returns camelCase keys; Zod schemas expect snake_case. Convert.
  const snakeRest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    const snake = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    snakeRest[snake] = v;
  }
  return snakeRest;
}

/**
 * Generic per-dimension generator. Each of the 4 dimension files
 * (jurisdictional/capital/health/family) collapses to a ~15-line dispatcher
 * that builds its config object and calls this function.
 *
 * Flow (D-08 + D-19 + D-15 + D-29 + D-32):
 *   1. Threshold check FIRST (D-19) — cheaper than hash compute
 *   2. Read current row (for prevState + hash compare + history snapshot)
 *   3. Compute substrate hash (D-15)
 *   4. Hash-skip short-circuit (D-15, D-18 — seed row '' never matches)
 *   5. Build CLOSURE-CAPTURED v4 schema with volume-weight ceiling refine
 *      INSIDE this function body (D-32; RESEARCH.md residual risk 938-941)
 *   6. Assemble prompt (Plan 34-01 deliverable)
 *   7. Sonnet messages.parse + zodOutputFormat(v4-with-refine)
 *   8. v3 re-validate (M008/M009 discipline)
 *   9. Compute host-side final confidence (D-06; GEN-05 consumption)
 *  10. Write-before-upsert (D-29): INSERT profile_history snapshot BEFORE upsert
 *  11. Upsert via name='primary' sentinel (Phase 33 D-04; D-29 step 3)
 *
 * NO retry loop (D-22). NO Stage-2 Haiku judge (CONTEXT.md deferred —
 * M009's weekly-review pattern is NOT replicated here). NO templated
 * fallback. NO Telegram send. Single attempt; failure logs and returns
 * 'profile_generation_failed'.
 */
export async function runProfileGenerator<TData extends { data_consistency: number }>(
  config: ProfileGeneratorConfig<TData>,
  substrate: ProfileSubstrate,
): Promise<ProfileGenerationOutcome> {
  const startMs = Date.now();
  const { dimension } = config;

  try {
    // 1. Threshold check FIRST (D-19, GEN-06)
    if (!isAboveThreshold(substrate.entryCount)) {
      logger.info(
        { dimension, entryCount: substrate.entryCount, threshold: MIN_ENTRIES_THRESHOLD },
        'chris.profile.threshold.below_minimum', // VERBATIM per GEN-06
      );
      return {
        dimension,
        outcome: 'profile_below_threshold',
        entryCount: substrate.entryCount,
        durationMs: Date.now() - startMs,
      };
    }

    // 2. Read current row (for prevState + hash comparison + history snapshot)
    const rows = await db.select().from(config.table).where(eq(config.table.name, 'primary')).limit(1);
    const currentRow = (rows[0] ?? null) as Record<string, unknown> | null;
    const prevStateMeta: PrevStateMeta = {
      substrate_hash: (currentRow?.substrateHash as string | undefined) ?? '',
      schema_version: (currentRow?.schemaVersion as number | undefined) ?? 1,
    };

    // 3. Compute substrate hash (D-15)
    const computedHash = computeSubstrateHash(substrate, prevStateMeta);

    // 4. Hash-skip short-circuit (D-15, D-18, GEN-07)
    //    Phase 33 seed row has substrate_hash='' (D-18), which never matches
    //    a real SHA-256 hex — first fire always proceeds.
    if (currentRow && currentRow.substrateHash === computedHash) {
      logger.info(
        { dimension, substrateHashPrefix: computedHash.slice(0, 12) },
        'chris.profile.profile_skipped_no_change',
      );
      return {
        dimension,
        outcome: 'profile_skipped_no_change',
        durationMs: Date.now() - startMs,
      };
    }

    // 5. CRITICAL — RESEARCH.md residual risk lines 938-941:
    //    closure-captures entryCount — MUST be constructed INSIDE the
    //    generator function body, NOT at module scope. A module-level
    //    refined-schema constant would silently capture an undefined or
    //    stale entryCount and fire incorrectly.
    const entryCount = substrate.entryCount;
    const v4WithRefine = config.v4Schema.refine(
      (out: { data_consistency: number }) => !(out.data_consistency > 0.5 && entryCount < 20),
      { message: 'M010-01 volume-weight ceiling: data_consistency > 0.5 requires entryCount >= 20' },
    );

    // 6. Build prompt (Plan 34-01 deliverable; HARD CO-LOC #M10-2)
    //    Adapter: narrow the full ProfileSubstrate to the structural
    //    ProfileSubstrateView. Runtime invariants make all narrowings safe:
    //      - pensieveEntries.epistemicTag: loader filters by inArray() so
    //        no null tags can appear at runtime
    //      - pensieveEntries.createdAt: defaultNow() in schema (non-null at
    //        runtime; type is Date|null due to Drizzle default-inference)
    //      - decisions.resolvedAt + resolution: status='resolved' filter
    //        guarantees these are populated
    //    Per 34-01-SUMMARY "Decisions Made" — Plan 34-02 owns this adapter;
    //    widening the structural view would touch the GREEN Plan 34-01
    //    tests and complicate the prompt builder's null-handling.
    const view: ProfileSubstrateView = {
      pensieveEntries: substrate.pensieveEntries.map((e) => ({
        id: e.id,
        epistemicTag: e.epistemicTag ?? 'FACT', // never null at runtime; defensive default
        content: e.content,
        createdAt: e.createdAt ?? new Date(0),
      })),
      episodicSummaries: substrate.episodicSummaries.map((s) => ({
        summaryDate: s.summaryDate,
        summary: s.summary,
      })),
      decisions: substrate.decisions.map((d) => ({
        id: d.id,
        // status='resolved' filter ensures resolvedAt/resolution are non-null
        resolvedAt: d.resolvedAt ?? new Date(0),
        question: d.decisionText, // DB column name → prompt builder's expected field
        resolution: d.resolution ?? '',
      })),
      entryCount: substrate.entryCount,
    };
    const prevState = config.extractPrevState(currentRow);
    const prompt = assembleProfilePrompt(dimension, view, prevState, entryCount);

    // 7. Sonnet SDK call (Pattern 2 from 34-RESEARCH.md; mirror weekly-review.ts:372-395)
    const response = await anthropic.messages.parse({
      model: SONNET_MODEL, // D-10: never hardcoded
      max_tokens: 2000,
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
        format: zodOutputFormat(v4WithRefine as unknown as any),
      },
    });
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(`${dimension}.profile.sonnet: parsed_output is null`);
    }

    // 8. v3 re-validate (D-31; M008/M009 discipline — v4 emits at SDK boundary,
    //    v3 is the contract source-of-truth)
    const sonnetOut = config.v3Schema.parse(response.parsed_output);

    // 9. Compute host-side final confidence (D-06 hybrid model; GEN-05)
    const confidence = computeProfileConfidence(entryCount, sonnetOut.data_consistency);

    // 10. Write-before-upsert (D-29): INSERT profile_history snapshot BEFORE
    //     the upsert. Only on success path (D-30 — no history row on
    //     threshold-skip or hash-skip path).
    if (currentRow && currentRow.id) {
      await db.insert(profileHistory).values({
        profileTableName: config.profileTableName,
        profileId: currentRow.id as string,
        snapshot: currentRow as Record<string, unknown>, // full jsonb (D-30)
      });
    }

    // 11. Upsert via name='primary' sentinel (Phase 33 D-04 precedent;
    //     onConflictDoUpdate on table.name unique index).
    //
    //     IMPORTANT: jsonb-column NOT NULL handling. The Phase 33 profile
    //     tables declare every jsonb column as `.notNull()` with a default
    //     of `'null'::jsonb` or `'[]'::jsonb` (a JSON null/array value, NOT
    //     SQL NULL). When Drizzle serializes a JS `null` for a jsonb
    //     column, it sends SQL `NULL` which violates the NOT NULL
    //     constraint. We must wrap JS `null` (and `undefined`) as the SQL
    //     expression `'null'::jsonb` so Postgres receives jsonb null, not
    //     SQL NULL. JSON-encode + cast the value explicitly via `sql\`...\``.
    const flat = config.flattenSonnetOutput(sonnetOut);
    const flatEncoded: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(flat)) {
      // JSON.stringify(null) === 'null', JSON.stringify(undefined) === undefined
      // (use null as the fallback for undefined). Strings get quoted; objects/
      // arrays get fully serialized. All cast to jsonb at the SQL level.
      const serialized = v === undefined ? 'null' : JSON.stringify(v);
      flatEncoded[k] = sql`${serialized}::jsonb`;
    }
    const upsertValues: Record<string, unknown> = {
      name: 'primary',
      schemaVersion: prevStateMeta.schema_version,
      substrateHash: computedHash,
      confidence,
      dataConsistency: sonnetOut.data_consistency,
      ...flatEncoded,
      lastUpdated: new Date(),
    };
    await db
      .insert(config.table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values(upsertValues as any)
      .onConflictDoUpdate({
        target: config.table.name,
        set: upsertValues,
      });

    logger.info(
      { dimension, entryCount, confidence, durationMs: Date.now() - startMs },
      'chris.profile.profile_updated',
    );
    return {
      dimension,
      outcome: 'profile_updated',
      entryCount,
      confidence,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { dimension, err: errMsg, durationMs: Date.now() - startMs },
      'chris.profile.profile_generation_failed',
    );
    return {
      dimension,
      outcome: 'profile_generation_failed',
      error: errMsg,
      durationMs: Date.now() - startMs,
    };
  }
}

// ── Re-export the stripMetadataColumns helper for per-dimension extractPrevState ─

/**
 * Re-exported so per-dimension `extractPrevState` helpers can normalize the
 * camelCase DB row to snake_case before returning. Each dimension file
 * decides whether to return null (treat seed as empty) or the snake-cased
 * jsonb subset.
 */
export { stripMetadataColumns };
