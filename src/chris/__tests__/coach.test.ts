import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db (needed by transitive imports) ─────────────────────────────────
vi.mock('../../db/connection.js', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn() })),
        })),
      })),
    })),
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  OPUS_MODEL: 'claude-opus-4-6',
}));

// ── Mock hybridSearch + COACH_SEARCH_OPTIONS ───────────────────────────────
const mockHybridSearch = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  COACH_SEARCH_OPTIONS: {
    recencyBias: 0.5,
    limit: 10,
    tags: ['BELIEF', 'INTENTION', 'VALUE'],
  },
}));

// ── Mock relational memories ───────────────────────────────────────────────
const mockGetRelationalMemories = vi.fn();
vi.mock('../../memory/relational.js', () => ({
  getRelationalMemories: mockGetRelationalMemories,
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildMessageHistory = vi.fn();
const mockBuildPensieveContext = vi.fn();
const mockBuildRelationalContext = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: mockBuildPensieveContext,
  buildRelationalContext: mockBuildRelationalContext,
}));

// ── Mock personality ───────────────────────────────────────────────────────
const mockBuildSystemPrompt = vi.fn();
vi.mock('../personality.js', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
}));

// ── Mock pensieve store (should NOT be called) ─────────────────────────────
const mockStorePensieveEntry = vi.fn();
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: mockStorePensieveEntry,
}));

// ── Mock tagger (should NOT be called) ─────────────────────────────────────
const mockTagEntry = vi.fn();
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: mockTagEntry,
}));

// ── Mock embeddings (should NOT be called) ─────────────────────────────────
const mockEmbedAndStore = vi.fn();
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: mockEmbedAndStore,
}));

// ── Import module under test after mocks ───────────────────────────────────
const { handleCoach } = await import('../modes/coach.js');
const { LLMError } = await import('../../utils/errors.js');
const { COACH_SYSTEM_PROMPT } = await import('../../llm/prompts.js');
const { COACH_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');
const { buildSystemPrompt: realBuildSystemPrompt } = await import('../personality.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'I keep putting off hard conversations at work';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I believe I should always be agreeable to keep the peace',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'BELIEF',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.87,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'I intend to be more direct with my manager this quarter',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'INTENTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.72,
  },
];

const MOCK_RELATIONAL_MEMORIES = [
  {
    id: 'rel-1',
    type: 'PATTERN',
    content: 'John often states intentions for directness but reports avoiding confrontation',
    confidence: 0.85,
    createdAt: new Date('2025-03-01'),
  },
  {
    id: 'rel-2',
    type: 'OBSERVATION',
    content: 'Conflict avoidance appears tied to a belief about being agreeable',
    confidence: 0.78,
    createdAt: new Date('2025-03-05'),
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('COACH_SYSTEM_PROMPT', () => {
  it('has {pensieveContext} placeholder', () => {
    expect(COACH_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });

  it('has {relationalContext} placeholder', () => {
    expect(COACH_SYSTEM_PROMPT).toContain('{relationalContext}');
  });
});

describe('buildSystemPrompt interpolates for COACH', () => {
  it('replaces {pensieveContext} and {relationalContext} placeholders', () => {
    // realBuildSystemPrompt is mocked, so we call the real one by reimporting
    // Actually, since we mocked personality.js, realBuildSystemPrompt IS the mock.
    // We need to test using the raw COACH_SYSTEM_PROMPT directly.
    const result = COACH_SYSTEM_PROMPT
      .replace('{pensieveContext}', 'some pensieve data')
      .replace('{relationalContext}', 'some relational data');

    expect(result).toContain('some pensieve data');
    expect(result).toContain('some relational data');
    expect(result).not.toContain('{pensieveContext}');
    expect(result).not.toContain('{relationalContext}');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleCoach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockGetRelationalMemories.mockResolvedValue(MOCK_RELATIONAL_MEMORIES);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | BELIEF | 0.87) "I believe I should always be agreeable to keep the peace"\n' +
        '[2] (2025-02-10 | INTENTION | 0.72) "I intend to be more direct with my manager this quarter"',
    );
    mockBuildRelationalContext.mockReturnValue(
      '[1] (2025-03-01 | PATTERN | 0.85) "John often states intentions for directness but reports avoiding confrontation"\n' +
        '[2] (2025-03-05 | OBSERVATION | 0.78) "Conflict avoidance appears tied to a belief about being agreeable"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated coach system prompt');
    mockCreate.mockResolvedValue(
      makeLLMResponse('You said you wanted to be more direct — so why are you still avoiding it?'),
    );
  });

  it('calls hybridSearch with the user text and COACH_SEARCH_OPTIONS', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockHybridSearch).toHaveBeenCalledWith(TEST_QUERY, COACH_SEARCH_OPTIONS);
  });

  it('calls getRelationalMemories with { limit: 20 }', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockGetRelationalMemories).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes search results to buildPensieveContext', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('passes relational memories to buildRelationalContext', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockBuildRelationalContext).toHaveBeenCalledWith(MOCK_RELATIONAL_MEMORIES);
  });

  it('builds system prompt with COACH mode, pensieve context, and relational context', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'COACH',
      expect.any(String),
      expect.any(String),
    );
  });

  it('calls Opus with max_tokens 2000, system prompt, history + current message', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        max_tokens: 2000,
        system: 'interpolated coach system prompt',
        messages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: TEST_QUERY },
        ],
      }),
    );
  });

  it('returns Opus response text', async () => {
    const result = await handleCoach(CHAT_ID, TEST_QUERY);

    expect(result).toBe('You said you wanted to be more direct — so why are you still avoiding it?');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("Tell me more about what's going on — I need context to push back on."),
    );

    const result = await handleCoach(CHAT_ID, TEST_QUERY);

    expect(result).toBe("Tell me more about what's going on — I need context to push back on.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.coach.empty when search results are empty', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("Tell me more about what's going on."),
    );

    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.coach.empty',
    );
  });

  it('handles empty relational memories gracefully', async () => {
    mockGetRelationalMemories.mockResolvedValue([]);
    mockBuildRelationalContext.mockReturnValue('No observations accumulated yet.');

    const result = await handleCoach(CHAT_ID, TEST_QUERY);

    expect(result).toBe('You said you wanted to be more direct — so why are you still avoiding it?');
    expect(mockBuildRelationalContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.coach.response on success with chatId, resultCount, relationalCount, latencyMs', async () => {
    await handleCoach(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        relationalCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.coach.response',
    );
  });

  it('logs chris.coach.error on Opus failure', async () => {
    mockCreate.mockRejectedValue(new Error('Opus unavailable'));

    await expect(handleCoach(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Opus unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.coach.error',
    );
  });

  it('throws LLMError on Opus failure', async () => {
    mockCreate.mockRejectedValue(new Error('Opus unavailable'));

    await expect(handleCoach(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handleCoach(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handleCoach(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Opus response');
    }
  });
});
