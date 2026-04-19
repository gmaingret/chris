/**
 * src/episodic/prompts.ts — Phase 21 Plan 02
 *
 * Pure-function prompt assembler for M008 daily episodic consolidation.
 * Zero side effects: no DB calls, no LLM calls, no fs, no env reads.
 * Producer of the input: Plan 21-04's `runConsolidate` (to be written next wave).
 *
 * Satisfies the prompt-layer portions of:
 *   - CONS-04  (constitutional preamble injection — D024)
 *   - CONS-05  (importance rubric — 4 bands + frequency + chain-of-thought)
 *   - CONS-06  (decision floor hook, prompt-level)
 *   - CONS-07  (contradiction floor hook, prompt-level)
 *   - CONS-08  (M007 decision data injection)
 *   - CONS-09  (M002 contradiction pair preservation — D031, PRD §12)
 *   - CONS-10  (key_quotes verbatim enforcement)
 *   - CONS-11  (sparse-entry guard — entry count < 3 OR total content < ~100 tokens)
 *
 * NOT in scope here:
 *   - Actually calling Sonnet (Plan 21-04)
 *   - Reading contradictions/decisions from DB (Plan 21-04)
 *   - Zod parsing of the response (Plan 21-04; schemas live in ./types.ts)
 *
 * Unit tests: src/episodic/__tests__/prompts.test.ts (Task 2 of this plan).
 * The tests grep the output for specific anchor substrings — do NOT edit anchor
 * phrases below without updating the tests.
 */
import { DateTime } from 'luxon';
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Contract between Plan 21-04's `runConsolidate` engine and this assembler.
 *
 * `entries` are verbatim Pensieve rows for the day (in `config.proactiveTimezone`),
 * pre-sorted by `createdAt` ascending. The assembler does NOT sort — the engine
 * guarantees order.
 *
 * `contradictions` is filtered to `confidence >= 0.75` within the day window by
 * the engine before being handed off (see CONS-09 / M002 D006).
 *
 * `decisions` contains every decision whose `created_at` OR `updated_at`
 * (lifecycle transition) fell within the day window — including resolved ones
 * (see CONS-08 / M007). The assembler does NOT re-query; it renders what it is
 * given.
 *
 * `tz` is the IANA tz the caller uses to bucket entries into a calendar day
 * (typically `config.proactiveTimezone`). It is used to render each entry's
 * HH:MM timestamp in the entries block so the displayed time matches the tz
 * claim in the block header. UTC rendering is a correctness bug for Sonnet's
 * time-of-day reasoning (CONS-05 emotional-intensity dimension, CONS-11
 * sparse-day reasoning) — see review WR-01.
 */
export type ConsolidationPromptInput = {
  summaryDate: string; // ISO yyyy-mm-dd in the tz below
  tz: string; // IANA tz (e.g., 'Europe/Paris') — used to render entry timestamps
  entries: Array<{
    id: string;
    content: string; // verbatim Pensieve entry text
    epistemicTag: string | null;
    createdAt: Date; // timestamp within the day window
    source: string; // 'telegram' | 'gmail' | 'drive' | 'immich' | ...
  }>;
  contradictions: Array<{
    entryAContent: string;
    entryBContent: string;
    description: string;
  }>;
  decisions: Array<{
    decisionText: string;
    lifecycleState: string; // 'open' | 'due' | 'resolved' | 'reviewed' | 'withdrawn' | 'stale' | 'abandoned' | 'open-draft'
    reasoning: string;
    prediction: string; // the forecast
    falsificationCriterion: string;
    resolution: string | null; // null if not resolved this day
    resolutionNotes: string | null; // null if not resolved this day
  }>;
};

// ── Internal constants ──────────────────────────────────────────────────────

/**
 * CONS-11 sparse-entry thresholds.
 * - Count threshold: fewer than 3 entries → sparse.
 * - Content threshold: total character count under 400 ≈ 100 tokens at the
 *   widely-used 4-chars/token heuristic. We avoid tiktoken here to keep this
 *   module dependency-free.
 */
const SPARSE_ENTRY_COUNT_THRESHOLD = 3;
const SPARSE_CONTENT_CHAR_THRESHOLD = 400;

function isSparseDay(input: ConsolidationPromptInput): boolean {
  if (input.entries.length < SPARSE_ENTRY_COUNT_THRESHOLD) return true;
  const totalChars = input.entries.reduce((sum, e) => sum + e.content.length, 0);
  return totalChars < SPARSE_CONTENT_CHAR_THRESHOLD;
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Assemble the full Sonnet system prompt for a given day's consolidation.
 *
 * Returns a single string. The caller (Plan 21-04) passes this as the `system`
 * argument to `anthropic.messages.parse({ system, messages, response_format, ... })`.
 *
 * Sparse-mode is derived from the input shape (entries.length < 3 OR total
 * content < ~100 tokens) — NOT from a caller flag. This prevents the engine
 * from accidentally over-reporting a sparse day as dense or vice versa.
 *
 * Throws if `entries` is empty — the caller (runConsolidate) is contractually
 * required to apply the CONS-02 zero-entry skip gate BEFORE calling this
 * assembler. A zero-entry call is a programmer error, not a user-visible
 * failure mode.
 */
export function assembleConsolidationPrompt(input: ConsolidationPromptInput): string {
  if (input.entries.length === 0) {
    throw new Error(
      'assembleConsolidationPrompt: entries array must be non-empty — entry-count gate must be checked by caller',
    );
  }

  const sparse = isSparseDay(input);
  const sections: string[] = [];

  // 1. Constitutional preamble — CONS-04 (D024 anti-sycophancy floor)
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — anti-flattery (Pitfall #1 / D024)
  sections.push(buildRolePreamble());

  // 3. Importance rubric — CONS-05 (4 bands + frequency + chain-of-thought)
  sections.push(buildImportanceRubric());

  // 4. Verbatim quote enforcement — CONS-10 (D031 fidelity)
  sections.push(buildVerbatimQuoteClause());

  // 5. Contradiction block — CONS-09 (D031, PRD §12) — conditional
  if (input.contradictions.length > 0) {
    sections.push(buildContradictionBlock(input.contradictions));
  }

  // 6. Decision block — CONS-08 data injection + CONS-06/07 floor hooks
  // The floor hooks ALSO need the contradiction flag from section 5, so we
  // pass both input fields in; the block itself decides which floors to emit.
  if (input.decisions.length > 0 || input.contradictions.length > 0) {
    const block = buildDecisionAndFloorBlock(input.decisions, input.contradictions);
    if (block.length > 0) sections.push(block);
  }

  // 7. Sparse-entry guard — CONS-11 — conditional on sparse mode
  if (sparse) {
    sections.push(buildSparseEntryGuard());
  }

  // 8. Entries block — always present (verbatim, timestamped in input.tz)
  sections.push(buildEntriesBlock(input.entries, input.summaryDate, input.tz));

  // 9. Structured-output directive — last, so any entry that tried to inject
  //    a conflicting instruction is followed by the actual schema request.
  sections.push(buildStructuredOutputDirective());

  return sections.join('\n\n');
}

// ── Section builders (pure, no side effects) ────────────────────────────────

function buildRolePreamble(): string {
  return [
    '## Your Task',
    "You are generating an episodic summary of Greg's day. Describe what actually happened. Do not soften negative experiences, reframe frustration as growth, or characterize indecision as wisdom. Preserve the emotional register of the raw entries — including anger, anxiety, confusion, and uncertainty — as they were expressed. You are compressing a record, not constructing a narrative that reflects well on the author.",
  ].join('\n');
}

function buildImportanceRubric(): string {
  return [
    '## Importance Score (integer 1–10)',
    'Anchor each day to one of four bands:',
    '- Score 1–3: mundane, routine, no emotional intensity. Most days.',
    '- Score 4–6: notable — at least one decision, strong emotion, or meaningful event.',
    '- Score 7–9: significant — structural decision, contradiction surfaced, sustained emotional intensity, or novel context.',
    '- Score 10: life-event-rare — once-a-year magnitude (birth, death, major relationship change, career rupture).',
    '',
    'Frequency distribution guidance:',
    'Most days are 3–6. Scores of 7+ should be uncommon across a sustained period (roughly 10–20% of days). Score 10 should be rare — fewer than 5% of days in a year.',
    '',
    'Chain-of-thought requirement:',
    'Before assigning the score, explicitly reason through each of the following four dimensions in order:',
    '1. emotional intensity (was the day flat, charged, or extreme?)',
    '2. novelty vs. routine (was anything today different from a baseline day?)',
    '3. decision presence (was a structural decision captured or resolved today?)',
    '4. contradiction presence (was a flagged contradiction surfaced today?)',
    '',
    'Do not anchor to the midpoint. Err toward the extremes when the evidence supports it.',
  ].join('\n');
}

function buildVerbatimQuoteClause(): string {
  return [
    '## Verbatim Quotes',
    'For the `key_quotes` field: each entry in key_quotes must be a verbatim substring of an entry from the day. Do not paraphrase, summarize, or clean up grammar. Do not shift tense or person. The quote must be findable by exact substring match in the source Pensieve entry text. If no sentence meets this bar, return an empty `key_quotes` array — an empty array is better than a paraphrase.',
  ].join('\n');
}

function buildContradictionBlock(
  contradictions: ConsolidationPromptInput['contradictions'],
): string {
  const lines: string[] = [
    '## Contradictions Flagged Today (M002, confidence ≥ 0.75)',
    'The following pairs of statements from today were flagged as contradictions. Preserve both positions verbatim. Do not smooth them into a single resolved arc. Do not infer which position Greg "really" holds. Use the format: "Greg held contradictory positions on [X]: [Y] versus [Z]. These were not reconciled."',
    '',
  ];
  contradictions.forEach((c, idx) => {
    lines.push(`Contradiction ${idx + 1}:`);
    lines.push(`- Position A: ${c.entryAContent}`);
    lines.push(`- Position B: ${c.entryBContent}`);
    lines.push(`- Description: ${c.description}`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

function buildDecisionAndFloorBlock(
  decisions: ConsolidationPromptInput['decisions'],
  contradictions: ConsolidationPromptInput['contradictions'],
): string {
  const lines: string[] = [];

  if (decisions.length > 0) {
    lines.push('## Decisions Created or Resolved Today (M007)');
    lines.push(
      "For each decision below, the lifecycle_state reflects the state as of this date — do NOT describe a decision in state 'open' or 'due' as 'decided' or 'resolved' in the summary unless the entries explicitly contain a resolution statement and lifecycle_state is 'resolved' or 'reviewed'.",
    );
    lines.push('');
    lines.push('Decisions:');
    for (const d of decisions) {
      lines.push(`- ${d.decisionText} (state: ${d.lifecycleState})`);
      lines.push(`  Reasoning: ${d.reasoning}`);
      lines.push(`  Forecast: ${d.prediction}`);
      lines.push(`  Falsification criterion: ${d.falsificationCriterion}`);
      if (d.resolution !== null) {
        lines.push(`  Resolution: ${d.resolution}`);
      }
      if (d.resolutionNotes !== null) {
        lines.push(`  Notes: ${d.resolutionNotes}`);
      }
    }
    lines.push('');
  }

  // CONS-06 floor hook — a decision was captured or resolved today.
  if (decisions.length > 0) {
    lines.push(
      '## Importance Floor (CONS-06)',
      'A structural decision was captured or resolved today — importance score MUST be at least 6.',
    );
    lines.push('');
  }

  // CONS-07 floor hook — a contradiction was flagged today.
  if (contradictions.length > 0) {
    lines.push(
      '## Importance Floor (CONS-07)',
      'A contradiction was flagged today — importance score MUST be at least 7.',
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function buildSparseEntryGuard(): string {
  return [
    '## Sparse-Entry Guard (CONS-11)',
    "This day has very few entries. You may only state what is explicitly present in the source entries. Do not infer, speculate, or elaborate beyond what Greg wrote. When an entry is sparse, the summary for that entry must be sparse. Write 'Greg noted: [what he wrote]' rather than expanding on what he might have meant. The `topics` array may contain only topics directly present in the entries. The `key_quotes` array may be empty if no direct quotes meet the verbatim criterion. Do not invent proper nouns (people, places, company names) that are not present in any source entry.",
  ].join('\n');
}

function buildEntriesBlock(
  entries: ConsolidationPromptInput['entries'],
  summaryDate: string,
  tz: string,
): string {
  const lines: string[] = [
    `## Today's Pensieve Entries (verbatim, timestamped in ${tz} — ${summaryDate})`,
  ];
  for (const e of entries) {
    // Render HH:MM in the caller's IANA tz — this is what the block header
    // promises. UTC rendering here (previous behavior) was a CONS-05 /
    // CONS-11 correctness bug for any deployment where tz != UTC — an entry
    // created at 23:30 Europe/Paris (21:30 UTC) was printed as "[21:30, ...]"
    // while the header claimed Europe/Paris, making Sonnet reason about
    // time-of-day incorrectly (late-night → afternoon). Per review WR-01.
    const local = DateTime.fromJSDate(e.createdAt, { zone: tz });
    const hh = String(local.hour).padStart(2, '0');
    const mm = String(local.minute).padStart(2, '0');
    const tag = e.epistemicTag !== null ? `, tag=${e.epistemicTag}` : '';
    lines.push(`- [${hh}:${mm}, ${e.source}${tag}] ${e.content}`);
  }
  return lines.join('\n');
}

function buildStructuredOutputDirective(): string {
  return [
    '## Output Format',
    'Return your answer as a single JSON object matching the provided schema. Fields:',
    '- `summary`: prose narrative, minimum 50 characters',
    '- `importance`: integer in [1, 10]',
    '- `topics`: 1–10 free-form topic tags (short strings, each non-empty)',
    '- `emotional_arc`: one-sentence description of the day\'s emotional trajectory',
    '- `key_quotes`: 0–10 verbatim substrings copied from the entries above (empty array is acceptable)',
  ].join('\n');
}
