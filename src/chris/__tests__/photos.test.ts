import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: {
    immichApiUrl: 'http://localhost:2283',
    immichApiKey: 'test-api-key',
    embeddingModel: 'Xenova/bge-m3',
    embeddingDimensions: 1024,
    logLevel: 'info',
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  logger: { info: mockLogInfo, warn: mockLogWarn, error: vi.fn(), debug: vi.fn() },
}));

// ── Mock Anthropic ─────────────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

// ── Mock Immich client ─────────────────────────────────────────────────────
const mockFetchRecentPhotos = vi.fn();
const mockFetchAssetThumbnail = vi.fn();
vi.mock('../../immich/client.js', () => ({
  fetchRecentPhotos: mockFetchRecentPhotos,
  fetchAssetThumbnail: mockFetchAssetThumbnail,
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildMessageHistory = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
}));

// ── Mock personality ───────────────────────────────────────────────────────
const mockBuildSystemPrompt = vi.fn();
vi.mock('../personality.js', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
}));

// ── Import module under test ───────────────────────────────────────────────
const { handlePhotos, parseDateHint } = await import('../modes/photos.js');

const CHAT_ID = BigInt(123456);

function makeLLMResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 2000, output_tokens: 150 },
  };
}

const MOCK_ASSET = {
  id: 'asset-1',
  type: 'IMAGE' as const,
  originalFileName: 'photo.jpg',
  fileCreatedAt: '2026-03-28T12:00:00.000Z',
  exifInfo: { city: 'Paris', country: 'France', dateTimeOriginal: '2026-03-28T12:00:00.000Z' },
  people: [{ id: 'p1', name: 'Johnory' }],
};

const MOCK_THUMB = { base64: 'dGVzdA==', mediaType: 'image/jpeg' as const };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('parseDateHint', () => {
  it('parses "today" in English', () => {
    const result = parseDateHint('Show me photos from today');
    expect(result.takenAfter).toBeDefined();
    expect(result.takenBefore).toBeUndefined();
  });

  it('parses "aujourd\'hui" in French', () => {
    const result = parseDateHint("Regarde mes photos d'aujourd'hui");
    expect(result.takenAfter).toBeDefined();
  });

  it('parses "yesterday" in English', () => {
    const result = parseDateHint('What did I photograph yesterday?');
    expect(result.takenAfter).toBeDefined();
    expect(result.takenBefore).toBeDefined();
  });

  it('parses "hier" in French', () => {
    const result = parseDateHint('Montre-moi mes photos d\'hier');
    expect(result.takenAfter).toBeDefined();
    expect(result.takenBefore).toBeDefined();
  });

  it('parses "this week" in English', () => {
    const result = parseDateHint('Show me my photos from this week');
    expect(result.takenAfter).toBeDefined();
    expect(result.takenBefore).toBeUndefined();
  });

  it('parses "cette semaine" in French', () => {
    const result = parseDateHint('Mes photos de cette semaine');
    expect(result.takenAfter).toBeDefined();
  });

  it('returns empty for generic "show me my photos"', () => {
    const result = parseDateHint('Show me my latest photos');
    expect(result.takenAfter).toBeUndefined();
    expect(result.takenBefore).toBeUndefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handlePhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildMessageHistory.mockResolvedValue([]);
    mockBuildSystemPrompt.mockReturnValue('You are Chris...');
    mockCreate.mockResolvedValue(makeLLMResponse('Belle photo de Paris !'));
  });

  it('fetches recent photos and sends them to Claude vision', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    const result = await handlePhotos(CHAT_ID, 'Regarde mes photos');

    expect(result).not.toBeNull();
    expect(result!.response).toBe('Belle photo de Paris !');
    expect(result!.photoContext).toContain('Paris');
    expect(result!.photoContext).toContain('Chris viewed 1 photo');
    expect(mockFetchRecentPhotos).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    expect(mockFetchAssetThumbnail).toHaveBeenCalledWith('asset-1');
  });

  it('passes image as base64 to Sonnet', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    await handlePhotos(CHAT_ID, 'Show me my photos');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                source: expect.objectContaining({
                  type: 'base64',
                  media_type: 'image/jpeg',
                }),
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('includes photo metadata in the message content', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    await handlePhotos(CHAT_ID, 'Show me photos');

    const call = mockCreate.mock.calls[0]![0];
    const userMessage = call.messages[call.messages.length - 1];
    const metaBlock = userMessage.content.find(
      (b: any) => b.type === 'text' && b.text.includes('Photo metadata'),
    );
    expect(metaBlock).toBeDefined();
    expect(metaBlock.text).toContain('Paris');
  });

  it('returns null when no photos found', async () => {
    mockFetchRecentPhotos.mockResolvedValue([]);

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips thumbnails that fail to load', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET, { ...MOCK_ASSET, id: 'asset-2' }]);
    mockFetchAssetThumbnail
      .mockResolvedValueOnce(MOCK_THUMB)
      .mockRejectedValueOnce(new Error('thumbnail failed'));

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).not.toBeNull();
    expect(result!.response).toBe('Belle photo de Paris !');
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-2' }),
      'chris.photos.thumbnail.error',
    );
  });

  it('returns null when all thumbnails fail', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockRejectedValue(new Error('all failed'));

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
  });

  it('handles multiple photos', async () => {
    const assets = [
      MOCK_ASSET,
      { ...MOCK_ASSET, id: 'asset-2', originalFileName: 'photo2.jpg' },
      { ...MOCK_ASSET, id: 'asset-3', originalFileName: 'photo3.jpg' },
    ];
    mockFetchRecentPhotos.mockResolvedValue(assets);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    await handlePhotos(CHAT_ID, 'Mes photos');

    expect(mockFetchAssetThumbnail).toHaveBeenCalledTimes(3);
    const call = mockCreate.mock.calls[0]![0];
    const userContent = call.messages[call.messages.length - 1].content;
    const imageBlocks = userContent.filter((b: any) => b.type === 'image');
    expect(imageBlocks).toHaveLength(3);
  });

  it('passes date filter for "aujourd\'hui"', async () => {
    mockFetchRecentPhotos.mockResolvedValue([]);

    await handlePhotos(CHAT_ID, "Regarde mes photos d'aujourd'hui");

    expect(mockFetchRecentPhotos).toHaveBeenCalledWith(
      expect.objectContaining({
        takenAfter: expect.any(String),
        limit: 5,
      }),
    );
  });

  it('logs response with photo count and token usage', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    await handlePhotos(CHAT_ID, 'Show me photos');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        photoCount: 1,
        inputTokens: 2000,
        outputTokens: 150,
      }),
      'chris.photos.response',
    );
  });

  it('returns null when Immich throws network error (graceful degradation)', async () => {
    mockFetchRecentPhotos.mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ECONNREFUSED') }),
      'chris.photos.immich_unavailable',
    );
  });

  it('returns null when Immich times out', async () => {
    mockFetchRecentPhotos.mockRejectedValue(new Error('timeout'));

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
  });

  it('throws LLMError when Claude vision fails (not Immich)', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handlePhotos(CHAT_ID, 'Show me photos')).rejects.toThrow();
  });

  it('parses "last week" / "la semaine dernière" correctly', () => {
    const en = parseDateHint('What did I photograph last week?');
    expect(en.takenAfter).toBeDefined();
    expect(en.takenBefore).toBeDefined();

    const fr = parseDateHint('Mes photos de la semaine dernière');
    expect(fr.takenAfter).toBeDefined();
    expect(fr.takenBefore).toBeDefined();
  });
});
