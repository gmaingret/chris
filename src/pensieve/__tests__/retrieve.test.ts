import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: {
    embeddingModel: 'Xenova/bge-m3',
    embeddingDimensions: 1024,
    logLevel: 'info',
    databaseUrl: 'postgres://mock',
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
  },
}));

// ── Mock embedText ─────────────────────────────────────────────────────────
const FAKE_QUERY_VECTOR = Array.from({ length: 1024 }, (_, i) => i / 1024);
const mockEmbedText = vi.fn<(text: string) => Promise<number[] | null>>().mockResolvedValue(FAKE_QUERY_VECTOR);

vi.mock('../embeddings.js', () => ({
  embedText: (text: string) => mockEmbedText(text),
}));

// ── Mock DB ────────────────────────────────────────────────────────────────
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../../db/connection.js', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...(args as [])) },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { searchPensieve } = await import('../retrieve.js');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(id: string, content: string, createdAt: Date) {
  return {
    id,
    content,
    epistemicTag: null,
    source: 'telegram',
    metadata: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

describe('searchPensieve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockResolvedValue(FAKE_QUERY_VECTOR);
  });

  it('returns entries ranked by descending similarity score (R003)', async () => {
    const closer = makeEntry('aaa', 'relevant entry', new Date('2024-01-01'));
    const farther = makeEntry('bbb', 'less relevant entry', new Date('2024-06-01'));

    mockLimit.mockResolvedValueOnce([
      { entry: closer, distance: 0.1 },
      { entry: farther, distance: 0.4 },
    ]);

    const results = await searchPensieve('topic');

    expect(results).toHaveLength(2);
    expect(results[0].entry.id).toBe('aaa');
    expect(results[0].score).toBeCloseTo(0.9); // 1 - 0.1
    expect(results[1].entry.id).toBe('bbb');
    expect(results[1].score).toBeCloseTo(0.6); // 1 - 0.4
    // First result has higher similarity
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('respects the limit parameter', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('query', 3);

    expect(mockLimit).toHaveBeenCalledWith(3);
  });

  it('defaults limit to 5', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('query');

    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it('passes French query text through to embedText for multilingual support (R010)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('Je me souviens de mon enfance à Paris');

    expect(mockEmbedText).toHaveBeenCalledWith('Je me souviens de mon enfance à Paris');
  });

  it('passes Russian query text through to embedText for multilingual support (R010)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('Я помню свое детство в Москве');

    expect(mockEmbedText).toHaveBeenCalledWith('Я помню свое детство в Москве');
  });

  it('ranks old but more relevant entries above recent less relevant ones — temporal neutrality (R012)', async () => {
    const oldRelevant = makeEntry('old', 'highly relevant old entry', new Date('2020-01-01'));
    const recentIrrelevant = makeEntry('new', 'less relevant recent entry', new Date('2025-12-01'));

    // Cosine distance: lower = more similar. Old entry is closer (0.05) than recent (0.7).
    mockLimit.mockResolvedValueOnce([
      { entry: oldRelevant, distance: 0.05 },
      { entry: recentIrrelevant, distance: 0.7 },
    ]);

    const results = await searchPensieve('relevant topic');

    expect(results[0].entry.id).toBe('old');
    expect(results[1].entry.id).toBe('new');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns empty array when DB returns no rows', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const results = await searchPensieve('obscure query');

    expect(results).toEqual([]);
  });

  it('returns empty array and logs warning when embedText returns null', async () => {
    mockEmbedText.mockResolvedValueOnce(null);

    const results = await searchPensieve('some query');

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'some query' }),
      'pensieve.retrieve.error',
    );
  });

  it('returns empty array and logs error when DB query throws', async () => {
    mockLimit.mockRejectedValueOnce(new Error('connection reset'));

    const results = await searchPensieve('some query');

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection reset' }),
      'pensieve.retrieve.error',
    );
  });

  it('filters deleted entries via WHERE clause (deletedAt IS NULL)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('test');

    // The where() call should have been invoked — meaning the filter is in the chain
    expect(mockWhere).toHaveBeenCalled();
    // Verify the full chain: select → from → innerJoin → where → orderBy → limit
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockInnerJoin).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalled();
  });

  it('logs pensieve.retrieve with truncated query, resultCount, and latencyMs on success', async () => {
    mockLimit.mockResolvedValueOnce([
      { entry: makeEntry('aaa', 'content', new Date()), distance: 0.2 },
    ]);

    await searchPensieve('test query');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'test query',
        resultCount: 1,
        latencyMs: expect.any(Number),
      }),
      'pensieve.retrieve',
    );
  });

  it('truncates long query text to 50 chars in logs', async () => {
    const longQuery = 'a'.repeat(100);
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve(longQuery);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'a'.repeat(50),
      }),
      'pensieve.retrieve',
    );
  });
});
