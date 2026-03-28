import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock refs (K001) ───────────────────────────────────────────────
const { mockCreate, mockInsert, mockValues, mockSelect, mockFrom, mockWhere,
  mockOrderBy, mockLimit, mockLogInfo, mockLogWarn, mockLogDebug,
  mockGetRecentHistory } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn().mockResolvedValue(undefined),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockLimit: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
  mockGetRecentHistory: vi.fn(),
}));

// Wire up chainable DB mock
mockInsert.mockReturnValue({ values: mockValues });
mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });
mockOrderBy.mockReturnValue({ limit: mockLimit });

// ── Mock modules ───────────────────────────────────────────────────────────
vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
}));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

vi.mock('../conversation.js', () => ({
  getRecentHistory: mockGetRecentHistory,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    debug: mockLogDebug,
    error: vi.fn(),
  },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { writeRelationalMemory, getRelationalMemories } = await import('../relational.js');
const { relationalMemory } = await import('../../db/schema.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const chatId = 12345n;
const substantiveText = 'I have been thinking a lot about leaving my job lately. The stress is getting to me and I feel like I need a complete change of direction in my career.';
const assistantResponse = 'That sounds like a significant realization. What specifically about the stress feels different this time compared to other tough periods at work?';

// ── Tests: writeRelationalMemory ───────────────────────────────────────────

describe('writeRelationalMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire chainable mocks after clear
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);
    mockGetRecentHistory.mockResolvedValue([]);
  });

  it('inserts into DB when Haiku returns observe=true', async () => {
    const haikuResponse = JSON.stringify({
      observe: true,
      type: 'CONCERN',
      content: 'John is seriously considering a career change driven by sustained stress, not just a bad week.',
      confidence: 0.8,
    });
    mockCreate.mockResolvedValueOnce(makeLLMResponse(haikuResponse));

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockInsert).toHaveBeenCalledWith(relationalMemory);
    expect(mockValues).toHaveBeenCalledWith({
      type: 'CONCERN',
      content: 'John is seriously considering a career change driven by sustained stress, not just a bad week.',
      confidence: 0.8,
      supportingEntries: [],
    });
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CONCERN', confidence: 0.8 }),
      'memory.relational.write',
    );
  });

  it('does NOT insert when Haiku returns observe=false', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"observe": false}'));

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'haiku_declined' }),
      'memory.relational.skip',
    );
  });

  it('strips markdown fences from Haiku response (K003)', async () => {
    const fenced = '```json\n{"observe": true, "type": "PATTERN", "content": "John deflects career questions", "confidence": 0.7}\n```';
    mockCreate.mockResolvedValueOnce(makeLLMResponse(fenced));

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockInsert).toHaveBeenCalledWith(relationalMemory);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PATTERN', content: 'John deflects career questions' }),
    );
  });

  it('skips Haiku call when userText ≤ 50 chars', async () => {
    await writeRelationalMemory(chatId, 'ok thanks', assistantResponse);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'message_too_short' }),
      'memory.relational.skip',
    );
  });

  it('skips Haiku call when userText is exactly 50 chars', async () => {
    const fiftyChars = 'a'.repeat(50);
    await writeRelationalMemory(chatId, fiftyChars, assistantResponse);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('calls Haiku when userText is 51 chars', async () => {
    const fiftyOneChars = 'a'.repeat(51);
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"observe": false}'));

    await writeRelationalMemory(chatId, fiftyOneChars, assistantResponse);

    expect(mockCreate).toHaveBeenCalled();
  });

  it('does not throw on Haiku API error — logs warn', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    await expect(
      writeRelationalMemory(chatId, substantiveText, assistantResponse),
    ).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'haiku_call', error: 'API rate limit' }),
      'memory.relational.error',
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does not throw on unparseable Haiku response — logs warn', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('This is not JSON at all'));

    await expect(
      writeRelationalMemory(chatId, substantiveText, assistantResponse),
    ).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'parse', error: 'Unparseable Haiku response' }),
      'memory.relational.error',
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does not insert when Haiku returns invalid type', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse('{"observe": true, "type": "RANDOM_TYPE", "content": "something", "confidence": 0.5}'),
    );

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'parse', error: 'Invalid type: RANDOM_TYPE' }),
      'memory.relational.error',
    );
  });

  it('fetches recent history with limit 10 for context', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"observe": false}'));

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockGetRecentHistory).toHaveBeenCalledWith(chatId, 10);
  });

  it('uses default confidence 0.5 when Haiku omits it', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse('{"observe": true, "type": "OBSERVATION", "content": "John lives alone"}'),
    );

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.5 }),
    );
  });

  it('does not insert when content is missing', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse('{"observe": true, "type": "PATTERN", "confidence": 0.9}'),
    );

    await writeRelationalMemory(chatId, substantiveText, assistantResponse);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'parse', error: 'Missing content' }),
      'memory.relational.error',
    );
  });
});

// ── Tests: getRelationalMemories ───────────────────────────────────────────

describe('getRelationalMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire chainable mocks
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  it('returns all memories when no filter provided', async () => {
    const mockData = [
      { id: '1', type: 'PATTERN', content: 'test pattern', confidence: 0.8, createdAt: new Date() },
      { id: '2', type: 'INSIGHT', content: 'test insight', confidence: 0.6, createdAt: new Date() },
    ];
    mockLimit.mockResolvedValueOnce(mockData);

    const result = await getRelationalMemories();

    expect(result).toEqual(mockData);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(50);
  });

  it('filters by type when type provided', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await getRelationalMemories({ type: 'PATTERN' });

    expect(mockWhere).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(50);
  });

  it('respects custom limit', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await getRelationalMemories({ limit: 10 });

    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it('respects both type and limit', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await getRelationalMemories({ type: 'CONCERN', limit: 5 });

    expect(mockWhere).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(5);
  });
});
