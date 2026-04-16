import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db (needed by store.ts and conversation.ts) ───────────────────────
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

// Select chain for conversation.ts (select→from→where→orderBy→limit)
// Also supports decisions/capture-state.ts (select→from→where→limit)
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

// ── Mock config (needed by engine.ts for proactive settings) ───────────────
vi.mock('../../config.js', () => ({
  config: {
    anthropicApiKey: 'test-key',
    telegramBotToken: 'test-token',
    telegramAuthorizedUserId: 123456,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    proactiveTimezone: 'Europe/Paris',
  },
}));

// ── Mock proactive modules (K012) ──────────────────────────────────────────
const mockDetectMuteIntent = vi.fn();
const mockGenerateMuteAcknowledgment = vi.fn();
vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: mockDetectMuteIntent,
  generateMuteAcknowledgment: mockGenerateMuteAcknowledgment,
}));

const mockSetMuteUntil = vi.fn();
vi.mock('../../proactive/state.js', () => ({
  setMuteUntil: mockSetMuteUntil,
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
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  SONNET_MODEL: 'claude-sonnet-4-6',
  OPUS_MODEL: 'claude-opus-4-6',
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

// ── Mock relational memory writer (fire-and-forget) ────────────────────────
const mockWriteRelationalMemory = vi.fn();
vi.mock('../../memory/relational.js', () => ({
  writeRelationalMemory: mockWriteRelationalMemory,
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
const mockHybridSearch = vi.fn().mockResolvedValue([]);
vi.mock('../../pensieve/retrieve.js', () => ({
  searchPensieve: mockSearchPensieve,
  hybridSearch: mockHybridSearch,
  JOURNAL_SEARCH_OPTIONS: { tags: ['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE'], recencyBias: 0.3, limit: 10 },
}));

// ── Mock contradiction detector ────────────────────────────────────────────
const mockDetectContradictions = vi.fn();
vi.mock('../contradiction.js', () => ({
  detectContradictions: mockDetectContradictions,
}));

// ── Mock praise quarantine (SYCO-04/05) ───────────────────────────────────
const mockQuarantinePraise = vi.fn();
vi.mock('../praise-quarantine.js', () => ({
  quarantinePraise: mockQuarantinePraise,
}));

// ── Mock handleInterrogate (to verify engine routing) ──────────────────────
const mockHandleInterrogate = vi.fn();
vi.mock('../modes/interrogate.js', () => ({
  handleInterrogate: mockHandleInterrogate,
}));

// ── Mock 4 new mode handlers (to verify engine routing) ────────────────────
const mockHandleReflect = vi.fn();
vi.mock('../modes/reflect.js', () => ({
  handleReflect: mockHandleReflect,
}));

const mockHandleCoach = vi.fn();
vi.mock('../modes/coach.js', () => ({
  handleCoach: mockHandleCoach,
}));

const mockHandlePsychology = vi.fn();
vi.mock('../modes/psychology.js', () => ({
  handlePsychology: mockHandlePsychology,
}));

const mockHandleProduce = vi.fn();
vi.mock('../modes/produce.js', () => ({
  handleProduce: mockHandleProduce,
}));

// ── Mock decision capture/trigger modules (Phase 14 PP#0/PP#1) ────────────
const mockGetActiveDecisionCapture = vi.fn();
const mockClearCapture = vi.fn();
const mockIsAbortPhrase = vi.fn();
vi.mock('../../decisions/capture-state.js', () => ({
  getActiveDecisionCapture: mockGetActiveDecisionCapture,
  clearCapture: mockClearCapture,
  isAbortPhrase: mockIsAbortPhrase,
}));

const mockHandleCapture = vi.fn();
const mockOpenCapture = vi.fn();
vi.mock('../../decisions/capture.js', () => ({
  handleCapture: mockHandleCapture,
  openCapture: mockOpenCapture,
}));

const mockDetectTriggerPhrase = vi.fn();
const mockClassifyStakes = vi.fn();
vi.mock('../../decisions/triggers.js', () => ({
  detectTriggerPhrase: mockDetectTriggerPhrase,
  classifyStakes: mockClassifyStakes,
}));

const mockIsSuppressed = vi.fn();
vi.mock('../../decisions/suppressions.js', () => ({
  isSuppressed: mockIsSuppressed,
}));

// ── Import modules under test after mocks ──────────────────────────────────
const { detectMode, processMessage, __resetSurfacedContradictionsForTests } = await import('../engine.js');
const { handleJournal } = await import('../modes/journal.js');
const { buildSystemPrompt } = await import('../personality.js');
const { formatContradictionNotice } = await import('../personality.js');
const { JOURNAL_SYSTEM_PROMPT, MODE_DETECTION_PROMPT, REFLECT_SYSTEM_PROMPT, COACH_SYSTEM_PROMPT, PSYCHOLOGY_SYSTEM_PROMPT, PRODUCE_SYSTEM_PROMPT } = await import(
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

describe('formatContradictionNotice', () => {
  it('returns empty string for empty array', () => {
    expect(formatContradictionNotice([])).toBe('');
  });

  it('formats a single contradiction with date and content', () => {
    const result = formatContradictionNotice([
      {
        entryId: 'entry-1',
        entryDate: new Date('2025-03-15'),
        entryContent: "I'll never go back to corporate work.",
        description: 'That seems to conflict with what you\'re sharing now.',
        confidence: 0.92,
      },
    ]);

    expect(result).toContain('---');
    expect(result).toContain('💡 I noticed something');
    expect(result).toContain('March 15, 2025');
    expect(result).toContain("I'll never go back to corporate work.");
    expect(result.toLowerCase()).toContain('people change');
    expect(result).toContain('What do you think?');
  });

  it('formats multiple contradictions as separate paragraphs', () => {
    const result = formatContradictionNotice([
      {
        entryId: 'entry-1',
        entryDate: new Date('2025-03-15'),
        entryContent: "I'll never go back to corporate work.",
        description: 'conflicts with current excitement about corporate offer.',
        confidence: 0.92,
      },
      {
        entryId: 'entry-2',
        entryDate: new Date('2025-02-10'),
        entryContent: 'Remote work is the only way I can be productive.',
        description: 'conflicts with considering an in-office role.',
        confidence: 0.85,
      },
    ]);

    expect(result).toContain('March 15, 2025');
    expect(result).toContain('February 10, 2025');
    // Two separate notices
    const lightbulbCount = (result.match(/💡/g) || []).length;
    expect(lightbulbCount).toBe(2);
  });

  it('truncates long entry content to 120 characters', () => {
    const longContent = 'A'.repeat(200);
    const result = formatContradictionNotice([
      {
        entryId: 'entry-1',
        entryDate: new Date('2025-01-01'),
        entryContent: longContent,
        description: 'conflict description.',
        confidence: 0.80,
      },
    ]);

    expect(result).not.toContain(longContent);
    expect(result).toContain('...');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('System Prompts', () => {
  it('JOURNAL_SYSTEM_PROMPT enforces no storage confirmation (R005)', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toMatch(/never.*confirm.*stor/i);
  });

  it('JOURNAL_SYSTEM_PROMPT enforces no hallucination (R011)', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toMatch(/never.*state.*fact/i);
  });

  it('JOURNAL_SYSTEM_PROMPT mentions optional questions', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toMatch(/question/i);
  });

  it('MODE_DETECTION_PROMPT instructs JOURNAL default for ambiguous', () => {
    expect(MODE_DETECTION_PROMPT).toMatch(/default.*journal/i);
  });
});

describe('buildSystemPrompt', () => {
  it('returns JOURNAL_SYSTEM_PROMPT for JOURNAL mode', () => {
    const result = buildSystemPrompt('JOURNAL');
    // buildSystemPrompt prepends constitutional preamble and appends Known Facts
    expect(result).toContain('You are Chris');
    expect(result).toContain('Core Principles');
    expect(result).toContain('Facts about you (Greg)');
  });

  it('returns a string for INTERROGATE mode (placeholder)', () => {
    const result = buildSystemPrompt('INTERROGATE');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns REFLECT_SYSTEM_PROMPT for REFLECT mode', () => {
    const result = buildSystemPrompt('REFLECT');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('REFLECT mode interpolates pensieveContext', () => {
    const withContext = buildSystemPrompt('REFLECT', 'Pattern: avoids conflict');
    expect(withContext).toContain('Pattern: avoids conflict');
    const withoutContext = buildSystemPrompt('REFLECT');
    expect(withoutContext).toContain('No relevant memories found.');
  });

  it('INTERROGATE mode interpolates pensieveContext', () => {
    const withContext = buildSystemPrompt('INTERROGATE', 'Mentioned childhood');
    expect(withContext).toContain('Mentioned childhood');
    const withoutContext = buildSystemPrompt('INTERROGATE');
    expect(withoutContext).toContain('No relevant memories found.');
  });

  it('returns COACH_SYSTEM_PROMPT for COACH mode (interpolated)', () => {
    const result = buildSystemPrompt('COACH');
    expect(result).toContain('No relevant memories found.');
    expect(result).toContain('No observations accumulated yet.');
    expect(result).toContain('Greg has come to you with a challenge');
  });

  it('COACH mode interpolates pensieveContext and relationalContext', () => {
    const result = buildSystemPrompt('COACH', 'memory-data-here', 'relational-data-here');
    expect(result).toContain('memory-data-here');
    expect(result).toContain('relational-data-here');
    expect(result).not.toContain('{pensieveContext}');
    expect(result).not.toContain('{relationalContext}');
  });

  it('PSYCHOLOGY mode interpolates pensieveContext and relationalContext', () => {
    const result = buildSystemPrompt('PSYCHOLOGY', 'memory-data-here', 'relational-data-here');
    expect(result).toContain('memory-data-here');
    expect(result).toContain('relational-data-here');
    expect(result).not.toContain('{pensieveContext}');
    expect(result).not.toContain('{relationalContext}');
  });

  it('returns PRODUCE_SYSTEM_PROMPT for PRODUCE mode with context interpolated', () => {
    const result = buildSystemPrompt('PRODUCE');
    expect(result).toContain('No relevant memories found.');
    expect(result).not.toContain('{pensieveContext}');
    expect(result).toContain('Be a genuine thinking partner');
  });

  it('interpolates pensieveContext in PRODUCE mode', () => {
    const result = buildSystemPrompt('PRODUCE', 'Test memory entry');
    expect(result).toContain('Test memory entry');
    expect(result).not.toContain('{pensieveContext}');
  });

  it('returns non-empty string for every mode', () => {
    const modes = ['JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE'] as const;
    for (const mode of modes) {
      const result = buildSystemPrompt(mode);
      expect(result.length).toBeGreaterThan(0);
    }
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
        model: 'claude-haiku-4-5-20251001',
        system: [
          {
            type: 'text',
            text: MODE_DETECTION_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
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

  // ── 4 new mode detection tests ───────────────────────────────────────────

  it('classifies REFLECT messages', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "REFLECT"}'));

    const mode = await detectMode('What patterns do you see in how I handle conflict?');

    expect(mode).toBe('REFLECT');
  });

  it('classifies COACH messages', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "COACH"}'));

    const mode = await detectMode(
      'I need you to push back on this — am I making excuses about the gym?',
    );

    expect(mode).toBe('COACH');
  });

  it('classifies PSYCHOLOGY messages', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PSYCHOLOGY"}'));

    const mode = await detectMode(
      'Can you do a deep analysis of my relationship with authority?',
    );

    expect(mode).toBe('PSYCHOLOGY');
  });

  it('classifies PRODUCE messages', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PRODUCE"}'));

    const mode = await detectMode(
      'Help me think through whether I should take this new job offer',
    );

    expect(mode).toBe('PRODUCE');
  });

  // ── Fence-stripping (K003) ───────────────────────────────────────────────

  it('parses mode from markdown-fenced JSON (K003)', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse('```json\n{"mode": "COACH"}\n```'),
    );

    const mode = await detectMode('Push me harder on the gym excuse');

    expect(mode).toBe('COACH');
  });

  it('parses mode from bare-fenced JSON (K003)', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse('```\n{"mode": "REFLECT"}\n```'),
    );

    const mode = await detectMode('What themes do you notice?');

    expect(mode).toBe('REFLECT');
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
        model: 'claude-sonnet-4-6',
        system: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.any(String) }),
        ]),
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
    __resetSurfacedContradictionsForTests();
    // Mode detection → JOURNAL
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    // Sonnet response
    mockCreate.mockResolvedValueOnce(makeLLMResponse("That's a lovely memory."));

    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockStorePensieveEntry.mockResolvedValue({ id: ENTRY_ID, content: TEST_TEXT });
    mockBuildMessageHistory.mockResolvedValue([]);
    mockTagEntry.mockResolvedValue(null);
    mockEmbedAndStore.mockResolvedValue(undefined);
    mockDetectContradictions.mockResolvedValue([]);
    mockDetectMuteIntent.mockResolvedValue({ muted: false });
    mockQuarantinePraise.mockImplementation((response: string) => Promise.resolve(response));

    // Phase 14 PP#0/PP#1 defaults — no active capture, no suppression, no trigger
    mockGetActiveDecisionCapture.mockResolvedValue(null);
    mockIsSuppressed.mockResolvedValue(false);
    mockDetectTriggerPhrase.mockReturnValue(null);
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
    expect(mockSaveMessage.mock.calls[0]![1]).toBe('USER');
    expect(mockSaveMessage.mock.calls[1]![1]).toBe('ASSISTANT');
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
      expect.any(String),
      expect.any(Array),
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

  // ── Routing tests for 4 new modes ─────────────────────────────────────────

  it('routes REFLECT to handleReflect', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();
    mockHandleReflect.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "REFLECT"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleReflect.mockResolvedValue("I'm still building out my ability to reflect.");

    const response = await processMessage(
      CHAT_ID,
      USER_ID,
      'What patterns do you see in how I handle conflict?',
    );

    expect(response).toBe("I'm still building out my ability to reflect.");
    expect(mockHandleReflect).toHaveBeenCalledWith(
      CHAT_ID,
      'What patterns do you see in how I handle conflict?',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'USER',
      'What patterns do you see in how I handle conflict?',
      'REFLECT',
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'ASSISTANT',
      "I'm still building out my ability to reflect.",
      'REFLECT',
    );
    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('routes COACH to handleCoach', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();
    mockHandleCoach.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "COACH"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleCoach.mockResolvedValue("I'm still building out my coaching mode.");

    const response = await processMessage(
      CHAT_ID,
      USER_ID,
      'Am I making excuses about the gym?',
    );

    expect(response).toBe("I'm still building out my coaching mode.");
    expect(mockHandleCoach).toHaveBeenCalledWith(
      CHAT_ID,
      'Am I making excuses about the gym?',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'USER',
      'Am I making excuses about the gym?',
      'COACH',
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'ASSISTANT',
      "I'm still building out my coaching mode.",
      'COACH',
    );
    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('routes PSYCHOLOGY to handlePsychology', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();
    mockHandlePsychology.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PSYCHOLOGY"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandlePsychology.mockResolvedValue("I'm still developing the depth for analysis.");

    const response = await processMessage(
      CHAT_ID,
      USER_ID,
      'Deep analysis of my relationship with authority?',
    );

    expect(response).toBe("I'm still developing the depth for analysis.");
    expect(mockHandlePsychology).toHaveBeenCalledWith(
      CHAT_ID,
      'Deep analysis of my relationship with authority?',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'USER',
      'Deep analysis of my relationship with authority?',
      'PSYCHOLOGY',
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'ASSISTANT',
      "I'm still developing the depth for analysis.",
      'PSYCHOLOGY',
    );
    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('routes PRODUCE to handleProduce', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockStorePensieveEntry.mockReset();
    mockHandleProduce.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PRODUCE"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleProduce.mockResolvedValue("I'm still building out brainstorming.");

    const response = await processMessage(
      CHAT_ID,
      USER_ID,
      'Should I take the new job offer?',
    );

    expect(response).toBe("I'm still building out brainstorming.");
    expect(mockHandleProduce).toHaveBeenCalledWith(
      CHAT_ID,
      'Should I take the new job offer?',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'USER',
      'Should I take the new job offer?',
      'PRODUCE',
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'ASSISTANT',
      "I'm still building out brainstorming.",
      'PRODUCE',
    );
    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  // ── Relational memory writer integration tests ────────────────────────────

  it('calls writeRelationalMemory after JOURNAL exchange', async () => {
    const response = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(response).toBe("That's a lovely memory.");
    expect(mockWriteRelationalMemory).toHaveBeenCalledWith(
      CHAT_ID,
      TEST_TEXT,
      "That's a lovely memory.",
    );
  });

  it('does not call writeRelationalMemory for INTERROGATE mode', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockHandleInterrogate.mockReset();
    mockWriteRelationalMemory.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "INTERROGATE"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleInterrogate.mockResolvedValue('You mentioned that before.');

    await processMessage(CHAT_ID, USER_ID, 'What did I say about work?');

    expect(mockWriteRelationalMemory).not.toHaveBeenCalled();
  });

  it('does not call writeRelationalMemory for REFLECT mode', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockHandleReflect.mockReset();
    mockWriteRelationalMemory.mockReset();

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "REFLECT"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleReflect.mockResolvedValue('I notice a pattern of avoidance.');

    await processMessage(CHAT_ID, USER_ID, 'What patterns do you see?');

    expect(mockWriteRelationalMemory).not.toHaveBeenCalled();
  });

  // ── Contradiction detection integration tests ─────────────────────────────

  it('JOURNAL mode calls detectContradictions with user text', async () => {
    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(mockDetectContradictions).toHaveBeenCalledWith(TEST_TEXT);
  });

  it('PRODUCE mode calls detectContradictions with user text', async () => {
    mockCreate.mockReset();
    mockSaveMessage.mockReset();
    mockHandleProduce.mockReset();
    mockDetectContradictions.mockReset();
    mockDetectContradictions.mockResolvedValue([]);

    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PRODUCE"}'));
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockHandleProduce.mockResolvedValue('Let me help you think through this.');

    await processMessage(CHAT_ID, USER_ID, 'Should I take the corporate job?');

    expect(mockDetectContradictions).toHaveBeenCalledWith('Should I take the corporate job?');
  });

  it('other modes do NOT call detectContradictions', async () => {
    const modes = [
      { mode: 'INTERROGATE', handler: mockHandleInterrogate },
      { mode: 'REFLECT', handler: mockHandleReflect },
      { mode: 'COACH', handler: mockHandleCoach },
      { mode: 'PSYCHOLOGY', handler: mockHandlePsychology },
    ];

    for (const { mode, handler } of modes) {
      mockCreate.mockReset();
      mockSaveMessage.mockReset();
      handler.mockReset();
      mockDetectContradictions.mockReset();
      mockDetectContradictions.mockResolvedValue([]);

      mockCreate.mockResolvedValueOnce(makeLLMResponse(`{"mode": "${mode}"}`));
      mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
      handler.mockResolvedValue('Mode response.');

      await processMessage(CHAT_ID, USER_ID, 'Test message for mode check');

      expect(mockDetectContradictions).not.toHaveBeenCalled();
    }
  });

  it('appends contradiction notice to response when contradictions found', async () => {
    const contradictions = [
      {
        entryId: 'old-entry-1',
        entryDate: new Date('2025-03-15'),
        entryContent: "I'll never go back to corporate work.",
        description: 'That seems to conflict with what you\'re sharing now.',
        confidence: 0.92,
      },
    ];
    mockDetectContradictions.mockResolvedValue(contradictions);

    const response = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(response).toContain("That's a lovely memory.");
    expect(response).toContain('---');
    expect(response).toContain('💡 I noticed something');
    expect(response).toContain('March 15, 2025');
    expect(response).toContain("I'll never go back to corporate work.");
  });

  it('response unmodified when no contradictions detected', async () => {
    mockDetectContradictions.mockResolvedValue([]);

    const response = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(response).toBe("That's a lovely memory.");
  });

  it('detection failure does not break response', async () => {
    mockDetectContradictions.mockRejectedValue(new Error('Detection DB error'));

    const response = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(response).toBe("That's a lovely memory.");
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Detection DB error' }),
      'chris.engine.contradiction.error',
    );
  });

  it('detection timeout returns response without notice', async () => {
    // Simulate a detection call that never resolves within the timeout
    mockDetectContradictions.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ entryId: 'x', entryDate: new Date(), entryContent: 'old', description: 'conflict', confidence: 0.9 }]), 5000)),
    );

    const response = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    // The 3-second timeout should win, returning [] from Promise.race
    expect(response).toBe("That's a lovely memory.");
  }, 10000);

  it('saved assistant message includes contradiction notice when present', async () => {
    const contradictions = [
      {
        entryId: 'old-entry-1',
        entryDate: new Date('2025-03-15'),
        entryContent: "I'll never go back to corporate work.",
        description: 'That seems to conflict with what you\'re sharing now.',
        confidence: 0.92,
      },
    ];
    mockDetectContradictions.mockResolvedValue(contradictions);

    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    // The ASSISTANT saveMessage call should include the notice
    const assistantCall = mockSaveMessage.mock.calls.find(
      (call: unknown[]) => call[1] === 'ASSISTANT',
    );
    expect(assistantCall).toBeDefined();
    expect(assistantCall![2]).toContain('💡 I noticed something');
  });

  // ── Input validation tests ────────────────────────────────────────────────

  it('rejects empty string', async () => {
    await expect(processMessage(CHAT_ID, USER_ID, '')).rejects.toThrow('Empty message text');
  });

  it('rejects whitespace-only string', async () => {
    await expect(processMessage(CHAT_ID, USER_ID, '   ')).rejects.toThrow('Empty message text');
  });

  it('rejects message over 100,000 characters', async () => {
    const longText = 'a'.repeat(100_001);
    await expect(processMessage(CHAT_ID, USER_ID, longText)).rejects.toThrow('Message too long');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('praise quarantine integration (SYCO-04/05)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockStorePensieveEntry.mockResolvedValue({ id: ENTRY_ID, content: TEST_TEXT });
    mockBuildMessageHistory.mockResolvedValue([]);
    mockBuildPensieveContext.mockResolvedValue('');
    mockTagEntry.mockResolvedValue(null);
    mockEmbedAndStore.mockResolvedValue(undefined);
    mockDetectContradictions.mockResolvedValue([]);
    mockDetectMuteIntent.mockResolvedValue({ muted: false });
    mockQuarantinePraise.mockImplementation((response: string) => Promise.resolve(response));

    // Phase 14 PP#0/PP#1 defaults — no active capture, no suppression, no trigger
    mockGetActiveDecisionCapture.mockResolvedValue(null);
    mockIsSuppressed.mockResolvedValue(false);
    mockDetectTriggerPhrase.mockReturnValue(null);
  });

  it('calls quarantinePraise for JOURNAL mode', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    mockCreate.mockResolvedValueOnce(makeLLMResponse('Great question! Here is my answer.'));

    mockQuarantinePraise.mockResolvedValue('Here is my answer.');

    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(mockQuarantinePraise).toHaveBeenCalledWith('Great question! Here is my answer.', 'JOURNAL');
  });

  it('calls quarantinePraise for REFLECT mode', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "REFLECT"}'));
    mockHandleReflect.mockResolvedValue('Great point! I see a pattern here.');
    mockQuarantinePraise.mockResolvedValue('I see a pattern here.');

    await processMessage(CHAT_ID, USER_ID, 'What patterns do you see?');

    expect(mockQuarantinePraise).toHaveBeenCalledWith('Great point! I see a pattern here.', 'REFLECT');
  });

  it('calls quarantinePraise for PRODUCE mode', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PRODUCE"}'));
    mockHandleProduce.mockResolvedValue('Excellent idea! Here are some thoughts.');
    mockQuarantinePraise.mockResolvedValue('Here are some thoughts.');

    await processMessage(CHAT_ID, USER_ID, 'Help me brainstorm.');

    expect(mockQuarantinePraise).toHaveBeenCalledWith('Excellent idea! Here are some thoughts.', 'PRODUCE');
  });

  it('does NOT call quarantinePraise for COACH mode', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "COACH"}'));
    mockHandleCoach.mockResolvedValue('Here is direct feedback.');

    await processMessage(CHAT_ID, USER_ID, 'Give me direct feedback.');

    expect(mockQuarantinePraise).not.toHaveBeenCalled();
  });

  it('does NOT call quarantinePraise for PSYCHOLOGY mode', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "PSYCHOLOGY"}'));
    mockHandlePsychology.mockResolvedValue('Examining the deeper pattern.');

    await processMessage(CHAT_ID, USER_ID, 'Analyze my behavior.');

    expect(mockQuarantinePraise).not.toHaveBeenCalled();
  });

  it('uses rewritten response in saved message', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    mockCreate.mockResolvedValueOnce(makeLLMResponse('What a thoughtful entry! Here is my reflection.'));
    mockQuarantinePraise.mockResolvedValue('Rewritten response without flattery');

    await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    const assistantCall = mockSaveMessage.mock.calls.find(
      (call: unknown[]) => call[1] === 'ASSISTANT',
    );
    expect(assistantCall).toBeDefined();
    expect(assistantCall![2]).toBe('Rewritten response without flattery');
  });

  it('passes through original on quarantine error', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    mockCreate.mockResolvedValueOnce(makeLLMResponse("That's a lovely memory."));
    mockQuarantinePraise.mockRejectedValue(new Error('Haiku failed'));

    const result = await processMessage(CHAT_ID, USER_ID, TEST_TEXT);

    expect(result).toBe("That's a lovely memory.");
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Haiku failed' }),
      'chris.engine.praise_quarantine.error',
    );
  });
});
