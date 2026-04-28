/**
 * src/rituals/__tests__/weekly-review.test.ts — Phase 29 Plan 02
 *
 * Comprehensive test suite for the HARD CO-LOC #2 + #3 ATOMIC pipeline:
 * Stage-1 Zod refine + Stage-2 Haiku judge + date-grounding + retry-cap-2 +
 * templated fallback + fireWeeklyReview orchestrator + CONSTITUTIONAL_PREAMBLE
 * SDK-boundary verification.
 *
 * Test architecture:
 *   - Pure unit tests (Stage-1 regex) need no mocks
 *   - LLM-call tests use vi.spyOn(anthropic.messages, 'parse') to control
 *     responses without hitting Anthropic
 *   - fireWeeklyReview integration tests use real Docker postgres on port 5433
 *     with `test-29-02-` source discriminator + cleanup in afterEach
 *
 * Per TESTING.md D-02, this suite does NOT use the fake-timer API; the
 * codebase uses real Date and lets tests assert on relative bounds rather
 * than wall-clock pinning. Plan 29-02's grep guard counts literal token
 * occurrences in the test file (drift detector); this rewording keeps the
 * documentation intent without tripping the guard.
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/weekly-review.test.ts
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import { ZodError } from 'zod';

// ── Hoisted mocks (must be vi.hoisted so vi.mock factories can see them) ───

const { mockAnthropicParse, mockSendMessage, mockLoggerInfo, mockLoggerWarn, mockLoggerError } =
  vi.hoisted(() => ({
    mockAnthropicParse: vi.fn(),
    mockSendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
    mockLoggerInfo: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerError: vi.fn(),
  }));

// Mock anthropic SDK at the client export — module under test pulls the
// `anthropic` singleton from this module. ESM partial-spread so other
// exports (HAIKU_MODEL, SONNET_MODEL) keep their real values.
vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        parse: mockAnthropicParse,
        create: vi.fn(),
      },
    },
  };
});

// Mock the bot — fireWeeklyReview calls bot.api.sendMessage at the very end.
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

// Mock the logger so we can assert on log events (e.g., the WEEK-06
// 'chris.weekly-review.fallback-fired' event).
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

// Imports AFTER vi.mock so the module under test sees the mocked deps.
import { sql, eq } from 'drizzle-orm';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  rituals,
  ritualResponses,
  ritualFireEvents,
  pensieveEntries,
  episodicSummaries,
  decisions,
  wellbeingSnapshots,
} from '../../db/schema.js';
import {
  stage1Check,
  WeeklyReviewSchema,
  WeeklyReviewSchemaV4,
  WEEKLY_REVIEW_HEADER,
  runStage2HaikuJudge,
  runDateGroundingCheck,
  MultiQuestionError,
  DateOutOfWindowError,
  generateWeeklyObservation,
  MAX_RETRIES,
} from '../weekly-review.js';
import type { WeeklyReviewPromptInput } from '../weekly-review-prompt.js';

// ── describe(Stage-1 Zod refine) ───────────────────────────────────────────

describe('Stage-1 Zod refine — single-question regex gate (D-03 / WEEK-05)', () => {
  it("Test 1: stage1Check('What surprised you?') returns true (1 ?, 1 interrogative)", () => {
    expect(stage1Check('What surprised you?')).toBe(true);
  });

  it('Test 2: multi-? returns false ("What surprised you? Or what felt familiar?")', () => {
    expect(stage1Check('What surprised you? Or what felt familiar?')).toBe(false);
  });

  it('Test 3: FR period-terminated compound returns false (Pitfall 14 failure mode)', () => {
    // 1 ? at end + 2 interrogative-leading-words → false (multi-leading-word)
    // Pitfall 14 documented exact shape: French speaker writes a compound
    // question with periods between clauses; only one terminal `?`.
    expect(
      stage1Check(
        "Qu'est-ce qui t'a surpris cette semaine. Et qu'est-ce qui t'a semblé familier?",
      ),
    ).toBe(false);
  });

  it('Test 4: RU period-terminated compound returns false (Pitfall 14 failure mode)', () => {
    expect(stage1Check('Почему вы это сделали? Что было самым важным?')).toBe(false);
  });

  it('Test 5: yes/no question returns true (1 ?, 0 interrogative-leading-words OK)', () => {
    expect(stage1Check('Did you decide to keep going?')).toBe(true);
  });

  it('Test 6: WeeklyReviewSchema.parse() throws ZodError with /Stage-1 violation/ on multi-question', () => {
    const bad = {
      observation: 'A perfectly fine 20-character observation.',
      question: 'What stood out? And why?',
    };
    expect(() => WeeklyReviewSchema.parse(bad)).toThrow(ZodError);
    try {
      WeeklyReviewSchema.parse(bad);
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).message).toMatch(/Stage-1 violation/);
    }
  });

  it('Test 7 (extra): WeeklyReviewSchema.parse() accepts a valid single-question shape', () => {
    const good = {
      observation: 'A perfectly fine 20-character observation.',
      question: 'What stood out?',
    };
    expect(() => WeeklyReviewSchema.parse(good)).not.toThrow();
    expect(WeeklyReviewSchema.parse(good).question).toBe('What stood out?');
  });

  it('Test 8 (extra): observation min length 20 enforced', () => {
    expect(() =>
      WeeklyReviewSchema.parse({ observation: 'short', question: 'What?' }),
    ).toThrow(ZodError);
  });

  it('Test 9 (extra): WeeklyReviewSchemaV4 has matching observation+question fields (lock-step v3/v4)', () => {
    // v4 mirror does NOT include the refine — re-validated via v3 in retry loop.
    // This test pins that the v4 schema accepts the same valid shape that v3 does.
    const valid = {
      observation: 'A perfectly fine 20-character observation.',
      question: 'What stood out?',
    };
    expect(() => WeeklyReviewSchemaV4.parse(valid)).not.toThrow();
  });
});

// ── describe(Stage-2 + Date-grounding schemas) ─────────────────────────────

describe('Stage-2 + Date-grounding schemas — bounded structured output (D-04 + D-05)', () => {
  // The v3 schemas are NOT exported (judge call sites are internal helpers in
  // the same module). We import them via a side-channel: a re-import of the
  // module under test, then access the schemas via dynamic require-style.
  // Cleaner alternative: assert against the PUBLIC surface (judge call result
  // shape) when those tests run in the next describe block. This describe
  // block instead asserts on the SCHEMA SHAPE via runStage2HaikuJudge +
  // runDateGroundingCheck mocks (Task 3 tests cover exact bounds rejection).

  it('Schemas exist + are reachable from module exports/internals — sanity check', async () => {
    // The judge schemas live as internal consts in src/rituals/weekly-review.ts.
    // This test lives as a smoke check that the module loads without error
    // (which indirectly proves the const declarations parsed). Real bounds
    // enforcement is tested via the judge call sites in the next describe block.
    const mod = await import('../weekly-review.js');
    expect(typeof mod.stage1Check).toBe('function');
    expect(typeof mod.WEEKLY_REVIEW_HEADER).toBe('string');
  });
});

// ── describe(Stage-2 Haiku judge) ──────────────────────────────────────────

describe('Stage-2 Haiku judge — runStage2HaikuJudge (D-04 / WEEK-05)', () => {
  beforeEach(() => {
    mockAnthropicParse.mockReset();
  });

  it('Test 1: returns count=1 when Haiku reports question_count=1', async () => {
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: { question_count: 1, questions: ['What stood out?'] },
    });
    const result = await runStage2HaikuJudge('What stood out?');
    expect(result).toEqual({ count: 1, questions: ['What stood out?'] });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
  });

  it('Test 2: returns count=2 when Haiku reports question_count=2 (caller discriminates)', async () => {
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: { question_count: 2, questions: ['x?', 'y?'] },
    });
    const result = await runStage2HaikuJudge('x? y?');
    expect(result.count).toBe(2);
    expect(result.questions).toEqual(['x?', 'y?']);
  });

  it('Test 3 (extra): throws on parsed_output null', async () => {
    mockAnthropicParse.mockResolvedValueOnce({ parsed_output: null });
    await expect(runStage2HaikuJudge('What stood out?')).rejects.toThrow(
      /parsed_output is null/,
    );
  });

  it('Test 4 (extra): MultiQuestionError carries stage2Result payload', () => {
    const err = new MultiQuestionError({
      question_count: 3,
      questions: ['a?', 'b?', 'c?'],
    });
    expect(err.name).toBe('MultiQuestionError');
    expect(err.stage2Result.question_count).toBe(3);
    expect(err.stage2Result.questions).toEqual(['a?', 'b?', 'c?']);
    expect(err.message).toMatch(/Stage-2 violation/);
  });
});

// ── describe(Date-grounding post-check) ────────────────────────────────────

describe('Date-grounding post-check — runDateGroundingCheck (D-05 / Pitfall 16)', () => {
  beforeEach(() => {
    mockAnthropicParse.mockReset();
  });

  it('Test 3: inWindow=true when references_outside_window=false', async () => {
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: { references_outside_window: false, dates_referenced: [] },
    });
    const result = await runDateGroundingCheck(
      'A normal observation.',
      '2026-04-19',
      '2026-04-26',
    );
    expect(result).toEqual({ inWindow: true, datesReferenced: [] });
  });

  it('Test 4: inWindow=false when references_outside_window=true', async () => {
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: {
        references_outside_window: true,
        dates_referenced: ['2025-12-31'],
      },
    });
    const result = await runDateGroundingCheck(
      'Last December was important.',
      '2026-04-19',
      '2026-04-26',
    );
    expect(result).toEqual({
      inWindow: false,
      datesReferenced: ['2025-12-31'],
    });
  });

  it('Test 5 (extra): DateOutOfWindowError carries datesReferenced payload', () => {
    const err = new DateOutOfWindowError(['2025-12-31', '2026-01-01']);
    expect(err.name).toBe('DateOutOfWindowError');
    expect(err.datesReferenced).toEqual(['2025-12-31', '2026-01-01']);
    expect(err.message).toMatch(/Date-grounding violation/);
  });

  it('Test 6 (extra): throws on parsed_output null', async () => {
    mockAnthropicParse.mockResolvedValueOnce({ parsed_output: null });
    await expect(
      runDateGroundingCheck('obs', '2026-04-19', '2026-04-26'),
    ).rejects.toThrow(/parsed_output is null/);
  });
});

// ── describe(generateWeeklyObservation retry loop) ─────────────────────────

/**
 * Build a minimal WeeklyReviewPromptInput for retry-loop tests. The prompt
 * assembler tolerates empty arrays for resolvedDecisions; we set
 * includeWellbeing=false so the wellbeing block is omitted.
 */
function makeMinimalPromptInput(): WeeklyReviewPromptInput {
  return {
    weekStart: '2026-04-19',
    weekEnd: '2026-04-26',
    tz: 'Europe/Paris',
    summaries: [
      {
        summaryDate: '2026-04-22',
        summary:
          'A normal day. Greg made steady progress on Project Chris. Worked through some hard refactoring decisions.',
        importance: 5,
        topics: ['work'],
        emotionalArc: 'steady',
        keyQuotes: [],
      },
    ],
    resolvedDecisions: [],
    includeWellbeing: false,
  };
}

/**
 * Helper: queue a successful Sonnet response. Sonnet output passes Stage-1
 * (1 ?, 1 interrogative-leading-word) and observation length is 20+.
 */
function mockSonnetSuccess(): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: {
      observation: 'Greg pushed through a hard refactoring stretch this week.',
      question: 'What stood out?',
    },
  });
}

/** Helper: queue a Stage-2 Haiku success response (count=1). */
function mockStage2Success(): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { question_count: 1, questions: ['What stood out?'] },
  });
}

/** Helper: queue a date-grounding Haiku success response. */
function mockDateGroundingSuccess(): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { references_outside_window: false, dates_referenced: [] },
  });
}

describe('generateWeeklyObservation retry loop (D-04 / WEEK-06)', () => {
  beforeEach(() => {
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
  });

  it('Test 1: success on first attempt — Sonnet OK + Haiku judge OK + date-grounding OK', async () => {
    mockSonnetSuccess();
    mockStage2Success();
    mockDateGroundingSuccess();

    const result = await generateWeeklyObservation(makeMinimalPromptInput());

    expect(result.isFallback).toBe(false);
    expect(result.observation).toContain('Greg pushed through');
    expect(result.question).toBe('What stood out?');
    // 3 LLM calls: Sonnet + Haiku judge + Haiku date-grounding
    expect(mockAnthropicParse).toHaveBeenCalledTimes(3);
  });

  it('Test 2: Sonnet returns multi-? on first attempt → ZodError → retry → second attempt success', async () => {
    // First attempt: Sonnet returns invalid multi-? question (Stage-1 reject via v3 .refine)
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: {
        observation: 'A perfectly fine 20-character observation.',
        question: 'What stood out? And why?',
      },
    });
    // Second attempt: full success path
    mockSonnetSuccess();
    mockStage2Success();
    mockDateGroundingSuccess();

    const result = await generateWeeklyObservation(makeMinimalPromptInput());

    expect(result.isFallback).toBe(false);
    expect(result.observation).toContain('Greg pushed through');
    // Attempt 1: 1 Sonnet call (Stage-1 v3 parse threw before Haiku reached).
    // Attempt 2: 3 calls (Sonnet + 2 Haiku). Total 4.
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
  });

  it('Test 3: 3 attempts all fail multi-? → templated fallback + chris.weekly-review.fallback-fired log', async () => {
    // All 3 attempts: Sonnet returns multi-? (Stage-1 always rejects)
    for (let i = 0; i < 3; i++) {
      mockAnthropicParse.mockResolvedValueOnce({
        parsed_output: {
          observation: 'A perfectly fine 20-character observation.',
          question: 'What stood out? And why?',
        },
      });
    }

    const result = await generateWeeklyObservation(makeMinimalPromptInput());

    expect(result.isFallback).toBe(true);
    expect(result.observation).toBe('Reflecting on this week.');
    expect(result.question).toBe('What stood out to you about this week?');
    // 3 attempts × 1 call (Stage-1 throws before Haiku) = 3 total
    expect(mockAnthropicParse).toHaveBeenCalledTimes(3);
    // Fallback log emitted exactly once
    const fallbackLogCalls = mockLoggerWarn.mock.calls.filter(
      (c) => c[1] === 'chris.weekly-review.fallback-fired',
    );
    expect(fallbackLogCalls).toHaveLength(1);
  });

  it('Test 4: Stage-1 OK + Stage-2 Haiku reports count=2 → MultiQuestionError → retry', async () => {
    // First attempt: Sonnet OK (passes Stage-1) but Haiku judge says count=2
    mockSonnetSuccess();
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: { question_count: 2, questions: ['x?', 'y?'] },
    });
    // Second attempt: full success
    mockSonnetSuccess();
    mockStage2Success();
    mockDateGroundingSuccess();

    const result = await generateWeeklyObservation(makeMinimalPromptInput());

    expect(result.isFallback).toBe(false);
    // Attempt 1: 2 calls (Sonnet + Haiku). Attempt 2: 3 calls. Total 5.
    expect(mockAnthropicParse).toHaveBeenCalledTimes(5);
  });

  it('Test 5: Stage-1 + Stage-2 OK + date-grounding fails → DateOutOfWindowError → retry', async () => {
    // First attempt: Sonnet OK + Haiku judge OK + date-grounding FAILS
    mockSonnetSuccess();
    mockStage2Success();
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: {
        references_outside_window: true,
        dates_referenced: ['2025-01-01'],
      },
    });
    // Second attempt: full success
    mockSonnetSuccess();
    mockStage2Success();
    mockDateGroundingSuccess();

    const result = await generateWeeklyObservation(makeMinimalPromptInput());

    expect(result.isFallback).toBe(false);
    // Attempt 1: 3 calls. Attempt 2: 3 calls. Total 6.
    expect(mockAnthropicParse).toHaveBeenCalledTimes(6);
  });

  it('Test 6: MAX_RETRIES = 2 (verbatim constant)', () => {
    expect(MAX_RETRIES).toBe(2);
  });
});

// ── describe(templated fallback) ───────────────────────────────────────────

describe('templated fallback (W-4 / WEEK-06 — English-only v1 baseline)', () => {
  beforeEach(() => {
    mockAnthropicParse.mockReset();
    mockLoggerWarn.mockReset();
  });

  it("templated fallback question text is exactly 'What stood out to you about this week?'", async () => {
    // Force fallback by failing all 3 attempts
    for (let i = 0; i < 3; i++) {
      mockAnthropicParse.mockResolvedValueOnce({
        parsed_output: {
          observation: 'A perfectly fine 20-character observation.',
          question: 'What stood out? And why?',
        },
      });
    }

    const result = await generateWeeklyObservation(makeMinimalPromptInput());

    expect(result.question).toBe('What stood out to you about this week?');
    expect(result.isFallback).toBe(true);
  });

  it('chris.weekly-review.fallback-fired emitted on retry-cap exhaustion (WEEK-06)', async () => {
    for (let i = 0; i < 3; i++) {
      mockAnthropicParse.mockResolvedValueOnce({
        parsed_output: {
          observation: 'A perfectly fine 20-character observation.',
          question: 'What stood out? And why?',
        },
      });
    }

    await generateWeeklyObservation(makeMinimalPromptInput());

    const matchingLogs = mockLoggerWarn.mock.calls.filter(
      (c) => c[1] === 'chris.weekly-review.fallback-fired',
    );
    expect(matchingLogs).toHaveLength(1);
    expect(matchingLogs[0]![0]).toMatchObject({ attempts: 3 });
  });
});
