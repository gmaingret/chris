/**
 * src/rituals/weekly-review-prompt.ts — Phase 29 Plan 01
 *
 * Pure-function prompt assembler for the Sunday 20:00 Paris weekly review.
 * Zero side effects: no DB calls, no LLM calls, no fs, no env reads.
 * Producer of the input: Plan 29-02's `generateWeeklyObservation` (TBD).
 *
 * Satisfies the prompt-layer portions of:
 *   - WEEK-02 (CONSTITUTIONAL_PREAMBLE explicit injection — CONS-04 / D038
 *     pattern; Pitfall 17 mitigation against sycophantic weekly observations)
 *   - WEEK-04 (D031 boundary marker constant exported from sibling
 *     weekly-review.ts — header rendering happens at Telegram-send time, not
 *     here, but this file is the contract surface for the prompt-side spec)
 *   - WEEK-07 (pattern-only directive — explicit prompt instruction to
 *     aggregate across summaries/decisions, NOT re-surface individual ones;
 *     M007 ACCOUNTABILITY mode handles per-decision surfacing)
 *   - WEEK-09 (wellbeing variance gate — assembler reads
 *     input.includeWellbeing and conditionally OMITS the wellbeing block;
 *     the boolean is computed by Plan 29-01's weekly-review-sources.ts
 *     `shouldIncludeWellbeing`)
 *
 * NOT in scope here:
 *   - Calling Sonnet (Plan 29-02 — Anthropic SDK messages.parse + zodOutputFormat)
 *   - Computing the date window (Plan 29-01 weekly-review-sources.ts —
 *     `computeWeekBoundary`)
 *   - Computing wellbeing variance (Plan 29-01 weekly-review-sources.ts —
 *     `computeStdDev` + `shouldIncludeWellbeing`)
 *   - Stage-1 Zod refine on the `question` field (Plan 29-02 — refine logic
 *     lives at the SDK boundary alongside the Sonnet call)
 *   - Stage-2 Haiku judge call (Plan 29-02)
 *   - Date-grounding Haiku post-check (Plan 29-02)
 *   - Retry loop + templated fallback (Plan 29-02)
 *   - D031 header rendering at Telegram-send time (Plan 29-02 — uses
 *     WEEKLY_REVIEW_HEADER from sibling weekly-review.ts)
 *   - Pensieve persistence as RITUAL_RESPONSE (Plan 29-02)
 *
 * Tests: src/rituals/__tests__/weekly-review-prompt.test.ts (Plan 29-01).
 * The tests grep the output for specific anchor substrings — do NOT edit
 * anchor phrases below without updating the tests.
 *
 * Mirror: src/episodic/prompts.ts:115-163 `assembleConsolidationPrompt`. Same
 * 9-section structure, same pure-function contract, same CONSTITUTIONAL_PREAMBLE
 * section-1 placement.
 */
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Contract between Plan 29-02's `generateWeeklyObservation` engine and this
 * assembler.
 *
 * `weekStart` and `weekEnd` are ISO 'YYYY-MM-DD' strings rendered in `tz`
 * (typically `config.proactiveTimezone`, 'Europe/Paris'). The assembler does
 * NOT recompute the window — the engine guarantees the [start, end] pair
 * matches the data the assembler is being asked to render.
 *
 * `summaries` are M008 episodic_summaries rows in the 7-day window, ordered
 * ascending by summaryDate (the engine guarantees order — assembler does not
 * sort). Each row's text is rendered verbatim into the prompt.
 *
 * `resolvedDecisions` are M007 decisions rows resolved within the window
 * (`status='resolved' AND resolvedAt BETWEEN start AND end`). When the array
 * is empty the resolved-decisions block is OMITTED entirely.
 *
 * `includeWellbeing` is the boolean output of `shouldIncludeWellbeing`
 * (sibling weekly-review-sources.ts). True → render the `wellbeingSnapshots`
 * block. False → omit. Sonnet never sees wellbeing data when the gate fails
 * (variance < 0.4 in any dim, or fewer than 4 snapshots) — strongest
 * possible enforcement of WEEK-09.
 *
 * `wellbeingSnapshots` is required when `includeWellbeing === true`,
 * otherwise it may be omitted/undefined (the assembler tolerates either).
 */
export type WeeklyReviewPromptInput = {
  weekStart: string; // ISO 'YYYY-MM-DD' in tz below
  weekEnd: string;   // ISO 'YYYY-MM-DD' in tz below
  tz: string;        // IANA tz (e.g., 'Europe/Paris')
  summaries: Array<{
    summaryDate: string;     // ISO 'YYYY-MM-DD'
    summary: string;         // verbatim M008 summary text
    importance: number;      // 1..10
    topics: string[];
    emotionalArc: string;
    keyQuotes: string[];
  }>;
  resolvedDecisions: Array<{
    decisionText: string;
    reasoning: string;
    prediction: string;
    falsificationCriterion: string;
    resolution: string;
    resolutionNotes: string | null;
  }>;
  includeWellbeing: boolean;
  wellbeingSnapshots?: Array<{
    snapshotDate: string;    // ISO 'YYYY-MM-DD'
    energy: number;          // 1..5 Likert
    mood: number;            // 1..5 Likert
    anxiety: number;         // 1..5 Likert
  }>;
};

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Assemble the full Sonnet system prompt for one weekly review.
 *
 * Returns a single string. The caller (Plan 29-02) passes this as the
 * `system` argument to the Anthropic SDK `messages.parse(...)` call.
 *
 * Section ordering (mirror src/episodic/prompts.ts:assembleConsolidationPrompt):
 *   1. CONSTITUTIONAL_PREAMBLE — WEEK-02 / CONS-04 / D038. FIRST so
 *      anti-sycophancy floor binds before any role framing. Pitfall 17.
 *   2. Role preamble — anti-flattery weekly-review specialization.
 *   3. Date-window block — Pitfall 16 (stale dates) prompt-level mitigation.
 *      Sonnet is told the exact window AND told to mark out-of-window
 *      references explicitly. Plan 29-02 adds a Haiku post-check as the
 *      runtime safety net.
 *   4. Pattern-only directive — WEEK-07 / Pitfall 18. Explicit instruction
 *      to aggregate across summaries/decisions, NOT re-surface individual
 *      decisions. M007 ACCOUNTABILITY handles per-decision surfacing.
 *   5. Wellbeing block — WEEK-09. CONDITIONAL on input.includeWellbeing.
 *      When the variance gate failed, Sonnet never sees wellbeing data and
 *      cannot cite it. Strongest possible enforcement of the gate.
 *   6. Summaries block — M008 episodic summaries for the 7 days. Ordered
 *      ascending by summaryDate.
 *   7. Resolved decisions block — CONDITIONAL on resolvedDecisions.length>0.
 *      Each decision rendered with explicit AGGREGATE-NOT-RE-SURFACE reminder.
 *   8. Structured-output directive — LAST, so any earlier text that tried to
 *      inject conflicting schema instructions is followed by the actual
 *      contract. Mirrors src/episodic/prompts.ts § 9.
 */
export function assembleWeeklyReviewPrompt(
  input: WeeklyReviewPromptInput,
): string {
  const sections: string[] = [];

  // 1. Constitutional preamble — WEEK-02 (CONS-04 / D038 anti-sycophancy floor)
  // Pitfall 17 mitigation: explicit injection in cron-context Sonnet calls.
  // The boundary-audit grep guard (`grep -c CONSTITUTIONAL_PREAMBLE
  // src/rituals/weekly-review-prompt.ts >= 2`) verifies both the import line
  // above and this push call are present — drift detector for Pitfall 17.
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — anti-flattery for weekly review specifically.
  sections.push(buildRolePreamble());

  // 3. Date-window block — Pitfall 16 (stale-date) prompt-level mitigation.
  sections.push(buildDateWindowBlock(input.weekStart, input.weekEnd, input.tz));

  // 4. Pattern-only directive — WEEK-07 / Pitfall 18.
  sections.push(buildPatternOnlyDirective());

  // 5. Wellbeing block — WEEK-09. Conditional on includeWellbeing.
  if (input.includeWellbeing && input.wellbeingSnapshots && input.wellbeingSnapshots.length > 0) {
    sections.push(buildWellbeingBlock(input.wellbeingSnapshots));
  }

  // 6. Summaries block — always present (the substrate of the observation).
  sections.push(buildSummariesBlock(input.summaries));

  // 7. Resolved decisions block — conditional on length > 0.
  if (input.resolvedDecisions.length > 0) {
    sections.push(buildResolvedDecisionsBlock(input.resolvedDecisions));
  }

  // 8. Structured-output directive — LAST.
  sections.push(buildStructuredOutputDirective());

  return sections.join('\n\n');
}

// ── Section builders (pure, no side effects) ────────────────────────────────

function buildRolePreamble(): string {
  return [
    '## Your Task',
    "You are generating a weekly review observation for Greg. Synthesize one prose observation about a PATTERN across the past 7 days — drawn from the episodic summaries and resolved decisions provided below. Then ask Greg ONE Socratic question demanding a verdict (force him to evaluate or commit, not to vent).",
    '',
    'Constraints (binding):',
    '- Do not flatter. Do not soften negative events. Do not characterize indecision as wisdom.',
    '- Do not re-surface individual decisions — observations must aggregate across multiple events.',
    '- Do not reference any date outside the window stated below.',
    '- Output exactly one observation paragraph and exactly one question. Do not embed questions in the observation.',
  ].join('\n');
}

function buildDateWindowBlock(
  weekStart: string,
  weekEnd: string,
  tz: string,
): string {
  return [
    '## Date Window',
    `The current week is ${weekStart} to ${weekEnd} (${tz}). Only generate observations about events within this window. If you reference a date, it must fall within this window or you must explicitly mark it as out-of-window with the exact date.`,
  ].join('\n');
}

function buildPatternOnlyDirective(): string {
  return [
    '## Observation Style (PATTERN-ONLY)',
    'Generate observations about PATTERNS across the week, NOT individual decisions. Individual decision resolution is surfaced via M007 ACCOUNTABILITY mode separately. Your observation should aggregate or synthesize across multiple summaries/decisions; do NOT focus on a single decision or single day.',
  ].join('\n');
}

function buildWellbeingBlock(
  snapshots: NonNullable<WeeklyReviewPromptInput['wellbeingSnapshots']>,
): string {
  const lines: string[] = ['## Wellbeing Snapshots This Week (each on 1-5 Likert scale)'];
  for (const s of snapshots) {
    lines.push(
      `- ${s.snapshotDate}: energy=${s.energy}, mood=${s.mood}, anxiety=${s.anxiety}`,
    );
  }
  lines.push('');
  lines.push(
    'Greg has been logging wellbeing daily; the variance threshold has been met (otherwise this block would be omitted). You MAY reference patterns in the wellbeing series in your observation, but you do NOT need to — observations about narrative content (summaries + decisions) are equally valid.',
  );
  return lines.join('\n');
}

function buildSummariesBlock(
  summaries: WeeklyReviewPromptInput['summaries'],
): string {
  if (summaries.length === 0) {
    return [
      '## Episodic Summaries This Week',
      '(no episodic summaries available for this 7-day window)',
    ].join('\n');
  }
  const lines: string[] = ['## Episodic Summaries This Week'];
  for (const s of summaries) {
    lines.push('');
    lines.push(`### Summary ${s.summaryDate} (importance ${s.importance})`);
    lines.push(s.summary);
    if (s.topics.length > 0) {
      lines.push(`Topics: ${s.topics.join(', ')}`);
    }
    if (s.emotionalArc.length > 0) {
      lines.push(`Emotional arc: ${s.emotionalArc}`);
    }
    if (s.keyQuotes.length > 0) {
      lines.push('Key quotes:');
      for (const q of s.keyQuotes) {
        lines.push(`- "${q}"`);
      }
    }
  }
  return lines.join('\n');
}

function buildResolvedDecisionsBlock(
  decisions: WeeklyReviewPromptInput['resolvedDecisions'],
): string {
  const lines: string[] = [
    '## Decisions Resolved This Week (M007)',
    'These decisions were resolved during the window. AGGREGATE across them — do NOT re-surface individual outcomes; M007 ACCOUNTABILITY mode handles per-decision surfacing separately.',
    '',
  ];
  for (const d of decisions) {
    lines.push(`- ${d.decisionText}`);
    lines.push(`  Reasoning at capture: ${d.reasoning}`);
    lines.push(`  Forecast: ${d.prediction}`);
    lines.push(`  Falsification criterion: ${d.falsificationCriterion}`);
    lines.push(`  Resolution: ${d.resolution}`);
    if (d.resolutionNotes !== null) {
      lines.push(`  Notes: ${d.resolutionNotes}`);
    }
  }
  return lines.join('\n').trimEnd();
}

function buildStructuredOutputDirective(): string {
  return [
    '## Output Format',
    'Return JSON: { observation: string, question: string }. The observation is one prose paragraph (20-800 chars). The question is exactly ONE Socratic question demanding a verdict — not "how do you feel?", but a question that forces Greg to evaluate or commit. Do NOT include compound questions joined by "and"/"or"/"and also". Do NOT ask multiple questions. Do NOT include a question in your observation — the observation is a statement; the question is separate.',
  ].join('\n');
}
