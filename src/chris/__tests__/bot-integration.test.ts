import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock fns (available inside vi.mock factories) ──────────────────
const { mockProcessMessage, mockLogError } = vi.hoisted(() => ({
  mockProcessMessage: vi.fn(),
  mockLogError: vi.fn(),
}));

// ── Mock processMessage ────────────────────────────────────────────────────
vi.mock('../../chris/engine.js', () => ({
  processMessage: mockProcessMessage,
}));

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLogError,
    debug: vi.fn(),
  },
}));

// ── Mock Grammy Bot to prevent real initialization ─────────────────────────
vi.mock('grammy', () => {
  class MockBot {
    use = vi.fn();
    on = vi.fn();
    command = vi.fn();
    catch = vi.fn();
  }
  return { Bot: MockBot };
});

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: { telegramBotToken: 'test-token' },
}));

// ── Mock auth middleware ───────────────────────────────────────────────────
vi.mock('../../bot/middleware/auth.js', () => ({
  auth: vi.fn(),
}));

// ── Import handler (after mocks) ──────────────────────────────────────────
import { handleTextMessage } from '../../bot/bot.js';

// ── Helper: build a mock Grammy context ────────────────────────────────────
function mockCtx(overrides?: {
  chatId?: number;
  userId?: number;
  text?: string;
}) {
  return {
    chat: { id: overrides?.chatId ?? 12345 },
    from: { id: overrides?.userId ?? 67890 },
    message: { text: overrides?.text ?? 'I had coffee with Dad today' },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('bot-integration: handleTextMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls processMessage with BigInt chatId, userId, and text', async () => {
    mockProcessMessage.mockResolvedValueOnce('That sounds lovely.');
    const ctx = mockCtx({ chatId: 99999, userId: 42, text: 'Hello Chris' });

    await handleTextMessage(ctx);

    expect(mockProcessMessage).toHaveBeenCalledOnce();
    expect(mockProcessMessage).toHaveBeenCalledWith(
      BigInt(99999),
      42,
      'Hello Chris',
    );
  });

  it('replies with the engine response', async () => {
    const engineResponse = 'Tell me more about your coffee with Dad.';
    mockProcessMessage.mockResolvedValueOnce(engineResponse);
    const ctx = mockCtx();

    await handleTextMessage(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.reply).toHaveBeenCalledWith(engineResponse);
  });

  it('replies with fallback message on processMessage failure', async () => {
    mockProcessMessage.mockRejectedValueOnce(new Error('LLM timeout'));
    const ctx = mockCtx({ chatId: 55555 });

    await handleTextMessage(ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.reply).toHaveBeenCalledWith(
      'I got tangled up in my thoughts. Try again?',
    );
  });

  it('logs error with chatId and message on failure', async () => {
    mockProcessMessage.mockRejectedValueOnce(new Error('LLM timeout'));
    const ctx = mockCtx({ chatId: 55555 });

    await handleTextMessage(ctx);

    expect(mockLogError).toHaveBeenCalledOnce();
    expect(mockLogError).toHaveBeenCalledWith(
      {
        chatId: '55555',
        error: 'LLM timeout',
      },
      'chris.bot.error',
    );
  });

  it('converts chatId to BigInt even for large Telegram group IDs', async () => {
    mockProcessMessage.mockResolvedValueOnce('Noted.');
    // Telegram supergroup IDs can be large negative numbers
    const ctx = mockCtx({ chatId: -1001234567890 });

    await handleTextMessage(ctx);

    expect(mockProcessMessage).toHaveBeenCalledWith(
      BigInt(-1001234567890),
      expect.any(Number),
      expect.any(String),
    );
  });

  it('does not call reply twice on success', async () => {
    mockProcessMessage.mockResolvedValueOnce('Response');
    const ctx = mockCtx();

    await handleTextMessage(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
  });
});
