/**
 * Multi-turn integration test for photo context persistence.
 *
 * Reproduces the bug: user asks Chris to look at photos, Chris sees them,
 * but on subsequent turns Chris claims he can't see photos because the
 * image context wasn't persisted in conversation history.
 *
 * Verifies:
 * 1. Photo metadata is saved with the user message in conversation history
 * 2. Subsequent non-photo turns include the photo context in history
 * 3. Chris doesn't re-fetch photos on follow-up turns (no loop)
 * 4. The photo context is human-readable text, not base64 image data
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Track saved messages to simulate DB ────────────────────────────────────
const savedMessages: Array<{ chatId: bigint; role: string; content: string; mode: string }> = [];

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: {
    anthropicApiKey: 'test-key',
    telegramBotToken: 'test-token',
    telegramAuthorizedUserId: 123456,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    proactiveTimezone: 'Europe/Paris',
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock DB ────────────────────────────────────────────────────────────────
// Drizzle query builders are both chainable and thenable: every step
// (`.from`, `.where`, `.orderBy`, `.limit`) returns an object that can be
// further chained OR awaited directly. Callers terminate the chain at
// different points — `isSuppressed` awaits after `.where()`,
// `getActiveDecisionCapture` awaits after `.limit()`, history reads await
// after `.orderBy().limit()`. One thenable terminal covers them all.
vi.mock('../../db/connection.js', () => {
  const terminal: Record<string, unknown> = {};
  const chain = () => terminal;
  terminal.from = vi.fn(chain);
  terminal.where = vi.fn(chain);
  terminal.orderBy = vi.fn(chain);
  terminal.limit = vi.fn(chain);
  // Thenable — `await <chain>` resolves to an empty result set.
  terminal.then = (resolve: (v: unknown[]) => void) => resolve([]);
  return {
    db: {
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => [{ id: 1 }]) })) })),
      select: vi.fn(() => terminal),
    },
  };
});

// ── Mock Anthropic ─────────────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  SONNET_MODEL: 'claude-sonnet-4-6',
  OPUS_MODEL: 'claude-opus-4-6',
}));

// ── Mock proactive modules ─────────────────────────────────────────────────
vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: vi.fn().mockResolvedValue({ muted: false }),
  generateMuteAcknowledgment: vi.fn(),
}));
vi.mock('../../proactive/state.js', () => ({
  setMuteUntil: vi.fn(),
}));

// ── Mock conversation — track what gets saved ──────────────────────────────
const mockSaveMessage = vi.fn(async (chatId: bigint, role: string, content: string, mode: string) => {
  savedMessages.push({ chatId, role, content, mode });
  return { id: savedMessages.length, chatId, role, content, mode, createdAt: new Date() };
});
vi.mock('../../memory/conversation.js', () => ({
  saveMessage: mockSaveMessage,
}));

// ── Mock context builder — returns savedMessages as history ────────────────
const mockBuildMessageHistory = vi.fn(async () => {
  // Simulate what the real context builder does: return saved messages as Anthropic format
  return savedMessages.map(m => ({
    role: m.role === 'USER' ? 'user' as const : 'assistant' as const,
    content: m.content,
  }));
});
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: vi.fn(() => ''),
}));

// ── Mock Immich client ─────────────────────────────────────────────────────
const mockFetchRecentPhotos = vi.fn();
const mockFetchAssetThumbnail = vi.fn();
vi.mock('../../immich/client.js', () => ({
  fetchRecentPhotos: mockFetchRecentPhotos,
  fetchAssetThumbnail: mockFetchAssetThumbnail,
}));

// ── Mock personality ───────────────────────────────────────────────────────
vi.mock('../personality.js', () => ({
  buildSystemPrompt: vi.fn(() => 'You are Chris...'),
  formatContradictionNotice: vi.fn(() => ''),
}));

// ── Mock relational memory ─────────────────────────────────────────────────
vi.mock('../../memory/relational.js', () => ({
  writeRelationalMemory: vi.fn(),
}));

// ── Mock contradiction detector ────────────────────────────────────────────
vi.mock('../contradiction.js', () => ({
  detectContradictions: vi.fn().mockResolvedValue([]),
}));

// ── Mock pensieve ──────────────────────────────────────────────────────────
vi.mock('../../pensieve/retrieve.js', () => ({
  searchPensieve: vi.fn().mockResolvedValue([]),
}));

// ── Mock mode handlers that aren't under test ──────────────────────────────
const mockHandleJournal = vi.fn();
vi.mock('../modes/journal.js', () => ({
  handleJournal: mockHandleJournal,
}));

const mockHandleInterrogate = vi.fn();
vi.mock('../modes/interrogate.js', () => ({
  handleInterrogate: mockHandleInterrogate,
}));

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

// ── Import after mocks ────────────────────────────────────────────────────
const { processMessage } = await import('../engine.js');

// ── Test data ──────────────────────────────────────────────────────────────
const CHAT_ID = 12345n;
const USER_ID = 42;

const MOCK_ASSETS = [
  {
    id: 'asset-1',
    type: 'IMAGE' as const,
    originalFileName: 'sunset-paris.jpg',
    fileCreatedAt: '2026-03-28T18:30:00.000Z',
    exifInfo: {
      city: 'Paris',
      state: 'Île-de-France',
      country: 'France',
      dateTimeOriginal: '2026-03-28T18:30:00.000Z',
      latitude: 48.8566,
      longitude: 2.3522,
    },
    people: [{ id: 'p1', name: 'Greg' }],
  },
  {
    id: 'asset-2',
    type: 'IMAGE' as const,
    originalFileName: 'coffee-shop.jpg',
    fileCreatedAt: '2026-03-28T10:00:00.000Z',
    exifInfo: {
      city: 'Paris',
      country: 'France',
      dateTimeOriginal: '2026-03-28T10:00:00.000Z',
    },
    people: [],
  },
];

const MOCK_THUMB = { base64: 'dGVzdA==', mediaType: 'image/jpeg' as const };

function makeLLMResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 100 },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Photo context persistence across turns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedMessages.length = 0;
    mockHandleJournal.mockResolvedValue("Default journal response.");
  });

  it('Turn 1: photo request saves metadata in user message', async () => {
    // Mode detection returns PHOTOS
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode":"PHOTOS"}'));
    // Photo query parse (Haiku)
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"takenAfter":"2026-03-28T00:00:00.000Z"}'));
    // Immich returns photos
    mockFetchRecentPhotos.mockResolvedValue(MOCK_ASSETS);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);
    // Vision response (Sonnet)
    mockCreate.mockResolvedValueOnce(
      makeLLMResponse("Ah, belle journée à Paris ! Je vois un coucher de soleil magnifique et un moment au café."),
    );

    const response = await processMessage(CHAT_ID, USER_ID, "Regarde mes photos d'aujourd'hui");

    expect(response).toContain('Paris');

    // Verify user message was saved with photo context
    const userMsg = savedMessages.find(m => m.role === 'USER');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain("Regarde mes photos d'aujourd'hui");
    expect(userMsg!.content).toContain('[Chris viewed 2 photo(s)');
    expect(userMsg!.content).toContain('sunset-paris.jpg');
    expect(userMsg!.content).toContain('coffee-shop.jpg');
    expect(userMsg!.content).toContain('Paris');
    expect(userMsg!.content).toContain('Greg');

    // Verify NO base64 image data leaked into saved message
    expect(userMsg!.content).not.toContain('dGVzdA==');

    // Verify assistant response was also saved
    const assistantMsg = savedMessages.find(m => m.role === 'ASSISTANT');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toContain('Paris');
  });

  it('Turn 2: follow-up question sees photo context in history, does NOT re-fetch photos', async () => {
    // Simulate Turn 1 already happened — messages in savedMessages
    savedMessages.push({
      chatId: CHAT_ID,
      role: 'USER',
      content: "Regarde mes photos d'aujourd'hui\n\n[Chris viewed 2 photo(s):\nPhoto: sunset-paris.jpg\nDate: 2026-03-28\nLocation: Paris, Île-de-France, France (48.8566, 2.3522)\nPeople: Greg\n---\nPhoto: coffee-shop.jpg\nDate: 2026-03-28\nLocation: Paris, France]",
      mode: 'PHOTOS',
    });
    savedMessages.push({
      chatId: CHAT_ID,
      role: 'ASSISTANT',
      content: "Ah, belle journée à Paris ! Je vois un coucher de soleil et un café.",
      mode: 'PHOTOS',
    });

    // Turn 2: user asks about the sunset photo — mode detected as JOURNAL (not PHOTOS)
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode":"JOURNAL"}'));
    // Journal handler returns response
    mockHandleJournal.mockResolvedValueOnce(
      "Le coucher de soleil était près de la Tour Eiffel, vu l'emplacement dans le 75.",
    );

    const response = await processMessage(CHAT_ID, USER_ID, "C'était où exactement le coucher de soleil ?");

    // Should NOT have called Immich at all
    expect(mockFetchRecentPhotos).not.toHaveBeenCalled();
    expect(mockFetchAssetThumbnail).not.toHaveBeenCalled();

    // Journal handler was called (not photos handler)
    expect(mockHandleJournal).toHaveBeenCalledTimes(1);

    // The conversation history (savedMessages) still contains photo context from Turn 1
    const photoTurnMsg = savedMessages.find(
      m => m.role === 'USER' && m.content.includes('Chris viewed 2 photo'),
    );
    expect(photoTurnMsg).toBeDefined();
    expect(photoTurnMsg!.content).toContain('sunset-paris.jpg');
  });

  it('Turn 3: unrelated topic does NOT trigger photo fetch', async () => {
    // Simulate prior turns in history
    savedMessages.push({
      chatId: CHAT_ID,
      role: 'USER',
      content: "Regarde mes photos\n\n[Chris viewed 2 photo(s):\nPhoto: sunset.jpg\n---\nPhoto: coffee.jpg]",
      mode: 'PHOTOS',
    });
    savedMessages.push({
      chatId: CHAT_ID,
      role: 'ASSISTANT',
      content: "Belles photos !",
      mode: 'PHOTOS',
    });
    savedMessages.push({
      chatId: CHAT_ID,
      role: 'USER',
      content: "C'était où le coucher de soleil ?",
      mode: 'JOURNAL',
    });
    savedMessages.push({
      chatId: CHAT_ID,
      role: 'ASSISTANT',
      content: "Près de la Tour Eiffel.",
      mode: 'JOURNAL',
    });

    // Turn 3: completely different topic
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode":"JOURNAL"}'));
    mockHandleJournal.mockResolvedValueOnce(
      "Je comprends, c'est toujours stressant le boulot.",
    );

    await processMessage(CHAT_ID, USER_ID, "J'ai eu une journée stressante au boulot");

    // No photo fetching
    expect(mockFetchRecentPhotos).not.toHaveBeenCalled();
    expect(mockFetchAssetThumbnail).not.toHaveBeenCalled();
  });

  it('photo fallback to journal does NOT save photo context', async () => {
    // Mode detection returns PHOTOS but no photos found
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode":"PHOTOS"}'));
    // Photo query parse (Haiku)
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{}'));
    mockFetchRecentPhotos.mockResolvedValue([]);
    // Falls back to journal handler
    mockHandleJournal.mockResolvedValueOnce(
      "Je n'ai pas trouvé de photos récentes.",
    );

    await processMessage(CHAT_ID, USER_ID, 'Montre-moi mes photos');

    // User message should NOT contain photo context (none were viewed)
    const userMsg = savedMessages.find(m => m.role === 'USER');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).not.toContain('[Chris viewed');
    expect(userMsg!.content).toBe('Montre-moi mes photos');
  });

  it('saveMessage is called exactly twice per turn (user + assistant)', async () => {
    // PHOTOS mode with results
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode":"PHOTOS"}'));
    // Photo query parse (Haiku)
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{}'));
    mockFetchRecentPhotos.mockResolvedValue(MOCK_ASSETS);
    mockFetchAssetThumbnail.mockResolvedValue(MOCK_THUMB);
    // Vision response (Sonnet)
    mockCreate.mockResolvedValueOnce(makeLLMResponse('Nice photos!'));

    await processMessage(CHAT_ID, USER_ID, 'Show me photos');

    // Exactly 2 saves: enriched user message + assistant response
    expect(mockSaveMessage).toHaveBeenCalledTimes(2);

    // First save: USER with photo context
    expect(mockSaveMessage).toHaveBeenNthCalledWith(
      1,
      CHAT_ID, 'USER',
      expect.stringContaining('[Chris viewed 2 photo(s)'),
      'PHOTOS',
    );

    // Second save: ASSISTANT response
    expect(mockSaveMessage).toHaveBeenNthCalledWith(
      2,
      CHAT_ID, 'ASSISTANT',
      'Nice photos!',
      'PHOTOS',
    );
  });
});
