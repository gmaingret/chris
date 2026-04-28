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
import { rituals, ritualResponses } from '../db/schema.js';
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
import type { RitualConfig, RitualFireOutcome } from './types.js';

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
