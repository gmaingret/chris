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
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
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

// ── Mock memory/profiles (Phase 35 Plan 35-02 D-28 negative invariant) ─────
// PHOTOS is an OUT-OF-SCOPE mode (uses JOURNAL persona for vision) — these
// mocks must remain UNCALLED throughout this test file.
const mockGetOperationalProfiles = vi.fn();
const mockFormatProfilesForPrompt = vi.fn();
vi.mock('../../memory/profiles.js', () => ({
  getOperationalProfiles: mockGetOperationalProfiles,
  formatProfilesForPrompt: mockFormatProfilesForPrompt,
  PROFILE_INJECTION_MAP: {
    REFLECT: ['jurisdictional', 'capital', 'health', 'family'],
    COACH: ['capital', 'family'],
    PSYCHOLOGY: ['health', 'jurisdictional'],
  },
}));

// ── Import module under test ───────────────────────────────────────────────
const { handlePhotos, parsePhotoQuery } = await import('../modes/photos.js');

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
  people: [{ id: 'p1', name: 'Gregory' }],
};

const MOCK_THUMB = { base64: 'dGVzdA==', mediaType: 'image/jpeg' as const };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('parsePhotoQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts city from "photos de Vyborg"', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"city":"Vyborg"}'));

    const result = await parsePhotoQuery('Montre-moi mes photos de Vyborg');

    expect(result.city).toBe('Vyborg');
  });

  it('extracts date + city from "photos de Vyborg cet hiver"', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse(
      '{"city":"Vyborg","takenAfter":"2025-12-01T00:00:00.000Z","takenBefore":"2026-03-01T00:00:00.000Z"}'
    ));

    const result = await parsePhotoQuery('Mes photos de Vyborg cet hiver');

    expect(result.city).toBe('Vyborg');
    expect(result.takenAfter).toBeDefined();
    expect(result.takenBefore).toBeDefined();
  });

  it('extracts date for "aujourd\'hui"', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse(
      '{"takenAfter":"2026-03-28T00:00:00.000Z"}'
    ));

    const result = await parsePhotoQuery("Regarde mes photos d'aujourd'hui");

    expect(result.takenAfter).toBeDefined();
  });

  it('returns empty filters on LLM failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API down'));

    const result = await parsePhotoQuery('Show me photos');

    expect(result).toEqual({});
  });

  it('handles markdown-fenced JSON response (K003)', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('```json\n{"city":"Paris"}\n```'));

    const result = await parsePhotoQuery('Photos de Paris');

    expect(result.city).toBe('Paris');
  });

  it('returns empty for generic "show me my photos"', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{}'));

    const result = await parsePhotoQuery('Show me my latest photos');

    expect(result).toEqual({});
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handlePhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildMessageHistory.mockResolvedValue([]);
    mockBuildSystemPrompt.mockReturnValue('You are Chris...');
    // First call: parsePhotoQuery (Haiku), second call: vision (Sonnet)
    mockCreate
      .mockResolvedValueOnce(makeLLMResponse('{}'))  // query parse
      .mockResolvedValueOnce(makeLLMResponse('Belle photo de Paris !'));  // vision
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

  it('passes city filter when user asks for location-specific photos', async () => {
    mockCreate.mockReset();
    mockCreate
      .mockResolvedValueOnce(makeLLMResponse('{"city":"Vyborg"}'))
      .mockResolvedValueOnce(makeLLMResponse('Belles photos de Vyborg !'));

    mockFetchRecentPhotos.mockResolvedValue([{
      ...MOCK_ASSET,
      exifInfo: { city: 'Vyborg', country: 'Russia', dateTimeOriginal: '2026-01-31T12:00:00.000Z' },
    }]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    const result = await handlePhotos(CHAT_ID, 'Montre-moi mes photos de Vyborg');

    expect(result).not.toBeNull();
    expect(mockFetchRecentPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Vyborg', limit: 5 }),
    );
  });

  it('passes image as base64 to Sonnet', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    await handlePhotos(CHAT_ID, 'Show me my photos');

    // Second mockCreate call is the vision call
    const visionCall = mockCreate.mock.calls[1]![0];
    expect(visionCall.model).toBe('claude-sonnet-4-6');
    const userMsg = visionCall.messages[visionCall.messages.length - 1];
    const imageBlock = userMsg.content.find((b: any) => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe('base64');
  });

  it('includes photo metadata in the message content', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);

    await handlePhotos(CHAT_ID, 'Show me photos');

    const visionCall = mockCreate.mock.calls[1]![0];
    const userMessage = visionCall.messages[visionCall.messages.length - 1];
    const metaBlock = userMessage.content.find(
      (b: any) => b.type === 'text' && b.text.includes('Photo metadata'),
    );
    expect(metaBlock).toBeDefined();
    expect(metaBlock.text).toContain('Paris');
  });

  it('returns null when no photos found', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{}'));
    mockFetchRecentPhotos.mockResolvedValue([]);

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
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
    const visionCall = mockCreate.mock.calls[1]![0];
    const userContent = visionCall.messages[visionCall.messages.length - 1].content;
    const imageBlocks = userContent.filter((b: any) => b.type === 'image');
    expect(imageBlocks).toHaveLength(3);
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
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{}'));
    mockFetchRecentPhotos.mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ECONNREFUSED') }),
      'chris.photos.immich_unavailable',
    );
  });

  it('returns null when Immich times out', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{}'));
    mockFetchRecentPhotos.mockRejectedValue(new Error('timeout'));

    const result = await handlePhotos(CHAT_ID, 'Show me photos');

    expect(result).toBeNull();
  });

  it('throws LLMError when Claude vision fails (not Immich)', async () => {
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);
    mockCreate.mockReset();
    mockCreate
      .mockResolvedValueOnce(makeLLMResponse('{}'))
      .mockRejectedValueOnce(new Error('Sonnet unavailable'));

    await expect(handlePhotos(CHAT_ID, 'Show me photos')).rejects.toThrow();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 35 Plan 35-02 — Negative-injection invariant (D-28)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PHOTOS operational-profile injection (D-28 negative invariant)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildMessageHistory.mockResolvedValue([]);
    mockBuildSystemPrompt.mockReturnValue('You are Chris...');
    mockFetchRecentPhotos.mockResolvedValue([MOCK_ASSET]);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);
    mockCreate
      .mockResolvedValueOnce(makeLLMResponse('{}'))
      .mockResolvedValueOnce(makeLLMResponse('Belle photo'));
    mockGetOperationalProfiles.mockResolvedValue({
      jurisdictional: null,
      capital: null,
      health: null,
      family: null,
    });
  });

  it('does NOT call getOperationalProfiles (D-28 — out-of-scope mode, JOURNAL persona)', async () => {
    await handlePhotos(CHAT_ID, 'Show me photos');
    expect(mockGetOperationalProfiles).not.toHaveBeenCalled();
  });

  it('does NOT call formatProfilesForPrompt (D-28 — wire-drift detector)', async () => {
    await handlePhotos(CHAT_ID, 'Show me photos');
    expect(mockFormatProfilesForPrompt).not.toHaveBeenCalled();
  });
});
