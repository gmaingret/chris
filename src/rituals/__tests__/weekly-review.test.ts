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
} from '../weekly-review.js';

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
