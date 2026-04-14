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

// ── Mock hybridSearch + PSYCHOLOGY_SEARCH_OPTIONS ──────────────────────────
const mockHybridSearch = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  PSYCHOLOGY_SEARCH_OPTIONS: {
    recencyBias: 0.2,
    limit: 15,
    tags: ['EMOTION', 'FEAR', 'BELIEF', 'DREAM'],
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
const { handlePsychology } = await import('../modes/psychology.js');
const { LLMError } = await import('../../utils/errors.js');
const { PSYCHOLOGY_SYSTEM_PROMPT } = await import('../../llm/prompts.js');
const { PSYCHOLOGY_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');
const { buildSystemPrompt: realBuildSystemPrompt } = await import('../personality.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'Why do I always self-sabotage when things are going well?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I feel terrified when good things happen — like I\'m waiting for the other shoe to drop',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'EMOTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.91,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'I had a dream where I was climbing a mountain and kept letting go of the rope on purpose',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'DREAM',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.76,
  },
];

const MOCK_RELATIONAL_MEMORIES = [
  {
    id: 'rel-1',
    type: 'PATTERN',
    content: 'John reports anxiety spikes immediately after positive events or achievements',
    confidence: 0.88,
    createdAt: new Date('2025-03-01'),
  },
  {
    id: 'rel-2',
    type: 'INSIGHT',
    content: 'Self-sabotage pattern may be linked to early experiences where success was followed by loss',
    confidence: 0.72,
    createdAt: new Date('2025-03-05'),
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PSYCHOLOGY_SYSTEM_PROMPT', () => {
  it('has {pensieveContext} placeholder', () => {
    expect(PSYCHOLOGY_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });

  it('has {relationalContext} placeholder', () => {
    expect(PSYCHOLOGY_SYSTEM_PROMPT).toContain('{relationalContext}');
  });
});

describe('buildSystemPrompt interpolates for PSYCHOLOGY', () => {
  it('replaces {pensieveContext} and {relationalContext} placeholders', () => {
    const result = PSYCHOLOGY_SYSTEM_PROMPT
      .replace('{pensieveContext}', 'some pensieve data')
      .replace('{relationalContext}', 'some relational data');

    expect(result).toContain('some pensieve data');
    expect(result).toContain('some relational data');
    expect(result).not.toContain('{pensieveContext}');
    expect(result).not.toContain('{relationalContext}');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handlePsychology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockGetRelationalMemories.mockResolvedValue(MOCK_RELATIONAL_MEMORIES);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | EMOTION | 0.91) "I feel terrified when good things happen — like I\'m waiting for the other shoe to drop"\n' +
        '[2] (2025-02-10 | DREAM | 0.76) "I had a dream where I was climbing a mountain and kept letting go of the rope on purpose"',
    );
    mockBuildRelationalContext.mockReturnValue(
      '[1] (2025-03-01 | PATTERN | 0.88) "John reports anxiety spikes immediately after positive events or achievements"\n' +
        '[2] (2025-03-05 | INSIGHT | 0.72) "Self-sabotage pattern may be linked to early experiences where success was followed by loss"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated psychology system prompt');
    mockCreate.mockResolvedValue(
      makeLLMResponse('This pattern of self-sabotage when things go well looks like a classic fear of success rooted in anxious attachment...'),
    );
  });

  it('calls hybridSearch with the user text and PSYCHOLOGY_SEARCH_OPTIONS', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockHybridSearch).toHaveBeenCalledWith(TEST_QUERY, PSYCHOLOGY_SEARCH_OPTIONS);
  });

  it('calls getRelationalMemories with { limit: 20 }', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockGetRelationalMemories).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes search results to buildPensieveContext', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('passes relational memories to buildRelationalContext', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockBuildRelationalContext).toHaveBeenCalledWith(MOCK_RELATIONAL_MEMORIES);
  });

  it('builds system prompt with PSYCHOLOGY mode, pensieve context, and relational context', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'PSYCHOLOGY',
      expect.any(String),
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it('calls Opus with max_tokens 2500, system prompt, history + current message', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        max_tokens: 2500,
        system: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'interpolated psychology system prompt',
          }),
        ]),
        messages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: TEST_QUERY },
        ],
      }),
    );
  });

  it('returns Opus response text', async () => {
    const result = await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(result).toBe('This pattern of self-sabotage when things go well looks like a classic fear of success rooted in anxious attachment...');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough of your history to do a meaningful psychological analysis on this yet."),
    );

    const result = await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(result).toBe("I don't have enough of your history to do a meaningful psychological analysis on this yet.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.psychology.empty when search results are empty', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough of your history yet."),
    );

    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.psychology.empty',
    );
  });

  it('handles empty relational memories gracefully', async () => {
    mockGetRelationalMemories.mockResolvedValue([]);
    mockBuildRelationalContext.mockReturnValue('No observations accumulated yet.');

    const result = await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(result).toBe('This pattern of self-sabotage when things go well looks like a classic fear of success rooted in anxious attachment...');
    expect(mockBuildRelationalContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.psychology.response on success with chatId, resultCount, relationalCount, latencyMs', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        relationalCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.psychology.response',
    );
  });

  it('logs chris.psychology.error on Opus failure', async () => {
    mockCreate.mockRejectedValue(new Error('Opus unavailable'));

    await expect(handlePsychology(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Opus unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.psychology.error',
    );
  });

  it('throws LLMError on Opus failure', async () => {
    mockCreate.mockRejectedValue(new Error('Opus unavailable'));

    await expect(handlePsychology(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handlePsychology(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handlePsychology(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Opus response');
    }
  });
});
