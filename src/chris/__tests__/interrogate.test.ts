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

// ── Mock searchPensieve ────────────────────────────────────────────────────
const mockSearchPensieve = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  searchPensieve: mockSearchPensieve,
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildMessageHistory = vi.fn();
const mockBuildPensieveContext = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: mockBuildPensieveContext,
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
const { handleInterrogate } = await import('../modes/interrogate.js');
const { LLMError } = await import('../../utils/errors.js');
const { INTERROGATE_SYSTEM_PROMPT } = await import('../../llm/prompts.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'Have I ever talked about my childhood?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I grew up in a small town near the coast',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'EXPERIENCE',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.87,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'My parents always encouraged me to read',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'REFLECTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.72,
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('INTERROGATE_SYSTEM_PROMPT', () => {
  it('enforces citation/provenance instructions (R006)', () => {
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/cite/i);
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/date/i);
  });

  it('enforces no-fabrication instruction (R011)', () => {
    // The prompt contains "Do NOT guess or fabricate" and "NEVER invent details"
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/fabricat/i);
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/never.*invent/i);
  });

  it('enforces uncertainty flagging instruction (R011)', () => {
    // The prompt instructs to flag uncertainty when only weak matches exist
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/uncertain/i);
  });

  it('instructs honest empty-state response', () => {
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/don't have any memories/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleInterrogate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchPensieve.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | EXPERIENCE | 0.87) "I grew up in a small town near the coast"\n' +
        '[2] (2025-02-10 | REFLECTION | 0.72) "My parents always encouraged me to read"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated system prompt');
    mockCreate.mockResolvedValue(
      makeLLMResponse('Yes, you mentioned growing up near the coast.'),
    );
  });

  it('calls searchPensieve with correct query and limit', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockSearchPensieve).toHaveBeenCalledWith(TEST_QUERY, 10);
  });

  it('passes search results to buildPensieveContext', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('builds system prompt with INTERROGATE mode and context', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'INTERROGATE',
      expect.any(String),
    );
  });

  it('calls Sonnet with system prompt, history, and current message', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        system: 'interpolated system prompt',
        messages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: TEST_QUERY },
        ],
      }),
    );
  });

  it('returns Sonnet response text', async () => {
    const result = await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(result).toBe('Yes, you mentioned growing up near the coast.');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockSearchPensieve.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have any memories about that."),
    );

    const result = await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(result).toBe("I don't have any memories about that.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.interrogate.empty when no results pass threshold', async () => {
    mockSearchPensieve.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have any memories about that."),
    );

    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.interrogate.empty',
    );
  });

  it('logs chris.interrogate.response on success with chatId, resultCount, latencyMs', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.interrogate.response',
    );
  });

  it('logs chris.interrogate.error on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleInterrogate(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Sonnet unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.interrogate.error',
    );
  });

  it('throws LLMError on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleInterrogate(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handleInterrogate(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handleInterrogate(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Sonnet response');
    }
  });
});
