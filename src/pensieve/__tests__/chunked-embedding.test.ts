import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: {
    embeddingModel: 'Xenova/bge-m3',
    embeddingDimensions: 1024,
    logLevel: 'info',
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

// ── Mock DB ────────────────────────────────────────────────────────────────
const mockValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../../db/connection.js', () => ({
  db: { insert: mockInsert },
}));

// ── Mock @huggingface/transformers ─────────────────────────────────────────
const MOCK_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024);
const mockPipe = vi.fn().mockResolvedValue({
  tolist: () => [MOCK_EMBEDDING],
});
const mockCreatePipeline = vi.fn().mockResolvedValue(mockPipe);

vi.mock('@huggingface/transformers', () => ({
  pipeline: mockCreatePipeline,
}));

// ── Import module under test after mocks ───────────────────────────────────
const { chunkText, embedAndStoreChunked, resetPipeline } = await import('../embeddings.js');
const { pensieveEmbeddings } = await import('../../db/schema.js');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('chunkText — chunked embedding', () => {
  it('returns a single chunk for short text', () => {
    const result = chunkText('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Hello world');
  });

  it('returns a single chunk for text exactly at maxChars', () => {
    const text = 'a'.repeat(4000);
    const result = chunkText(text, 4000, 400);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('splits long text into multiple chunks with overlap', () => {
    // 10000 chars, maxChars=4000, overlap=400 → step=3600
    // chunks start at: 0, 3600, 7200
    const text = 'a'.repeat(10000);
    const result = chunkText(text, 4000, 400);

    expect(result.length).toBeGreaterThan(1);
    // Each chunk should be at most maxChars
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('overlap regions contain the same content', () => {
    const text = Array.from({ length: 100 }, (_, i) => String(i).padStart(3, '0')).join('');
    // 300 chars total, maxChars=100, overlap=20
    const result = chunkText(text, 100, 20);

    expect(result.length).toBeGreaterThan(1);
    // The end of chunk[0] should overlap with start of chunk[1]
    const tailOfFirst = result[0].slice(-20);
    const headOfSecond = result[1].slice(0, 20);
    expect(tailOfFirst).toBe(headOfSecond);
  });

  it('returns at least one chunk for empty string', () => {
    const result = chunkText('');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('');
  });

  it('uses default maxChars=4000 and overlapChars=400', () => {
    const text = 'x'.repeat(8000);
    const result = chunkText(text);
    // step = 4000 - 400 = 3600
    // chunks at: 0, 3600, 7200 → 3 chunks
    expect(result).toHaveLength(3);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('embedAndStoreChunked — chunked embedding', () => {
  const entryId = 'test-entry-123';

  beforeEach(() => {
    vi.clearAllMocks();
    resetPipeline();
    mockValues.mockResolvedValue(undefined);
    mockPipe.mockResolvedValue({ tolist: () => [MOCK_EMBEDDING] });
  });

  it('stores a single embedding for short text with chunkIndex 0', async () => {
    await embedAndStoreChunked(entryId, 'short text');

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(pensieveEmbeddings);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, chunkIndex: 0 }),
    );
  });

  it('stores multiple embeddings with sequential chunkIndex for long text', async () => {
    const longText = 'x'.repeat(8000);
    await embedAndStoreChunked(entryId, longText);

    // 3 chunks expected
    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(mockValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ entryId, chunkIndex: 0 }),
    );
    expect(mockValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ entryId, chunkIndex: 1 }),
    );
    expect(mockValues).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ entryId, chunkIndex: 2 }),
    );
  });

  it('logs pensieve.embed.chunked on success with chunkCount and totalLatencyMs', async () => {
    const longText = 'x'.repeat(8000);
    await embedAndStoreChunked(entryId, longText);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId,
        chunkCount: 3,
        totalLatencyMs: expect.any(Number),
      }),
      'pensieve.embed.chunked',
    );
  });

  it('never throws even when embedText returns null for a chunk', async () => {
    mockPipe
      .mockResolvedValueOnce({ tolist: () => [MOCK_EMBEDDING] })
      .mockRejectedValueOnce(new Error('model error'))
      .mockResolvedValueOnce({ tolist: () => [MOCK_EMBEDDING] });

    const longText = 'x'.repeat(8000);
    await expect(embedAndStoreChunked(entryId, longText)).resolves.toBeUndefined();

    // Should still have inserted 2 (skipped the failed one)
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('never throws when DB insert fails', async () => {
    mockValues.mockRejectedValueOnce(new Error('connection refused'));

    await expect(embedAndStoreChunked(entryId, 'short text')).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'connection refused' }),
      'pensieve.embed.error',
    );
  });
});
