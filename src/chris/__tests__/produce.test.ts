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
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

// ── Mock hybridSearch + PRODUCE_SEARCH_OPTIONS ─────────────────────────────
const mockHybridSearch = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  PRODUCE_SEARCH_OPTIONS: {
    recencyBias: 0.3,
    limit: 10,
  },
}));

// ── Mock relational memories (for negative assertion) ──────────────────────
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
const { handleProduce } = await import('../modes/produce.js');
const { LLMError } = await import('../../utils/errors.js');
const { PRODUCE_SYSTEM_PROMPT } = await import('../../llm/prompts.js');
const { PRODUCE_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'Should I take the new job offer or stay where I am?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I value stability but also want career growth',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'VALUE',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.85,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'I intend to prioritize financial security this year',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'INTENTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.71,
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PRODUCE_SYSTEM_PROMPT', () => {
  it('has {pensieveContext} placeholder', () => {
    expect(PRODUCE_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });

  it('does NOT have {relationalContext} placeholder', () => {
    expect(PRODUCE_SYSTEM_PROMPT).not.toContain('{relationalContext}');
  });
});

describe('buildSystemPrompt interpolates for PRODUCE', () => {
  it('replaces {pensieveContext} placeholder', () => {
    const result = PRODUCE_SYSTEM_PROMPT.replace('{pensieveContext}', 'some pensieve data');

    expect(result).toContain('some pensieve data');
    expect(result).not.toContain('{pensieveContext}');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleProduce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | VALUE | 0.85) "I value stability but also want career growth"\n' +
        '[2] (2025-02-10 | INTENTION | 0.71) "I intend to prioritize financial security this year"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated produce system prompt');
    mockCreate.mockResolvedValue(
      makeLLMResponse("Let's think through the trade-offs — what matters most to you about this decision?"),
    );
  });

  it('calls hybridSearch with the user text and PRODUCE_SEARCH_OPTIONS', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockHybridSearch).toHaveBeenCalledWith(TEST_QUERY, PRODUCE_SEARCH_OPTIONS);
  });

  it('passes search results to buildPensieveContext', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('builds system prompt with PRODUCE mode and pensieve context (two args only)', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'PRODUCE',
      expect.any(String),
    );
    // Verify exactly 2 arguments (no relational context)
    expect(mockBuildSystemPrompt.mock.calls[0]).toHaveLength(2);
  });

  it('calls Sonnet with max_tokens 1500, system prompt, history + current message', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: 'interpolated produce system prompt',
        messages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: TEST_QUERY },
        ],
      }),
    );
  });

  it('returns Sonnet response text', async () => {
    const result = await handleProduce(CHAT_ID, TEST_QUERY);

    expect(result).toBe("Let's think through the trade-offs — what matters most to you about this decision?");
  });

  it('does NOT call storePensieveEntry', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('does NOT call getRelationalMemories', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockGetRelationalMemories).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("Tell me more about what you're weighing — I can help you think it through."),
    );

    const result = await handleProduce(CHAT_ID, TEST_QUERY);

    expect(result).toBe("Tell me more about what you're weighing — I can help you think it through.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.produce.empty when search results are empty', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("Tell me more about this decision."),
    );

    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.produce.empty',
    );
  });

  it('logs chris.produce.response on success with chatId, resultCount, latencyMs', async () => {
    await handleProduce(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.produce.response',
    );
  });

  it('logs chris.produce.error on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleProduce(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Sonnet unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.produce.error',
    );
  });

  it('throws LLMError on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleProduce(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handleProduce(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handleProduce(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Sonnet response');
    }
  });
});
