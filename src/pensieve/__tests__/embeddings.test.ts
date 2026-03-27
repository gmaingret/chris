import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock config (must come before module import) ───────────────────────────
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

// ── Mock db ────────────────────────────────────────────────────────────────
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
const { embedText, embedAndStore, resetPipeline } = await import('../embeddings.js');
const { pensieveEmbeddings } = await import('../../db/schema.js');

describe('embedText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPipeline();
  });

  it('returns a number[] of length 1024', async () => {
    const result = await embedText('hello');

    expect(result).toBeInstanceOf(Array);
    expect(result).toHaveLength(1024);
    result!.forEach((v) => expect(typeof v).toBe('number'));
  });

  it('calls pipeline with { pooling: "cls", normalize: true }', async () => {
    await embedText('hello');

    expect(mockPipe).toHaveBeenCalledWith('hello', { pooling: 'cls', normalize: true });
  });

  it('returns null and logs warning when pipeline throws', async () => {
    mockPipe.mockRejectedValueOnce(new Error('ONNX runtime failed'));

    const result = await embedText('hello');

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'ONNX runtime failed' }),
      'pensieve.embed.error',
    );
  });

  it('pipeline singleton is created only once across multiple calls', async () => {
    await embedText('first');
    await embedText('second');

    expect(mockCreatePipeline).toHaveBeenCalledTimes(1);
    expect(mockPipe).toHaveBeenCalledTimes(2);
  });
});

describe('embedAndStore', () => {
  const entryId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    resetPipeline();
    mockValues.mockResolvedValue(undefined);
    mockPipe.mockResolvedValue({ tolist: () => [MOCK_EMBEDDING] });
  });

  it('inserts into DB with correct entryId and vector', async () => {
    await embedAndStore(entryId, 'some content');

    expect(mockInsert).toHaveBeenCalledWith(pensieveEmbeddings);
    expect(mockValues).toHaveBeenCalledWith({
      entryId,
      embedding: MOCK_EMBEDDING,
      model: 'Xenova/bge-m3',
    });
  });

  it('logs pensieve.embed on success with latencyMs', async () => {
    await embedAndStore(entryId, 'some content');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId,
        model: 'Xenova/bge-m3',
        latencyMs: expect.any(Number),
      }),
      'pensieve.embed',
    );
  });

  it('returns without throwing when DB insert fails (logs pensieve.embed.error)', async () => {
    mockValues.mockRejectedValueOnce(new Error('connection refused'));

    await expect(embedAndStore(entryId, 'some content')).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'connection refused' }),
      'pensieve.embed.error',
    );
  });

  it('returns without throwing when embedText returns null', async () => {
    mockPipe.mockRejectedValueOnce(new Error('model load failed'));

    await expect(embedAndStore(entryId, 'some content')).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'embedText returned null' }),
      'pensieve.embed.error',
    );
  });
});
