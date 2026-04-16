import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── All mocks referenced inside vi.mock() factories must be hoisted ──────────
const {
  mockCreate,
  mockReturning,
  mockLimit,
  mockInsert,
  mockSelect,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockLimit = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockCreate = vi.fn();
  return { mockCreate, mockReturning, mockLimit, mockInsert, mockSelect };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

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
    logLevel: 'silent',
  },
}));

vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: vi.fn().mockResolvedValue({ muted: false }),
  generateMuteAcknowledgment: vi.fn(),
}));

vi.mock('../../proactive/state.js', () => ({
  setMuteUntil: vi.fn(),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
  OPUS_MODEL: 'test-opus',
}));

vi.mock('../contradiction.js', () => ({
  detectContradictions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../memory/relational.js', () => ({
  writeRelationalMemory: vi.fn(),
}));

vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn(),
}));

vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn(),
}));

// ── Decision capture mocks (Phase 14) ────────────────────────────────────
vi.mock('../../decisions/capture-state.js', () => ({
  getActiveDecisionCapture: vi.fn().mockResolvedValue(null),
  clearCapture: vi.fn(),
  isAbortPhrase: vi.fn().mockReturnValue(false),
}));
vi.mock('../../decisions/capture.js', () => ({
  handleCapture: vi.fn(),
  openCapture: vi.fn(),
}));
vi.mock('../../decisions/triggers.js', () => ({
  detectTriggerPhrase: vi.fn().mockReturnValue(null),
  classifyStakes: vi.fn().mockResolvedValue('trivial'),
}));
vi.mock('../../decisions/suppressions.js', () => ({
  isSuppressed: vi.fn().mockResolvedValue(false),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { processMessage } from '../engine.js';
import { clearDeclinedTopics } from '../refusal.js';
import { clearLanguageState } from '../language.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('engine refusal integration (TRUST-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDeclinedTopics('12345');
    clearLanguageState('12345');
    mockReturning.mockResolvedValue([{ id: 1 }]);
    mockLimit.mockResolvedValue([]);
  });

  it('returns acknowledgment on refusal without calling detectMode', async () => {
    const result = await processMessage(12345n, 1, "I don't want to talk about my father");
    expect(result).toBeTruthy();
    expect(result.length).toBeLessThan(100); // short ack, not a full response
    // detectMode calls Haiku — key assertion: no LLM call was made
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('passes declinedTopics to handler after prior refusal', async () => {
    // First: refusal — builds declined topics session state
    await processMessage(12345n, 1, "I don't want to talk about my father");

    // Mock detectMode (Haiku) for next message
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"mode": "JOURNAL"}' }],
    });
    // Mock Sonnet response for journal handler
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'That sounds great!' }],
    });

    // Second: normal message — declined topics should flow to handler
    const result = await processMessage(12345n, 1, 'Tell me about cooking');
    expect(result).toBe('That sounds great!');

    // Verify Sonnet received system prompt containing declined topics section
    const sonnetCall = mockCreate.mock.calls.find(
      (call: any[]) => call[0]?.model === 'test-sonnet',
    );
    expect(sonnetCall).toBeDefined();
    const systemPrompt = sonnetCall![0].system[0].text;
    expect(systemPrompt).toContain('Declined Topics');
    expect(systemPrompt).toContain("I don't want to talk about my father");
  });
});

describe('engine language detection (LANG-01, LANG-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDeclinedTopics('12345');
    clearLanguageState('12345');
    mockReturning.mockResolvedValue([{ id: 1 }]);
    mockLimit.mockResolvedValue([]);
  });

  it('detects language and passes to handler', async () => {
    // Mock detectMode
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"mode": "JOURNAL"}' }],
    });
    // Mock Sonnet response
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Bonjour!' }],
    });

    await processMessage(12345n, 1, "Aujourd'hui j'ai passé une journée magnifique au bureau");

    // Verify Sonnet system prompt contains French language directive
    const sonnetCall = mockCreate.mock.calls.find(
      (call: any[]) => call[0]?.model === 'test-sonnet',
    );
    expect(sonnetCall).toBeDefined();
    const systemPrompt = sonnetCall![0].system[0].text;
    expect(systemPrompt).toContain('French');
  });
});
