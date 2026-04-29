/**
 * src/rituals/weekly-review.ts — Phase 29 Plans 01 + 02
 *
 * HARD CO-LOC #2 + #3 atomic boundary owner. Phase 29 Plan 02 fills in the
 * full HARD CO-LOC #2 + #3 ATOMIC pipeline:
 *
 *   - HARD CO-LOC #2 (Pitfall 14): Stage-1 Zod refine (regex `?` count + EN/FR/RU
 *     interrogative-leading-word heuristic) + Stage-2 Haiku judge ({question_count,
 *     questions[]} structured output) co-located with generateWeeklyObservation.
 *   - HARD CO-LOC #3 (Pitfall 17): assembleWeeklyReviewPrompt (sibling
 *     weekly-review-prompt.ts) is consumed at the SDK boundary by
 *     generateWeeklyObservation; CONSTITUTIONAL_PREAMBLE flows through to the
 *     `system` argument of anthropic.messages.parse — verified by SDK-boundary
 *     unit test asserting system[0].text starts with '## Core Principles
 *     (Always Active)'.
 *
 * Plan 29-01 shipped the WEEKLY_REVIEW_HEADER constant.
 * Plan 29-02 (THIS commit cluster) ships:
 *   - Stage-1 helpers: stage1Check + INTERROGATIVE_REGEX (D-03) — Task 1
 *   - WeeklyReviewSchema (v3) + WeeklyReviewSchemaV4 (v4) dual schema — Task 1
 *   - StageTwoJudgeSchema (v3+v4) + DateGroundingSchema (v3+v4) — Task 2
 *   - runStage2HaikuJudge + runDateGroundingCheck + error classes (D-04+D-05) — Task 3
 *   - generateWeeklyObservation retry-cap-2 loop + templated fallback (D-04 / W-4) — Task 4
 *   - fireWeeklyReview orchestrator + Pensieve persist + D031 header render — Task 6
 *
 * Templated fallback ships English-only as v1 baseline; FR/RU localization is
 * deferred to v2.5 per CONTEXT.md "Claude's Discretion" + W-4 lock. The comment
 * block on TEMPLATED_FALLBACK_EN cites this decision so future-Greg knows the
 * boundary.
 *
 * Tests: src/rituals/__tests__/weekly-review.test.ts (Plan 29-02) — 7 describe
 * blocks covering Stage-1, Stage-2, Date-grounding, retry loop, fallback,
 * fireWeeklyReview integration, and CONSTITUTIONAL_PREAMBLE SDK boundary.
 */
import { z } from 'zod';
import * as zV4 from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { anthropic, HAIKU_MODEL, SONNET_MODEL } from '../llm/client.js';
import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { rituals, ritualFireEvents, ritualResponses } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { storePensieveEntry } from '../pensieve/store.js';
import {
  assembleWeeklyReviewPrompt,
  type WeeklyReviewPromptInput,
} from './weekly-review-prompt.js';
import {
  computeWeekBoundary,
  loadWeeklyReviewContext,
} from './weekly-review-sources.js';
import { RITUAL_OUTCOME, type RitualConfig, type RitualFireOutcome } from './types.js';

/**
 * D031 boundary marker — verbatim user-facing header prepended to the weekly
 * review observation message at Telegram-send time (Plan 29-02 consumes).
 *
 * Spec: REQUIREMENTS.md WEEK-04 + PROJECT.md D031 — exact text, no trailing
 * punctuation, no whitespace tweaks. Greg sees this prefix on every Sunday
 * 20:00 Paris weekly review message; it explicitly frames the prose as
 * Chris's interpretation, not authoritative narrative — protecting against
 * Pitfall 17 (sycophantic / authoritative-tone weekly observations).
 */
export const WEEKLY_REVIEW_HEADER = 'Observation (interpretation, not fact):';

// ── Stage-1 Zod refine (D-03 / WEEK-05 — Pitfall 14) ────────────────────────

/**
 * EN/FR/RU interrogative-leading-word union regex for the Stage-1 refine.
 *
 * Per CONTEXT.md D-03 — locked verbatim. Threshold ≤1 (not ==1) allows
 * yes/no questions ("Did you keep going?") which contain zero leading-word
 * matches. Multi-leading-word triggers reject. This catches the documented
 * Pitfall 14 failure modes where French/Russian period-terminated compound
 * questions slip through a `?`-count-only check (e.g., "Qu'est-ce qui t'a
 * surpris cette semaine. Et qu'est-ce qui t'a semblé familier.").
 *
 * Flags:
 *   g — count all matches (not just first)
 *   i — case-insensitive (Greg may write "What" or "what")
 *   u — Unicode-aware so Cyrillic word boundaries (\b) work correctly
 *
 * Sample tokens (deterministically grep-checkable per plan verification):
 *   - EN: what, why, how, when, where, which, who
 *   - FR: qu'est-ce que, qu'est-ce qui, comment, pourquoi, quoi, quand, où,
 *         quel, quelle, quels, quelles, qui
 *   - RU: почему, что, как, когда, где, кто, какой, какая, какое, какие, зачем
 */
const INTERROGATIVE_REGEX =
  /\b(what|why|how|when|where|which|who|qu['e]?est-ce que|qu['e]?est-ce qui|comment|pourquoi|quoi|quand|où|quel|quelle|quels|quelles|qui|почему|что|как|когда|где|кто|какой|какая|какое|какие|зачем)\b/giu;

/**
 * Stage-1 single-question gate. Pure function — no LLM, no I/O.
 *
 * Returns true when the input passes BOTH checks:
 *   1. Exactly one '?' character (catches "...one question? And another?"
 *      multi-`?` failure mode)
 *   2. At most one interrogative-leading-word match across the EN/FR/RU
 *      union regex (catches FR/RU period-terminated compound questions)
 *
 * False positive (false reject) note: an embedded quoted question with two
 * `?` characters ("you keep asking yourself what mattered? — what mattered
 * this week?") will fail Stage-1. This is acceptable — the Sonnet system
 * prompt instructs it not to embed quoted questions; the retry loop +
 * templated fallback handle the rare legitimate edge case.
 *
 * IMPORTANT: this function is exported for test access AND used inline in
 * the WeeklyReviewSchema `.refine()` call. Both paths exercise the same gate.
 */
export function stage1Check(question: string): boolean {
  const questionMarks = (question.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) return false;
  const interrogativeMatches = (question.match(INTERROGATIVE_REGEX) ?? []).length;
  return interrogativeMatches <= 1;
}

/**
 * v3 contract surface — used in the runtime retry loop AND in tests.
 *
 * The `.refine()` on `question` runs Stage-1 at parse time. A multi-question
 * input throws ZodError with the documented '/Stage-1 violation/' message,
 * which the retry loop catches and counts against the cap-2 budget.
 *
 * v3/v4 dual pattern mirrors src/episodic/consolidate.ts:33-81 — v3 is the
 * authoritative shape check; v4 is the SDK boundary mirror (no refine —
 * SDK doesn't surface refine errors as actionable retry signals).
 */
export const WeeklyReviewSchema = z.object({
  observation: z.string().min(20).max(800),
  question: z
    .string()
    .min(5)
    .max(300)
    .refine(stage1Check, {
      message:
        'Stage-1 violation: must contain exactly one ? AND ≤1 interrogative-leading-word per EN/FR/RU',
    }),
});

/**
 * v4 SDK-boundary mirror. NO refine — re-validated via v3 in the retry loop.
 *
 * Why both schemas:
 *   The SDK's `@anthropic-ai/sdk/helpers/zod::zodOutputFormat()` calls
 *   `z.toJSONSchema(schema, { reused: 'ref' })` from
 *   `zod/v4/core/to-json-schema`, which only operates on v4 schemas (they
 *   expose `_zod.def`; v3 schemas only have `_def`). Passing a v3 schema
 *   raises `TypeError: Cannot read properties of undefined (reading 'def')`.
 *
 *   Both schemas MUST stay in lock-step. If a future commit tightens any
 *   field on the v3 schema, update this mirror in the same commit. The v3
 *   re-validation in the retry loop is the safety net catching drift.
 */
export const WeeklyReviewSchemaV4 = zV4.object({
  observation: zV4.string().min(20).max(800),
  question: zV4.string().min(5).max(300),
});

export type WeeklyReviewOutput = z.infer<typeof WeeklyReviewSchema>;

// ── Stage-2 Haiku judge schemas (D-04 / WEEK-05) ────────────────────────────

/**
 * v3 contract surface for the Stage-2 Haiku judge structured output.
 *
 * Bounded explicitly (DoS protection per threat T-29-02-03): question_count
 * is a non-negative int ≤10; questions array is ≤10 entries. Haiku's output
 * cannot expand the retry loop's LLM-call budget through unbounded fields.
 *
 * The judge's prompt instructs Haiku to count distinct questions in the
 * `question` field of Sonnet's output. question_count > 1 → MultiQuestionError
 * → retry (counts toward MAX_RETRIES=2 cap).
 */
const StageTwoJudgeSchema = z.object({
  question_count: z.number().int().min(0).max(10),
  questions: z.array(z.string()).max(10),
});

/** v4 SDK-boundary mirror — no refine, lock-step with v3. */
const StageTwoJudgeSchemaV4 = zV4.object({
  question_count: zV4.number().int().min(0).max(10),
  questions: zV4.array(zV4.string()).max(10),
});

// ── Date-grounding post-check schemas (D-05 / Pitfall 16) ───────────────────

/**
 * v3 contract surface for the date-grounding Haiku post-check output.
 *
 * Bounded explicitly: dates_referenced array is ≤20 entries. The judge is
 * asked to enumerate dates in Sonnet's observation and report whether ANY
 * fall outside the [weekStart, weekEnd] window. references_outside_window
 * === true → DateOutOfWindowError → retry (shared cap-2 budget).
 *
 * Why a Haiku post-check rather than regex: date references aren't always
 * ISO-formatted ("Wednesday" / "two weeks ago" / "the day before yesterday")
 * so a regex misses semantic mentions. Haiku catches them. Mirrors M008's
 * Pitfall 16 mitigation pattern.
 */
const DateGroundingSchema = z.object({
  references_outside_window: z.boolean(),
  dates_referenced: z.array(z.string()).max(20),
});

/** v4 SDK-boundary mirror. */
const DateGroundingSchemaV4 = zV4.object({
  references_outside_window: zV4.boolean(),
  dates_referenced: zV4.array(zV4.string()).max(20),
});

// ── Discriminated retry-loop error classes (D-04 + D-05) ────────────────────

/**
 * Stage-2 violation: Haiku judge counted >1 distinct questions in Sonnet's
 * question field. Carries the judge's full result so the retry loop can log
 * it for telemetry without re-calling the judge.
 */
export class MultiQuestionError extends Error {
  constructor(
    public readonly stage2Result: { question_count: number; questions: string[] },
  ) {
    super(`Stage-2 violation: question_count = ${stage2Result.question_count}`);
    this.name = 'MultiQuestionError';
  }
}

/**
 * Date-grounding violation: Haiku post-check detected ≥1 date references in
 * Sonnet's observation falling outside the 7-day window. Carries the
 * specific dates so the retry loop can log them for telemetry.
 */
export class DateOutOfWindowError extends Error {
  constructor(public readonly datesReferenced: string[]) {
    super(
      `Date-grounding violation: out-of-window dates = ${JSON.stringify(datesReferenced)}`,
    );
    this.name = 'DateOutOfWindowError';
  }
}

// ── Haiku judge calls (D-04 Stage-2 + D-05 date-grounding) ──────────────────

/**
 * Stage-2 Haiku question-counting judge. Invoked only after Stage-1 passes.
 *
 * Cost: ~$0.0003 per call (HAIKU model, ~150 max tokens, structured output).
 * The judge prompt is locked verbatim per CONTEXT.md D-04 to keep the
 * judge's behavior reproducible across model snapshots.
 *
 * Returns the parsed { count, questions } shape; the caller (retry loop)
 * discriminates on `count > 1` to throw MultiQuestionError. The judge does
 * NOT throw on count > 1 itself — the caller owns the dispatch decision.
 *
 * On parsed_output null (SDK contract for refusal/empty response): throws
 * a generic Error which the retry loop catches and counts toward the cap.
 */
// Exported for unit tests in src/rituals/__tests__/weekly-review.test.ts.
// External consumers (Plan 29-03 dispatcher) should call generateWeeklyObservation
// or fireWeeklyReview, NOT this helper directly.
export async function runStage2HaikuJudge(
  question: string,
): Promise<{ count: number; questions: string[] }> {
  const judgePrompt =
    "You are a question counter. Given the text below, count how many distinct questions are being asked of the reader. A compound question joined by 'and' or 'or' counts as multiple questions. An embedded question (quoted from someone else's mouth) counts as 1, but the question being directly asked at the end counts separately. Output JSON: { question_count: number, questions: string[] }.";
  const response = await anthropic.messages.parse({
    model: HAIKU_MODEL,
    max_tokens: 150,
    system: [{ type: 'text' as const, text: judgePrompt }],
    messages: [{ role: 'user' as const, content: question }],
    output_config: {
      // SDK runtime requires zod/v4 schema; .d.ts surface still types as v3.
      // Same cast pattern as src/episodic/consolidate.ts:156.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(StageTwoJudgeSchemaV4 as unknown as any),
    },
  });
  if (response.parsed_output === null || response.parsed_output === undefined) {
    throw new Error('Stage-2 Haiku judge: parsed_output is null');
  }
  const parsed = StageTwoJudgeSchema.parse(response.parsed_output);
  return { count: parsed.question_count, questions: parsed.questions };
}

/**
 * Date-grounding Haiku post-check. Invoked only after Stage-2 passes.
 *
 * Verifies Sonnet's observation does not reference dates outside the 7-day
 * window. Mirrors Pitfall 16 mitigation pattern. Cost: ~$0.0003 per call.
 *
 * The judge prompt is locked verbatim per CONTEXT.md D-05. Returns
 * { inWindow: boolean, datesReferenced: string[] }; the caller throws
 * DateOutOfWindowError if !inWindow.
 *
 * weekStart and weekEnd are ISO 'YYYY-MM-DD' strings (already rendered in
 * the proactive timezone by fireWeeklyReview). Passing UTC instants would
 * confuse the judge — the user-facing dates are calendar dates.
 */
// Exported for unit tests; same access boundary as runStage2HaikuJudge.
export async function runDateGroundingCheck(
  observation: string,
  weekStart: string,
  weekEnd: string,
): Promise<{ inWindow: boolean; datesReferenced: string[] }> {
  const judgePrompt = `You are a date-window auditor. Below is an observation about Greg's past week. The allowed date window is ${weekStart} to ${weekEnd} (inclusive). Identify any dates referenced in the observation, and report whether ANY of them fall outside the window. Output JSON: { references_outside_window: boolean, dates_referenced: string[] }.`;
  const response = await anthropic.messages.parse({
    model: HAIKU_MODEL,
    max_tokens: 200,
    system: [{ type: 'text' as const, text: judgePrompt }],
    messages: [{ role: 'user' as const, content: observation }],
    output_config: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(DateGroundingSchemaV4 as unknown as any),
    },
  });
  if (response.parsed_output === null || response.parsed_output === undefined) {
    throw new Error('Date-grounding: parsed_output is null');
  }
  const parsed = DateGroundingSchema.parse(response.parsed_output);
  return {
    inWindow: !parsed.references_outside_window,
    datesReferenced: parsed.dates_referenced,
  };
}

// ── Retry-cap-2 generator + templated fallback (D-04 / WEEK-06) ─────────────

/**
 * Maximum number of retries before falling back to the templated EN-only
 * single-question observation. (initial + MAX_RETRIES = 3 max LLM-call
 * cycles per weekly review).
 *
 * Pitfall 15 mitigation: hardcoded constant — beyond this, the runtime check
 * is fighting a structural prompt failure. Log + fall back, never block the
 * weekly cadence.
 */
export const MAX_RETRIES = 2;

/**
 * Templated single-question fallback. Ships ENGLISH-ONLY as the v1 baseline
 * per CONTEXT.md "Claude's Discretion" + W-4 lock. FR/RU localization is
 * explicitly DEFERRED to v2.5.
 *
 * This is a deliberate scope cut to ship Phase 29 within the LLM quality
 * budget. When Greg's `franc` last-message-language detection is wired in
 * future work, v2.5 will branch this fallback by language. Until then, the
 * fallback ships single-language; this comment block IS the boundary marker
 * so future-Greg knows where the deferral lies.
 *
 * Hardcoded text per Pitfall 14 explicit example. Logged via
 * 'chris.weekly-review.fallback-fired' (NOT silent — visibility into how
 * often Sonnet is failing the runtime gates).
 */
const TEMPLATED_FALLBACK_EN = {
  observation: 'Reflecting on this week.',
  question: 'What stood out to you about this week?',
} as const;

/**
 * Build the Sonnet structured-output request. Pure-function for ease of test
 * mocking; the retry loop calls this each attempt with the same prompt.
 *
 * IMPORTANT: the `system` argument receives the assembled prompt verbatim
 * — this is the SDK boundary where CONSTITUTIONAL_PREAMBLE flows through
 * to the model (HARD CO-LOC #3 verification point). The test file asserts
 * `mockAnthropicParse.mock.calls[0][0].system[0].text` starts with
 * '## Core Principles (Always Active)'.
 */
function buildSonnetRequest(prompt: string): Parameters<typeof anthropic.messages.parse>[0] {
  return {
    model: SONNET_MODEL,
    max_tokens: 800,
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
        content: 'Generate the weekly review observation for this week.',
      },
    ],
    output_config: {
      // SDK runtime requires zod/v4; same cast as src/episodic/consolidate.ts:156.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(WeeklyReviewSchemaV4 as unknown as any),
    },
  };
}

/**
 * generateWeeklyObservation — the HARD CO-LOC #2 + #3 ATOMIC pipeline.
 *
 * Sequence per attempt (mirrors 29-RESEARCH §7.2 cost-ordering rationale —
 * cheap Stage-1 regex before Stage-2 Haiku call before date-grounding Haiku):
 *
 *   1. Sonnet call via anthropic.messages.parse + zodOutputFormat (v4 schema)
 *      — CONSTITUTIONAL_PREAMBLE flows through `system` argument (HARD CO-LOC #3)
 *   2. v3 schema re-validation runs Stage-1 .refine() — throws ZodError on
 *      multi-question (HARD CO-LOC #2 Stage-1 enforcement)
 *   3. Stage-2 Haiku judge — throws MultiQuestionError on count > 1 (HARD
 *      CO-LOC #2 Stage-2 enforcement)
 *   4. Date-grounding Haiku post-check — throws DateOutOfWindowError on
 *      out-of-window references (Pitfall 16 mitigation)
 *
 * Any thrown error is caught + counts toward MAX_RETRIES=2 budget. After
 * cap, returns the EN-only templated fallback + emits the
 * 'chris.weekly-review.fallback-fired' log event (WEEK-06).
 *
 * Returns { observation, question, isFallback }. Caller (fireWeeklyReview)
 * logs isFallback=true to ritual_responses.metadata so longitudinal analysis
 * can quantify how often the runtime gates kick in.
 */
export async function generateWeeklyObservation(
  input: WeeklyReviewPromptInput,
): Promise<{ observation: string; question: string; isFallback: boolean }> {
  const prompt = assembleWeeklyReviewPrompt(input);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 1. Sonnet call — system argument carries the assembled prompt
      const response = await anthropic.messages.parse(buildSonnetRequest(prompt));
      if (response.parsed_output === null || response.parsed_output === undefined) {
        throw new Error('Sonnet: parsed_output is null');
      }

      // 2. v3 re-validation runs Stage-1 .refine() — throws ZodError on multi-question
      const sonnetOut = WeeklyReviewSchema.parse(response.parsed_output);

      // 3. Stage-2 Haiku judge
      const stage2 = await runStage2HaikuJudge(sonnetOut.question);
      if (stage2.count > 1) {
        throw new MultiQuestionError({
          question_count: stage2.count,
          questions: stage2.questions,
        });
      }

      // 4. Date-grounding post-check (D-05)
      const dateCheck = await runDateGroundingCheck(
        sonnetOut.observation,
        input.weekStart,
        input.weekEnd,
      );
      if (!dateCheck.inWindow) throw new DateOutOfWindowError(dateCheck.datesReferenced);

      // PASS — all four gates cleared
      logger.info(
        { attempt, observationLen: sonnetOut.observation.length },
        'rituals.weekly.regen.success',
      );
      return {
        observation: sonnetOut.observation,
        question: sonnetOut.question,
        isFallback: false,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg, attempt }, 'rituals.weekly.regen.retry');
      if (attempt === MAX_RETRIES) {
        // Cap reached — emit fallback log + return EN-only templated text
        logger.warn(
          { err: errMsg, attempts: MAX_RETRIES + 1 },
          'chris.weekly-review.fallback-fired',
        );
        return { ...TEMPLATED_FALLBACK_EN, isFallback: true };
      }
      // continue loop for next attempt
    }
  }

  // Unreachable: the for-loop's last iteration always returns (success or fallback).
  // Defensive throw — TypeScript control-flow analysis can't prove the always-return.
  throw new Error('generateWeeklyObservation: unreachable code path');
}

// ── fireWeeklyReview orchestrator (WEEK-01 fire-side + WEEK-04 + WEEK-08) ───

/**
 * fireWeeklyReview — dispatched from src/rituals/scheduler.ts at the Sunday
 * 20:00 Paris cron tick when ritual.name === 'weekly_review' (Plan 29-03
 * wires the dispatcher case).
 *
 * Pipeline:
 *   1. Compute the 7-day window via computeWeekBoundary (Plan 29-01).
 *   2. Load substrate (M008 episodic summaries + M007 resolved decisions +
 *      wellbeing snapshots) via loadWeeklyReviewContext (Plan 29-01).
 *   3. Sparse-data short-circuit: zero summaries AND zero resolved decisions
 *      → log + return 'fired' (no-op fire — mirrors CONS-02). Wellbeing
 *      alone is insufficient signal for a weekly observation.
 *   4. Generate observation via generateWeeklyObservation (retry-cap-2 +
 *      fallback). Returns { observation, question, isFallback }.
 *   5. Render user-facing message: WEEKLY_REVIEW_HEADER + \n\n + observation
 *      + \n\n + question (D031 + WEEK-04 boundary marker rendering).
 *   6. INSERT ritual_responses row BEFORE Telegram send (M007 D-28 write-
 *      before-send pattern). On Telegram failure, the row records the fire
 *      attempt for telemetry; respondedAt is set at the end on success.
 *   7. Persist observation to Pensieve as RITUAL_RESPONSE (D-07 explicit tag
 *      override; bypasses Haiku auto-tagger; metadata.kind='weekly_review').
 *   8. Update ritual_responses.pensieve_entry_id back-reference + responded_at.
 *   9. Send the user-facing message via Telegram.
 *
 * Conforms to Phase 26 D-26-08 dispatcher contract: takes (ritual, cfg) and
 * returns RitualFireOutcome ('fired' on every successful path, including
 * fallback and sparse-data short-circuit).
 *
 * The cfg parameter is currently unused (the weekly review has no per-fire
 * config knobs beyond the cron's fire_dow/fire_at, which are read from
 * ritual.config by the scheduler before dispatch). It is accepted to match
 * the dispatcher signature uniformly with fireVoiceNote + fireWellbeing.
 *
 * Phase 28 ritual_fire_events instrumentation note:
 * Weekly review has NO user-reply window. ritual_fire_events from this handler
 * emits ONLY outcome:'fired'. The 'fired_no_response' (skip-counting) outcome
 * for weekly review is emitted by ritualResponseWindowSweep on virtual response
 * window expiry — but per Plan 28-02 / RESEARCH OQ#5: weekly review skip-
 * tracking treats 2 consecutive 'fired' events without intermediate 'responded'
 * as the skip-threshold trigger. Implementation lives in Plan 28-02
 * computeSkipCount.
 */
export async function fireWeeklyReview(
  ritual: typeof rituals.$inferSelect,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  cfg: RitualConfig,
): Promise<RitualFireOutcome> {
  const startMs = Date.now();
  const now = new Date();
  const { weekStart, weekEnd } = computeWeekBoundary(now);
  const weekStartIso = DateTime.fromJSDate(weekStart, {
    zone: config.proactiveTimezone,
  }).toISODate()!;
  const weekEndIso = DateTime.fromJSDate(weekEnd, {
    zone: config.proactiveTimezone,
  }).toISODate()!;

  logger.info(
    { ritualId: ritual.id, weekStart: weekStartIso, weekEnd: weekEndIso },
    'rituals.weekly.fire.start',
  );

  // 2. Load substrate — parallel-fetch summaries + resolvedDecisions + wellbeing
  const ctx = await loadWeeklyReviewContext(weekStart, weekEnd);

  // 3. Sparse-data short-circuit (mirror CONS-02). Zero substrate → no-op fire.
  if (ctx.summaries.length === 0 && ctx.resolvedDecisions.length === 0) {
    logger.info(
      { ritualId: ritual.id },
      'rituals.weekly.skipped.no_data',
    );
    // Phase 28 SKIP-01: emit ritual_fire_events even on sparse-data path.
    // Per PATTERNS.md: sparse-data short-circuit is still outcome='fired'
    // (no LLM call, no Telegram send; Greg saw no message). Does NOT count
    // as fired_no_response because Greg was not asked anything.
    await db.insert(ritualFireEvents).values({
      ritualId: ritual.id,
      firedAt: now,
      outcome: RITUAL_OUTCOME.FIRED,
      metadata: {
        reason: 'no_data_short_circuit',
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
      },
    });
    return 'fired'; // no telegram send; the cron next_run_at advances normally
  }

  // 4. Build prompt input + generate observation
  const promptInput: WeeklyReviewPromptInput = {
    weekStart: weekStartIso,
    weekEnd: weekEndIso,
    tz: config.proactiveTimezone,
    summaries: ctx.summaries.map((s) => ({
      summaryDate: s.summaryDate,
      summary: s.summary,
      importance: s.importance,
      topics: s.topics,
      emotionalArc: s.emotionalArc,
      keyQuotes: s.keyQuotes,
    })),
    resolvedDecisions: ctx.resolvedDecisions.map((d) => ({
      decisionText: d.decisionText,
      reasoning: d.reasoning,
      prediction: d.prediction,
      falsificationCriterion: d.falsificationCriterion,
      resolution: d.resolution ?? '',
      resolutionNotes: d.resolutionNotes,
    })),
    includeWellbeing: ctx.includeWellbeing,
    wellbeingSnapshots: ctx.includeWellbeing
      ? ctx.wellbeingSnapshots.map((w) => ({
          snapshotDate: w.snapshotDate,
          energy: w.energy,
          mood: w.mood,
          anxiety: w.anxiety,
        }))
      : undefined,
  };

  const result = await generateWeeklyObservation(promptInput);

  // 5. Render user-facing message with D031 header (WEEK-04)
  const userFacingMessage = `${WEEKLY_REVIEW_HEADER}\n\n${result.observation}\n\n${result.question}`;

  // 6. Insert ritual_responses row BEFORE Telegram send (M007 D-28 pattern).
  // promptText carries the rendered user-facing message so longitudinal
  // analysis can replay the exact text Greg saw.
  const firedAt = new Date();
  const [fireRow] = await db
    .insert(ritualResponses)
    .values({
      ritualId: ritual.id,
      firedAt,
      promptText: userFacingMessage,
      metadata: {
        observationText: result.observation,
        questionText: result.question,
        isFallback: result.isFallback,
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
      },
    })
    .returning();

  if (!fireRow) {
    throw new Error('rituals.weekly.fire: ritual_responses INSERT returned no row');
  }

  // 7. Persist to Pensieve (WEEK-08) with explicit RITUAL_RESPONSE tag override
  // (D-07 — bypasses Haiku auto-tagger; the auto-tagger only updates entries
  // with epistemic_tag IS NULL, so pre-tagged entries are skipped by future
  // tagger invocations). epistemicTag parameter shipped by Phase 26 commit
  // 6c7210d (D-26-03); this plan reuses, does not re-extend.
  const pensieveEntry = await storePensieveEntry(
    result.observation,
    'telegram',
    {
      ritual_response_id: fireRow.id,
      kind: 'weekly_review',
      week_start: weekStartIso,
      week_end: weekEndIso,
      source_subtype: 'weekly_observation',
    },
    { epistemicTag: 'RITUAL_RESPONSE' },
  );

  // 8. Update ritual_responses with pensieve_entry_id back-reference + respondedAt.
  // respondedAt here marks the system's response (Pensieve write completed),
  // not Greg's textual reply (which would set it via PP#5 in voice-note.ts —
  // but PP#5 is voice-note-specific, NOT used by the weekly review).
  const respondedAt = new Date();
  await db
    .update(ritualResponses)
    .set({ pensieveEntryId: pensieveEntry.id, respondedAt })
    .where(eq(ritualResponses.id, fireRow.id));

  // 9. Send to Telegram
  await bot.api.sendMessage(config.telegramAuthorizedUserId, userFacingMessage);

  // Phase 28 SKIP-01: emit ritual_fire_events on successful weekly review fire.
  // Weekly review emits ONLY 'fired' from this handler (no 'responded' or
  // 'fired_no_response' — see JSDoc note on skip-tracking for weekly review).
  await db.insert(ritualFireEvents).values({
    ritualId: ritual.id,
    firedAt,
    outcome: RITUAL_OUTCOME.FIRED,
    metadata: {
      ritualResponseId: fireRow.id,
      isFallback: result.isFallback,
      weekStart: weekStartIso,
      weekEnd: weekEndIso,
    },
  });

  logger.info(
    {
      ritualId: ritual.id,
      isFallback: result.isFallback,
      pensieveEntryId: pensieveEntry.id,
      durationMs: Date.now() - startMs,
    },
    'rituals.weekly.fire.success',
  );

  return 'fired';
}
