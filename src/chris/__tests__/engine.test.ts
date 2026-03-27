import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db (needed by store.ts and conversation.ts) ───────────────────────
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

// Select chain for conversation.ts (select→from→where→orderBy→limit)
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogDebug = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: vi.fn(),
    debug: mockLogDebug,
  },
}));

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  HAIKU_MODEL: 'claude-3-5-haiku-20241022',
  SONNET_MODEL: 'claude-sonnet-4-20250514',
}));

// ── Mock pensieve store ────────────────────────────────────────────────────
const mockStorePensieveEntry = vi.fn();
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: mockStorePensieveEntry,
}));

// ── Mock tagger (fire-and-forget) ──────────────────────────────────────────
const mockTagEntry = vi.fn();
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: mockTagEntry,
}));

// ── Mock embeddings (fire-and-forget) ──────────────────────────────────────
const mockEmbedAndStore = vi.fn();
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: mockEmbedAndStore,
}));

// ── Mock conversation ──────────────────────────────────────────────────────
const mockSaveMessage = vi.fn();
vi.mock('../../memory/conversation.js', () => ({
  saveMessage: mockSaveMessage,
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildMessageHistory = vi.fn();
const mockBuildPensieveContext = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: mockBuildPensieveContext,
}));

// ── Mock searchPensieve (needed by interrogate handler) ────────────────────
const mockSearchPensieve = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  searchPensieve: mockSearchPensieve,
}));

// ── Mock handleInterrogate (to verify engine routing) ──────────────────────
const mockHandleInterrogate = vi.fn();
vi.mock('../modes/interrogate.js', () => ({
  handleInterrogate: mockHandleInterrogate,
}));

// ── Import modules under test after mocks ──────────────────────────────────
const { detectMode, processMessage } = await import('../engine.js');
const { handleJournal } = await import('../modes/journal.js');
const { buildSystemPrompt } = await import('../personality.js');
const { JOURNAL_SYSTEM_PROMPT, MODE_DETECTION_PROMPT } = await import(
  '../../llm/prompts.js'
);
const { LLMError } = await import('../../utils/errors.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const USER_ID = 42;
const TEST_TEXT = 'Had the most amazing conversation with an old friend today';
const ENTRY_ID = 'entry-uuid-001';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('System Prompts', () => {
  it('JOURNAL_SYSTEM_PROMPT enforces no storage confirmation (R005)', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toMatch(/never.*confirm.*stor/i);
  });

  it('JOURNAL_SYSTEM_PROMPT enforces no hallucination (R011)', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toMatch(/never.*state.*fact/i);
  });

  it('JOURNAL_SYSTEM_PROMPT mentions enriching follow-up questions', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toMatch(/follow-up/i);
  });

  it('MODE_DETECTION_PROMPT instructs JOURNAL default for ambiguous', () => {
    expect(MODE_DETECTION_PROMPT).toMatch(/default.*journal/i);
  });
});

describe('buildSystemPrompt', () => {
  it('returns JOURNAL_SYSTEM_PROMPT for JOURNAL mode', () => {
    expect(buildSystemPrompt('JOURNAL')).toBe(JOURNAL_SYSTEM_PROMPT);
  });

  it('returns a string for INTERROGATE mode (placeholder)', () => {
    const result = buildSystemPrompt('INTERROGATE');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('detectMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies JOURNAL messages', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));

    const mode = await detectMode(TEST_TEXT);

    expect(mode).toBe('JOURNAL');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3-5-haiku-20241022',
        system: MODE_DETECTION_PROMPT,
      }),
    );
  });

  it('classifies INTERROGATE messages', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "INTERROGATE"}'));

    const mode = await detectMode('Have I ever talked about my childhood?');

    expect(mode).toBe('INTERROGATE');
  });

  it('defaults to JOURNAL on parse failure', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('not json'));

    const mode = await detectMode(TEST_TEXT);

    expect(mode).toBe('JOURNAL');
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
      'chris.mode.detect',
    );
  });

  it('defaults to JOURNAL on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    const mode = await detectMode(TEST_TEXT);

    expect(mode).toBe('JOURNAL');
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'API timeout' }),
      'chris.mode.detect',
    );
  });

  it('defaults to JOURNAL on unknown mode value', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "UNKNOWN"}'));

    const mode = await detectMode(TEST_TEXT);

    expect(mode).toBe('JOURNAL');
  });

  it('logs mode and latencyMs on success', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));

    await detectMode(TEST_TEXT);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'JOURNAL', latencyMs: expect.any(Number) }),
      'chris.mode.detect',
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleJournal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorePensieveEntry.mockResolvedValue({ id: ENTRY_ID, content: TEST_TEXT });
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous message' },
      { role: 'assistant', content: 'previous response' },
    ]);
    mockTagEntry.mockResolvedValue('EXPERIENCE');
    mockEmbedAndStore.mockResolvedValue(undefined);
  });

  it('stores entry via storePensieveEntry', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse("That sounds wonderful — what made the conversation stand out?"),
    );

    await handleJournal(CHAT_ID, TEST_TEXT);

    expect(mockStorePensieveEntry).toHaveBeenCalledWith(TEST_TEXT, 'telegram', {
      telegramChatId: Number(CHAT_ID),
    });
  });

  it('fires tagEntry and embedAndStore without awaiting', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('Great to hear.'));

    await handleJournal(CHAT_ID, TEST_TEXT);

    // Both should be called (fire-and-forget)
    expect(mockTagEntry).toHaveBeenCalledWith(ENTRY_ID, TEST_TEXT);
    expect(mockEmbedAndStore).toHaveBeenCalledWith(ENTRY_ID, TEST_TEXT);
  });

  it('calls Sonnet with conversation history and current message', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('Sounds great.'));

    await handleJournal(CHAT_ID, TEST_TEXT);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        system: expect.any(String),
        messages: [
          { role: 'user', content: 'previous message' },
          { role: 'assistant', content: 'previous response' },
          { role: 'user', content: TEST_TEXT },
        ],
      }),
    );
  });

  it('returns the assistant response text', async () => {
    const expectedResponse = "That sounds like a meaningful reconnection.";
    mockCreate.mockResolvedValueOnce(makeLLMResponse(expectedResponse));

    const result = await handleJournal(CHAT_ID, TEST_TEXT);

    expect(result).toBe(expectedResponse);
  });

  it('logs chris.journal.response on success', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('Nice.'));

    await handleJournal(CHAT_ID, TEST_TEXT);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: ENTRY_ID,
        chatId: CHAT_ID.toString(),
        latencyMs: expect.any(Number),
      }),
      'chris.journal.response',
    );
  });

  it('throws LLMError on Sonnet failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Sonnet unavailable'));

    await expect(handleJournal(CHAT_ID, TEST_TEXT)).rejects.toThrow(LLMError);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Sonnet unavailable',
      }),
      'chris.journal.error',
    );
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });

    await expect(handleJournal(CHAT_ID, TEST_TEXT)).rejects.toThrow(LLMError);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('processMessage (engine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mode detection → JOURNAL
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    // Sonnet response
    mockCreate.mockResolvedValueOnce(makeLLMResponse("That's a lovely memory."));

    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockStorePensieveEntry.mockResolvedValue({ id: ENTRY_ID, content: TEST_TEXT });
    mockBuildMessageHistory.mockResolvedValue([]);
    mockTagEntry.mockResolvedValue(null);
    mockEmbedAndStore.mockResolvedValue(undefined);
  });

  it('detects mode, routes to journal, and returns response', async () => {
    const response = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(response).toBe("That's a lovely memory.");
  });

  it('saves user message to conversation history', async () => {
    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(mockSaveMessage).toHaveBeenCalledWith(CHAT_ID, 'USER', TEST_TEXT, 'JOURNAL');
  });

  it('saves assistant response to conversation history', async () => {
    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'ASSISTANT',
      "That's a lovely memory.",
      'JOURNAL',
    );
  });

  it('saves both user and assistant messages (R013)', async () => {
    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    // Two calls: one USER, one ASSISTANT
    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    expect(mockSaveMessage.mock.calls[0][1]).toBe('USER');
    expect(mockSaveMessage.mock.calls[1][1]).toBe('ASSISTANT');
  });

  it('logs chris.engine.process on success', async () => {
    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'JOURNAL',
        chatId: CHAT_ID.toString(),
        latencyMs: expect.any(Number),
      }),
      'chris.engine.process',
    );
  });

  it('logs chris.engine.error and rethrows on failure', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();

    // Mode detection succeeds
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    // storePensieveEntry fails
    mockStorePensieveEntry.mockRejectedValueOnce(new Error('DB down'));

    await expect(processMessage(CHAT_ID, USER_ID, TEST_TEXT)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: expect.any(String),
      }),
      'chris.engine.error',
    );
  });

  it('wraps non-LLMError failures in LLMError', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockStorePensieveEntry.mockRejectedValueOnce(new Error('random error'));

    await expect(processMessage(CHAT_ID, USER_ID, TEST_TEXT)).rejects.toThrow(LLMError);
  });

  it('routes INTERROGATE to handleInterrogate', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();
    mockBuildMessageHistory.mockReset();
    mockTagEntry.mockReset();
    mockEmbedAndStore.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockHandleInterrogate.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "INTERROGATE"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleInterrogate.mockResolvedValue("You mentioned growing up by the coast.");

    const response = await processMessage(
      CHAT_ID,
      USER_ID,
      'Have I ever talked about my childhood?',
    );

    expect(response).toBe("You mentioned growing up by the coast.");
    expect(mockHandleInterrogate).toHaveBeenCalledWith(
      CHAT_ID,
      'Have I ever talked about my childhood?',
    );
    // Mode is saved as INTERROGATE
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'USER',
      'Have I ever talked about my childhood?',
      'INTERROGATE',
    );
  });

  it('INTERROGATE mode does NOT call storePensieveEntry', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();
    mockHandleInterrogate.mockReset();
    mockLogInfo.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "INTERROGATE"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleInterrogate.mockResolvedValue("I don't have memories about that.");

    await processMessage(CHAT_ID, USER_ID, 'What did I say about work?');

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
    expect(mockTagEntry).not.toHaveBeenCalled();
    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });
});
