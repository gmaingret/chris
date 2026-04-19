/**
 * src/episodic/consolidate.ts — Phase 21 Plan 04 Task 2
 *
 * `runConsolidate(date)` — the daily episodic consolidation orchestrator.
 *
 * Wires together:
 *   - Plan 21-01's CONSTITUTIONAL_PREAMBLE export + @anthropic-ai/sdk@0.90 helpers
 *   - Plan 21-02's pure-function `assembleConsolidationPrompt`
 *   - Plan 21-03's day-bounded read helpers (`getPensieveEntriesForDay`,
 *     `getContradictionsForDay`, `getDecisionsForDay`)
 *   - Phase 20's three-layer Zod chain (Sonnet output → Insert → DB-read) and
 *     the `episodic_summaries` table.
 *
 * Requirements satisfied by this module:
 *   - CONS-01: end-to-end orchestration wiring
 *   - CONS-02: entry-count gate (zero entries → no Sonnet call, no insert)
 *   - CONS-03: idempotency (pre-flight SELECT + ON CONFLICT DO NOTHING)
 *   - CONS-06: decision-day importance floor (runtime clamp at >= 6)
 *   - CONS-07: contradiction-day importance floor (runtime clamp at >= 7)
 *   - CONS-12: failure notification via Telegram (notifyConsolidationError)
 *
 * Out of scope (deferred to later plans):
 *   - Cron registration (Phase 22 CRON-01)
 *   - Retrieval routing (Phase 22 RETR-01..06)
 *   - /summary command (Phase 23 CMD-01)
 *   - Backfill script (Phase 23 OPS-01)
 *
 * Tests: src/episodic/__tests__/consolidate.test.ts (Task 3 of this plan).
 */
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as zV4 from 'zod/v4';
import { anthropic, SONNET_MODEL } from '../llm/client.js';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { episodicSummaries } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { assembleConsolidationPrompt } from './prompts.js';
import {
  getPensieveEntriesForDay,
  getContradictionsForDay,
  getDecisionsForDay,
} from './sources.js';
import {
  EpisodicSummarySonnetOutputSchema,
  type EpisodicSummarySonnetOutput,
  parseEpisodicSummary,
} from './types.js';
import { notifyConsolidationError } from './notify.js';

/**
 * Zod v4 mirror of EpisodicSummarySonnetOutputSchema (which is built on the
 * standard `zod` v3 import in src/episodic/types.ts).
 *
 * Why both schemas:
 *   The SDK's `@anthropic-ai/sdk/helpers/zod::zodOutputFormat()` calls
 *   `z.toJSONSchema(schema, { reused: 'ref' })` from `zod/v4/core/to-json-schema`,
 *   which only operates on v4 schemas (they expose `_zod.def`; v3 schemas only
 *   have `_def`). Passing a v3 schema raises
 *   `TypeError: Cannot read properties of undefined (reading 'def')`.
 *
 *   We keep the v3 `EpisodicSummarySonnetOutputSchema` as the contract surface
 *   for Phase 20 consumers (tests, downstream Phase 22 retrieval code) and use
 *   this v4 mirror only at the SDK boundary. The Sonnet response is
 *   re-validated through the v3 `parseEpisodicSummary` in step 8 — so the v3
 *   schema remains the authoritative shape check, and the v4 schema is purely
 *   a JSON-Schema-emitting contract for the SDK.
 *
 *   Both schemas MUST stay in lock-step. If Phase 20 tightens any field on the
 *   v3 schema (e.g. lowers a max, narrows a string format), update this mirror
 *   in the same commit. The v3 re-validation in step 8 is the safety net that
 *   catches drift if a discrepancy ever slips through.
 */
const EpisodicSummarySonnetOutputSchemaV4 = zV4.object({
  summary: zV4.string().min(50),
  importance: zV4.number().int().min(1).max(10),
  topics: zV4.array(zV4.string().min(1)).min(1).max(10),
  emotional_arc: zV4.string().min(1),
  key_quotes: zV4.array(zV4.string().min(1)).max(10),
});

/**
 * Discriminated result of a single `runConsolidate` invocation.
 *
 *   - `inserted`: a new row was committed to `episodic_summaries`.
 *   - `skipped: 'existing'`: idempotency — a row for this date already exists,
 *     either pre-flight (CONS-03 part 1) or detected via ON CONFLICT (part 2).
 *   - `skipped: 'no-entries'`: CONS-02 entry-count gate — zero pensieve entries
 *     for the day, no Sonnet call made, no DB write.
 *   - `failed`: an error was caught at the top-level try/catch; Telegram
 *     notification has already been attempted (CONS-12); the original error is
 *     attached for caller-side logging or re-classification.
 */
export type ConsolidateResult =
  | { inserted: true; id: string }
  | { skipped: 'existing' | 'no-entries' }
  | { failed: true; error: unknown };

/** Sonnet response budget — episodic summaries are short (~500–800 tokens). */
const MAX_TOKENS = 2000;

/**
 * Decision lifecycle states that count as "real" structural decisions for the
 * CONS-06 importance floor. Withdrawn / stale / abandoned / open-draft are
 * excluded — they're capture-state artifacts, not committed decisions whose
 * presence on a day reflects structural weight.
 */
const REAL_DECISION_STATES = new Set(['open', 'due', 'resolved', 'reviewed']);

/**
 * Call Sonnet with structured Zod output and exactly one retry on parse failure.
 *
 * Per `<orchestration_flow>` step 6: rate-limit / network / 5xx errors propagate
 * immediately (no retry — the cron will re-attempt tomorrow, and notify Greg
 * via CONS-12 in the meantime). Only Zod-parse failures (i.e. the SDK's
 * `AnthropicError: Failed to parse structured output: …`) are retried, since
 * those are non-deterministic Sonnet output drift.
 *
 * The retry catches ANY error, not just AnthropicError, because the SDK's
 * structured-output failure surface can include both `AnthropicError` (raised
 * by `zodOutputFormat`'s internal `parse(content)` callback) and `ZodError`
 * (raised if the SDK calls `.parse()` directly elsewhere). Discriminating
 * between "structured-output drift retryable" and "rate-limit non-retryable"
 * by error class adds fragility against minor SDK version drift; the simpler
 * "one retry on any throw" rule means a transient rate-limit benefits from
 * a single retry, which is harmless on the 23:00 cron timing budget.
 */
async function callSonnetWithRetry(
  prompt: string,
): Promise<EpisodicSummarySonnetOutput> {
  const buildRequest = () => ({
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text' as const,
        text: prompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [
      {
        role: 'user' as const,
        content: 'Generate the episodic summary for this day.',
      },
    ],
    output_config: {
      // SDK requires a zod/v4 schema (see EpisodicSummarySonnetOutputSchemaV4 above).
      // The .d.ts surface of @anthropic-ai/sdk/helpers/zod still types the
      // input as the v3 `ZodType` (the .d.ts imports `from 'zod'` rather than
      // `from 'zod/v4'`); the runtime, however, calls `z.toJSONSchema()` from
      // `zod/v4/core/to-json-schema` which only accepts v4 schemas. Cast
      // through unknown to bridge the SDK's type/runtime mismatch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(EpisodicSummarySonnetOutputSchemaV4 as unknown as any),
    },
  });

  try {
    // First attempt
    const response = await anthropic.messages.parse(buildRequest());
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(
        'episodic.consolidate.sonnet: parsed_output is null on first call',
      );
    }
    return response.parsed_output;
  } catch (firstErr) {
    logger.warn(
      { err: firstErr instanceof Error ? firstErr.message : String(firstErr) },
      'episodic.consolidate.sonnet.retry',
    );
    // Second attempt — let any error propagate to runConsolidate's catch block
    const response = await anthropic.messages.parse(buildRequest());
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(
        'episodic.consolidate.sonnet: parsed_output is null on retry',
      );
    }
    return response.parsed_output;
  }
}

/**
 * Generate the episodic summary for a single calendar date in
 * `config.proactiveTimezone`.
 *
 * The 10-step orchestration mirrors the plan's `<orchestration_flow>`:
 *   1. Normalize the input date → local YYYY-MM-DD string in tz.
 *   2. Pre-flight idempotency SELECT — if a row exists, return early.
 *   3. Entry-count gate (CONS-02) — zero entries returns early, no Sonnet call.
 *   4. Fetch contradictions + decisions in parallel.
 *   5. Assemble the prompt via `assembleConsolidationPrompt`.
 *   6. Call Sonnet via `messages.parse({ output_config: { format } })`.
 *   7. Apply runtime importance floors (CONS-06 + CONS-07).
 *   8. Re-validate the full insert row via `parseEpisodicSummary`.
 *   9. Insert with ON CONFLICT DO NOTHING (CONS-03 belt-and-suspenders).
 *   10. Failure path — top-level try/catch invokes `notifyConsolidationError`
 *       and returns `{ failed: true, error }`.
 */
export async function runConsolidate(date: Date): Promise<ConsolidateResult> {
  const tz = config.proactiveTimezone;
  // Step 1 — normalize date to local YYYY-MM-DD in tz
  const localDateStr = DateTime.fromJSDate(date, { zone: tz }).toISODate();
  if (!localDateStr) {
    const err = new Error(
      `episodic.consolidate: invalid date input — ${date.toISOString()}`,
    );
    await notifyConsolidationError(date, err);
    return { failed: true, error: err };
  }

  try {
    // Step 2 — idempotency pre-flight
    const existing = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, localDateStr))
      .limit(1);
    if (existing.length > 0) {
      logger.info(
        { summaryDate: localDateStr },
        'episodic.consolidate.skip.existing',
      );
      return { skipped: 'existing' };
    }

    // Step 3 — entry-count gate (CONS-02)
    const entries = await getPensieveEntriesForDay(date, tz);
    if (entries.length === 0) {
      logger.info(
        { summaryDate: localDateStr },
        'episodic.consolidate.skip.no-entries',
      );
      return { skipped: 'no-entries' };
    }

    // Step 4 — parallel fetch of auxiliary sources
    const [contradictions, decisions] = await Promise.all([
      getContradictionsForDay(date, tz),
      getDecisionsForDay(date, tz),
    ]);

    // Step 5 — assemble the prompt
    const prompt = assembleConsolidationPrompt({
      summaryDate: localDateStr,
      tz,
      entries,
      contradictions,
      decisions,
    });

    // Step 6 — Sonnet structured call (one retry on parse failure)
    const parsed = await callSonnetWithRetry(prompt);

    // Step 7 — runtime importance floors (CONS-06 + CONS-07)
    let importance = parsed.importance;
    const hasRealDecision = decisions.some(
      (d) =>
        (d.createdToday || d.resolvedToday) &&
        REAL_DECISION_STATES.has(d.lifecycleState),
    );
    if (hasRealDecision) importance = Math.max(importance, 6);
    if (contradictions.length > 0) importance = Math.max(importance, 7);

    // Step 8 — Zod re-validate the full insert row
    // Note: summary_date is coerced to a Date at midnight UTC of the local day
    // string. The Drizzle `date` column accepts the YYYY-MM-DD string directly
    // (which we use for the actual insert below); the Zod step here is a
    // contract-level re-check that the SDK output also passes the stricter
    // EpisodicSummaryInsertSchema, not just the EpisodicSummarySonnetOutputSchema.
    const insertRow = parseEpisodicSummary({
      summary: parsed.summary,
      importance,
      topics: parsed.topics,
      emotional_arc: parsed.emotional_arc,
      key_quotes: parsed.key_quotes,
      summary_date: new Date(`${localDateStr}T00:00:00Z`),
      source_entry_ids: entries.map((e) => e.id),
    });

    // Step 9 — insert with ON CONFLICT DO NOTHING (CONS-03 belt-and-suspenders)
    const drizzleRow = {
      summaryDate: localDateStr, // YYYY-MM-DD string for the `date` column
      summary: insertRow.summary,
      importance: insertRow.importance,
      topics: insertRow.topics,
      emotionalArc: insertRow.emotional_arc,
      keyQuotes: insertRow.key_quotes,
      sourceEntryIds: insertRow.source_entry_ids,
    };
    const inserted = await db
      .insert(episodicSummaries)
      .values(drizzleRow)
      .onConflictDoNothing({ target: episodicSummaries.summaryDate })
      .returning({ id: episodicSummaries.id });
    if (inserted.length === 0) {
      // Race: another caller (concurrent backfill, manual `/resummary`, second
      // cron tick from a clock-skew anomaly) inserted between step 2 and now.
      logger.info(
        { summaryDate: localDateStr },
        'episodic.consolidate.skip.race',
      );
      return { skipped: 'existing' };
    }
    logger.info(
      {
        summaryDate: localDateStr,
        id: inserted[0]!.id,
        importance,
        entryCount: entries.length,
        contradictionCount: contradictions.length,
        decisionCount: decisions.length,
      },
      'episodic.consolidate.complete',
    );
    return { inserted: true, id: inserted[0]!.id };
  } catch (err) {
    // Step 10 — failure path (CONS-12)
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        summaryDate: localDateStr,
      },
      'episodic.consolidate.error',
    );
    await notifyConsolidationError(date, err);
    return { failed: true, error: err };
  }
}
