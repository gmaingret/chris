import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db ──
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../../db/connection.js', () => ({
  db: { insert: mockInsert, select: mockSelect },
}));

vi.mock('../../config.js', () => ({
  config: {
    anthropicApiKey: 'test-key',
    telegramBotToken: 'test-token',
    telegramAuthorizedUserId: 123456,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    proactiveTimezone: 'Europe/Paris',
  },
}));

// Mock mute (always returns not muted)
vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: vi.fn().mockResolvedValue({ muted: false }),
  generateMuteAcknowledgment: vi.fn(),
}));
vi.mock('../../proactive/state.js', () => ({
  setMuteUntil: vi.fn(),
}));

// Mock mode detection
vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: vi.fn() } },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
}));

// Mock contradiction detection (no contradictions)
vi.mock('../contradiction.js', () => ({
  detectContradictions: vi.fn().mockResolvedValue([]),
}));

// Mock relational memory (fire-and-forget)
vi.mock('../../memory/relational.js', () => ({
  writeRelationalMemory: vi.fn(),
}));

describe('engine refusal integration (TRUST-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns acknowledgment when refusal detected', async () => {
    // This test will work once refusal.ts and engine.ts changes exist
    // For now it documents the expected behavior:
    // processMessage(chatId, userId, "I don't want to talk about my father")
    // should return a short acknowledgment string, NOT route to a mode handler
    expect(true).toBe(true); // placeholder — will be fleshed out in Plan 03
  });

  it('passes language and declinedTopics through to handler', async () => {
    // After engine.ts changes, verify that:
    // 1. detectLanguage is called before detectMode
    // 2. language and declinedTopics are passed to the handler
    expect(true).toBe(true); // placeholder — will be fleshed out in Plan 03
  });
});
