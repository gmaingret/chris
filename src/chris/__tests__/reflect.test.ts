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
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

// ── Mock hybridSearch + REFLECT_SEARCH_OPTIONS ─────────────────────────────
const mockHybridSearch = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  REFLECT_SEARCH_OPTIONS: {
    recencyBias: 0.1,
    limit: 15,
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
const { handleReflect } = await import('../modes/reflect.js');
const { LLMError } = await import('../../utils/errors.js');
const { REFLECT_SYSTEM_PROMPT } = await import('../../llm/prompts.js');
const { REFLECT_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'What are my recurring fears?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I keep worrying about whether I am good enough',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'REFLECTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.87,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'That fear of rejection came up again today',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'EXPERIENCE',
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
    content: 'John frequently mentions self-doubt around professional performance',
    confidence: 0.85,
    createdAt: new Date('2025-03-01'),
  },
  {
    id: 'rel-2',
    type: 'OBSERVATION',
    content: 'Rejection sensitivity appears across multiple conversations',
    confidence: 0.78,
    createdAt: new Date('2025-03-05'),
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('REFLECT_SYSTEM_PROMPT', () => {
  it('has {relationalContext} placeholder', () => {
    expect(REFLECT_SYSTEM_PROMPT).toContain('{relationalContext}');
  });

  it('enforces citation/provenance instructions', () => {
    expect(REFLECT_SYSTEM_PROMPT).toMatch(/cite|date/i);
    expect(REFLECT_SYSTEM_PROMPT).toMatch(/ground/i);
  });

  it('enforces no-fabrication instruction', () => {
    expect(REFLECT_SYSTEM_PROMPT).toMatch(/never.*invent/i);
  });

  it('has {pensieveContext} placeholder', () => {
    expect(REFLECT_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleReflect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockGetRelationalMemories.mockResolvedValue(MOCK_RELATIONAL_MEMORIES);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | REFLECTION | 0.87) "I keep worrying about whether I am good enough"\n' +
        '[2] (2025-02-10 | EXPERIENCE | 0.72) "That fear of rejection came up again today"',
    );
    mockBuildRelationalContext.mockReturnValue(
      '[1] (2025-03-01 | PATTERN | 0.85) "John frequently mentions self-doubt around professional performance"\n' +
        '[2] (2025-03-05 | OBSERVATION | 0.78) "Rejection sensitivity appears across multiple conversations"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated reflect system prompt');
    mockCreate.mockResolvedValue(
      makeLLMResponse('I notice a recurring theme of self-doubt in your entries.'),
    );
  });

  it('calls hybridSearch with the user text and REFLECT_SEARCH_OPTIONS', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockHybridSearch).toHaveBeenCalledWith(TEST_QUERY, REFLECT_SEARCH_OPTIONS);
  });

  it('calls getRelationalMemories with { limit: 20 }', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockGetRelationalMemories).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes search results to buildPensieveContext', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('passes relational memories to buildRelationalContext', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockBuildRelationalContext).toHaveBeenCalledWith(MOCK_RELATIONAL_MEMORIES);
  });

  it('builds system prompt with REFLECT mode, pensieve context, and relational context', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'REFLECT',
      expect.any(String),
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it('calls Sonnet with max_tokens 1500, system prompt, history + current message', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: 'interpolated reflect system prompt',
        messages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: TEST_QUERY },
        ],
      }),
    );
  });

  it('returns Sonnet response text', async () => {
    const result = await handleReflect(CHAT_ID, TEST_QUERY);

    expect(result).toBe('I notice a recurring theme of self-doubt in your entries.');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough conversations to spot patterns yet."),
    );

    const result = await handleReflect(CHAT_ID, TEST_QUERY);

    expect(result).toBe("I don't have enough conversations to spot patterns yet.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('handles empty relational memories gracefully', async () => {
    mockGetRelationalMemories.mockResolvedValue([]);
    mockBuildRelationalContext.mockReturnValue('No observations accumulated yet.');

    const result = await handleReflect(CHAT_ID, TEST_QUERY);

    expect(result).toBe('I notice a recurring theme of self-doubt in your entries.');
    expect(mockBuildRelationalContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.reflect.empty when no results pass threshold', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough conversations to spot patterns yet."),
    );

    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.reflect.empty',
    );
  });

  it('logs chris.reflect.response on success with chatId, resultCount, relationalCount, latencyMs', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        relationalCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.reflect.response',
    );
  });

  it('logs chris.reflect.error on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleReflect(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Sonnet unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.reflect.error',
    );
  });

  it('throws LLMError on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleReflect(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handleReflect(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handleReflect(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Sonnet response');
    }
  });
});
