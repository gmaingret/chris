/**
 * src/rituals/__tests__/weekly-review-prompt.test.ts — Phase 29 Plan 01
 *
 * Unit tests for the pure-function weekly-review prompt assembler. Covers:
 *   - WEEK-02 (CONSTITUTIONAL_PREAMBLE first; boundary-audit grep companion)
 *   - WEEK-04 (D031 boundary marker constant verbatim)
 *   - WEEK-07 (pattern-only directive present verbatim)
 *   - WEEK-09 partial — wellbeing block conditional on input.includeWellbeing
 *   - Resolved-decisions block conditional on length > 0
 *   - Date window string interpolation
 *   - Structured-output directive last (so accidental injection in earlier
 *     blocks cannot override the contract Sonnet receives)
 *
 * All assertions are deterministic — no LLM calls, no DB, no mocks.
 *
 * Run: npx vitest run src/rituals/__tests__/weekly-review-prompt.test.ts
 */

import { describe, it, expect } from 'vitest';
import { CONSTITUTIONAL_PREAMBLE } from '../../chris/personality.js';
import {
  assembleWeeklyReviewPrompt,
  type WeeklyReviewPromptInput,
} from '../weekly-review-prompt.js';
import { WEEKLY_REVIEW_HEADER } from '../weekly-review.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

/**
 * Default fixture: a fully-populated week with summaries, resolved decisions,
 * and 4 wellbeing snapshots that pass the variance gate (includeWellbeing
 * true). Tests override individual fields via the spread.
 */
function buildFixture(
  overrides?: Partial<WeeklyReviewPromptInput>,
): WeeklyReviewPromptInput {
  return {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    tz: 'Europe/Paris',
    summaries: [
      {
        summaryDate: '2026-04-20',
        summary:
          'Greg circled the Q2 product decision again, listing the same three options but in a different order. Did not commit.',
        importance: 6,
        topics: ['product', 'indecision'],
        emotionalArc: 'morning frustration → evening resignation',
        keyQuotes: ['I keep going around in circles on this'],
      },
      {
        summaryDate: '2026-04-22',
        summary:
          'Hard conversation with Anna about the runway. She pushed on the falsification criterion he had not written down.',
        importance: 7,
        topics: ['relationship', 'finance'],
        emotionalArc: 'defensive → engaged',
        keyQuotes: [],
      },
      {
        summaryDate: '2026-04-25',
        summary:
          'Quiet Saturday. Read for two hours, did not check email. Wrote a short journal entry about feeling more clear-headed than the rest of the week.',
        importance: 3,
        topics: ['rest'],
        emotionalArc: 'flat / calm',
        keyQuotes: [],
      },
    ],
    resolvedDecisions: [
      {
        decisionText: 'Cancel the Q1 vendor contract',
        reasoning: 'Vendor missed two deliverables; cost-of-switching now < cost-of-staying',
        prediction: 'Switching saves ~6 weeks and unblocks the analytics rollout',
        falsificationCriterion: 'If the new vendor takes >8 weeks to integrate, this was wrong',
        resolution: 'Contract cancelled 2026-04-21',
        resolutionNotes: 'New vendor integration on track for 6-week target',
      },
    ],
    includeWellbeing: true,
    wellbeingSnapshots: [
      { snapshotDate: '2026-04-20', energy: 2, mood: 3, anxiety: 4 },
      { snapshotDate: '2026-04-22', energy: 3, mood: 4, anxiety: 3 },
      { snapshotDate: '2026-04-24', energy: 4, mood: 4, anxiety: 2 },
      { snapshotDate: '2026-04-26', energy: 3, mood: 3, anxiety: 3 },
    ],
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('assembleWeeklyReviewPrompt — pure prompt assembler (Phase 29 Plan 01)', () => {
  it('CONSTITUTIONAL_PREAMBLE first — output STARTS with "## Core Principles (Always Active)" (WEEK-02)', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture());
    expect(out.startsWith('## Core Principles (Always Active)')).toBe(true);
    // Defense in depth: also assert the imported constant's first line is the
    // anchor — protects against accidental refactor of personality.ts.
    expect(CONSTITUTIONAL_PREAMBLE.startsWith('## Core Principles (Always Active)')).toBe(true);
  });

  it('D031 header constant — WEEKLY_REVIEW_HEADER === exact verbatim spec text (WEEK-04)', () => {
    expect(WEEKLY_REVIEW_HEADER).toBe('Observation (interpretation, not fact):');
  });

  it('pattern-only directive — output contains "PATTERNS across the week" verbatim (WEEK-07)', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture());
    expect(out).toContain('PATTERNS across the week');
  });

  it('wellbeing block conditional (true) — includeWellbeing=true + 4 snapshots → block rendered', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture({ includeWellbeing: true }));
    expect(out).toContain('Wellbeing Snapshots This Week');
    // Sanity: snapshot dates should appear in the block.
    expect(out).toContain('2026-04-20');
    expect(out).toContain('energy=2');
  });

  it('wellbeing block conditional (false) — includeWellbeing=false → block omitted (WEEK-09)', () => {
    const out = assembleWeeklyReviewPrompt(
      buildFixture({ includeWellbeing: false, wellbeingSnapshots: undefined }),
    );
    expect(out).not.toContain('Wellbeing Snapshots');
    // The variance-gate-failed flag MUST yield an absent block — Sonnet
    // never sees the data and cannot cite it.
  });

  it('resolved decisions block conditional — empty resolvedDecisions → block omitted', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture({ resolvedDecisions: [] }));
    expect(out).not.toContain('Decisions Resolved This Week');
  });

  it('resolved decisions block present when array non-empty', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture());
    expect(out).toContain('Decisions Resolved This Week');
    expect(out).toContain('Cancel the Q1 vendor contract');
  });

  it('date window in prompt — weekStart and weekEnd appear verbatim with tz', () => {
    const out = assembleWeeklyReviewPrompt(
      buildFixture({ weekStart: '2026-04-20', weekEnd: '2026-04-26', tz: 'Europe/Paris' }),
    );
    expect(out).toContain('2026-04-20');
    expect(out).toContain('2026-04-26');
    expect(out).toContain('Europe/Paris');
    expect(out).toContain('## Date Window');
  });

  it('structured-output directive last — final \\n\\n-separated section starts with "## Output Format"', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture());
    const sections = out.split('\n\n');
    const last = sections[sections.length - 1];
    expect(last).toBeDefined();
    expect(last!.startsWith('## Output Format')).toBe(true);
  });

  it('summaries block — every summary date appears in the prompt', () => {
    const fixture = buildFixture();
    const out = assembleWeeklyReviewPrompt(fixture);
    for (const s of fixture.summaries) {
      expect(out).toContain(s.summaryDate);
      expect(out).toContain(s.summary);
    }
  });
});
