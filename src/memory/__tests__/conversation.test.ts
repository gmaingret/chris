import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db ────────────────────────────────────────────────────────────────
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLogInfo = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import modules under test after mocks ──────────────────────────────────
const { saveMessage, getRecentHistory } = await import('../conversation.js');
const { buildMessageHistory } = await import('../context-builder.js');
const { conversations } = await import('../../db/schema.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeRow(
  role: 'USER' | 'ASSISTANT',
  content: string,
  chatId: bigint = 12345n,
  createdAt: Date = new Date(),
) {
  return {
    id: crypto.randomUUID(),
    chatId,
    role,
    content,
    mode: 'JOURNAL' as const,
    createdAt,
  };
}

// ── Tests: saveMessage ─────────────────────────────────────────────────────

describe('saveMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts correct values including bigint chatId', async () => {
    const chatId = 9876543210n;
    const fakeRow = makeRow('USER', 'hello', chatId);
    mockReturning.mockResolvedValueOnce([fakeRow]);

    const result = await saveMessage(chatId, 'USER', 'hello', 'JOURNAL');

    expect(mockInsert).toHaveBeenCalledWith(conversations);
    expect(mockValues).toHaveBeenCalledWith({
      chatId: 9876543210n,
      role: 'USER',
      content: 'hello',
      mode: 'JOURNAL',
    });
    expect(result).toEqual(fakeRow);
  });

  it('logs at info level with chatId, role, and mode', async () => {
    const fakeRow = makeRow('ASSISTANT', 'response');
    mockReturning.mockResolvedValueOnce([fakeRow]);

    await saveMessage(12345n, 'ASSISTANT', 'response', 'JOURNAL');

    expect(mockLogInfo).toHaveBeenCalledWith(
      { chatId: '12345', role: 'ASSISTANT', mode: 'JOURNAL' },
      'memory.conversation.save',
    );
  });
});

// ── Tests: getRecentHistory ────────────────────────────────────────────────

describe('getRecentHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries with correct chatId and default limit', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await getRecentHistory(12345n);

    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith(conversations);
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  it('respects custom limit', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await getRecentHistory(12345n, 5);

    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it('logs loaded count', async () => {
    const rows = [makeRow('USER', 'a'), makeRow('ASSISTANT', 'b')];
    mockLimit.mockResolvedValueOnce(rows);

    await getRecentHistory(12345n);

    expect(mockLogInfo).toHaveBeenCalledWith(
      { chatId: '12345', count: 2 },
      'memory.conversation.load',
    );
  });
});

// ── Tests: buildMessageHistory (context builder) ───────────────────────────

describe('buildMessageHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no history exists', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([]);
  });

  it('maps USER→user and ASSISTANT→assistant', async () => {
    // Mock returns DESC order (newest first); getRecentHistory reverses to chronological
    const rows = [
      makeRow('ASSISTANT', 'hi there'),
      makeRow('USER', 'hello'),
    ];
    mockLimit.mockResolvedValueOnce(rows);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('merges consecutive same-role messages with double newline', async () => {
    // Mock returns DESC order (newest first); getRecentHistory reverses to chronological
    const rows = [
      makeRow('ASSISTANT', 'response'),
      makeRow('USER', 'second message'),
      makeRow('USER', 'first message'),
    ];
    mockLimit.mockResolvedValueOnce(rows);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([
      { role: 'user', content: 'first message\n\nsecond message' },
      { role: 'assistant', content: 'response' },
    ]);
  });

  it('handles multiple consecutive merges', async () => {
    // Mock returns DESC order (newest first); getRecentHistory reverses to chronological
    const rows = [
      makeRow('ASSISTANT', 'y'),
      makeRow('ASSISTANT', 'x'),
      makeRow('USER', 'c'),
      makeRow('USER', 'b'),
      makeRow('USER', 'a'),
    ];
    mockLimit.mockResolvedValueOnce(rows);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([
      { role: 'user', content: 'a\n\nb\n\nc' },
      { role: 'assistant', content: 'x\n\ny' },
    ]);
  });

  it('handles single message (edge case)', async () => {
    mockLimit.mockResolvedValueOnce([makeRow('USER', 'just one')]);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([{ role: 'user', content: 'just one' }]);
  });
});
