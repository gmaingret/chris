import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (K001) ──────────────────────────────────────────────────

const {
  mockDetectMuteIntent,
  mockGenerateMuteAcknowledgment,
  mockSetMuteUntil,
  mockCreate,
  mockSaveMessage,
  mockStorePensieveEntry,
  mockBuildMessageHistory,
  mockTagEntry,
  mockEmbedAndStore,
  mockHandleInterrogate,
  mockLogInfo,
  mockLogWarn,
} = vi.hoisted(() => ({
  mockDetectMuteIntent: vi.fn(),
  mockGenerateMuteAcknowledgment: vi.fn(),
  mockSetMuteUntil: vi.fn(),
  mockCreate: vi.fn(),
  mockSaveMessage: vi.fn(),
  mockStorePensieveEntry: vi.fn(),
  mockBuildMessageHistory: vi.fn(),
  mockTagEntry: vi.fn(),
  mockEmbedAndStore: vi.fn(),
  mockHandleInterrogate: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: mockDetectMuteIntent,
  generateMuteAcknowledgment: mockGenerateMuteAcknowledgment,
}));

vi.mock('../../proactive/state.js', () => ({
  setMuteUntil: mockSetMuteUntil,
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  HAIKU_MODEL: 'claude-3-5-haiku-20241022',
  SONNET_MODEL: 'claude-sonnet-4-20250514',
}));

vi.mock('../../memory/conversation.js', () => ({
  saveMessage: mockSaveMessage,
}));

vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: mockStorePensieveEntry,
}));

vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: mockTagEntry,
}));

vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: mockEmbedAndStore,
}));

vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: vi.fn(),
}));

vi.mock('../../pensieve/retrieve.js', () => ({
  searchPensieve: vi.fn(),
}));

vi.mock('../modes/interrogate.js', () => ({
  handleInterrogate: mockHandleInterrogate,
}));

vi.mock('../../config.js', () => ({
  config: {
    anthropicApiKey: 'test-key',
    proactiveTimezone: 'Europe/Paris',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

const { processMessage, detectMode } = await import('../engine.js');

// ── Constants ──────────────────────────────────────────────────────────────

const CHAT_ID = 12345n;
const USER_ID = 42;
const MUTE_UNTIL = new Date('2026-04-04T12:00:00Z');

function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('engine mute pre-processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveMessage.mockResolvedValue({ id: 'conv-1' });
    mockSetMuteUntil.mockResolvedValue(undefined);
  });

  it('short-circuits on mute intent — detectMode NOT called', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({
      muted: true,
      muteUntil: MUTE_UNTIL,
      durationDescription: '1 week',
    });
    mockGenerateMuteAcknowledgment.mockResolvedValueOnce(
      "Got it — I'll be quiet for a while.",
    );

    const response = await processMessage(CHAT_ID, USER_ID, 'quiet for a week');

    expect(response).toBe("Got it — I'll be quiet for a while.");
    // detectMode should NOT have been called
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls setMuteUntil with correct Date', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({
      muted: true,
      muteUntil: MUTE_UNTIL,
      durationDescription: '1 week',
    });
    mockGenerateMuteAcknowledgment.mockResolvedValueOnce('Sure thing.');

    await processMessage(CHAT_ID, USER_ID, 'quiet for a week');

    expect(mockSetMuteUntil).toHaveBeenCalledWith(MUTE_UNTIL);
  });

  it('saves both user and assistant messages as JOURNAL', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({
      muted: true,
      muteUntil: MUTE_UNTIL,
      durationDescription: '1 week',
    });
    mockGenerateMuteAcknowledgment.mockResolvedValueOnce('Taking a break, got it.');

    await processMessage(CHAT_ID, USER_ID, 'quiet for a week');

    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'USER',
      'quiet for a week',
      'JOURNAL',
    );
    expect(mockSaveMessage).toHaveBeenCalledWith(
      CHAT_ID,
      'ASSISTANT',
      'Taking a break, got it.',
      'JOURNAL',
    );
  });

  it('logs chris.mute.set with muteUntil and durationDescription', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({
      muted: true,
      muteUntil: MUTE_UNTIL,
      durationDescription: '1 week',
    });
    mockGenerateMuteAcknowledgment.mockResolvedValueOnce('Got it.');

    await processMessage(CHAT_ID, USER_ID, 'quiet for a week');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        muteUntil: MUTE_UNTIL.toISOString(),
        durationDescription: '1 week',
        chatId: CHAT_ID.toString(),
      }),
      'chris.mute.set',
    );
  });

  it('passes non-mute messages through to normal flow', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({ muted: false });
    // Mode detection → JOURNAL
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"mode": "JOURNAL"}'));
    // Sonnet response
    mockCreate.mockResolvedValueOnce(makeLLMResponse("That's lovely."));
    mockStorePensieveEntry.mockResolvedValue({ id: 'entry-1', content: 'test' });
    mockBuildMessageHistory.mockResolvedValue([]);
    mockTagEntry.mockResolvedValue(null);
    mockEmbedAndStore.mockResolvedValue(undefined);

    const response = await processMessage(CHAT_ID, USER_ID, 'Had a great day');

    expect(response).toBe("That's lovely.");
    // detectMode was called (via mockCreate for Haiku)
    expect(mockCreate).toHaveBeenCalled();
  });

  it('does not call storePensieveEntry for mute messages', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({
      muted: true,
      muteUntil: MUTE_UNTIL,
      durationDescription: '3 days',
    });
    mockGenerateMuteAcknowledgment.mockResolvedValueOnce('Okay.');

    await processMessage(CHAT_ID, USER_ID, 'leave me alone');

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
    expect(mockTagEntry).not.toHaveBeenCalled();
    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('calls generateMuteAcknowledgment with correct timezone', async () => {
    mockDetectMuteIntent.mockResolvedValueOnce({
      muted: true,
      muteUntil: MUTE_UNTIL,
      durationDescription: '1 week',
    });
    mockGenerateMuteAcknowledgment.mockResolvedValueOnce('Quiet time, got it.');

    await processMessage(CHAT_ID, USER_ID, 'quiet for a week');

    expect(mockGenerateMuteAcknowledgment).toHaveBeenCalledWith(
      MUTE_UNTIL,
      'Europe/Paris',
    );
  });
});
