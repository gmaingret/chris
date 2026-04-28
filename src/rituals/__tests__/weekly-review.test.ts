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
 * NO vi.useFakeTimers — TESTING.md D-02 forbids; the codebase uses real
 * Date and lets tests assert on relative bounds rather than wall-clock pinning.
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
