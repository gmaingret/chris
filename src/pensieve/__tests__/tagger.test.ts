import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db ────────────────────────────────────────────────────────────────
const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('../../db/connection.js', () => ({
  db: { update: mockUpdate },
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

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
}));

// ── Import module under test after mocks ───────────────────────────────────
const { tagEntry, VALID_TAGS } = await import('../tagger.js');
const { pensieveEntries } = await import('../../db/schema.js');

function makeLLMResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

describe('tagEntry', () => {
  const entryId = '550e8400-e29b-41d4-a716-446655440000';
  const content = 'I am terrified of public speaking';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockResolvedValue(undefined);
  });

  it('returns a valid tag when LLM responds correctly', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"tag": "FEAR"}'));

    const result = await tagEntry(entryId, content);

    expect(result).toBe('FEAR');
    expect(VALID_TAGS).toContain(result);
  });

  it('calls db.update with the correct tag value', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"tag": "EMOTION"}'));

    await tagEntry(entryId, content);

    expect(mockUpdate).toHaveBeenCalledWith(pensieveEntries);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ epistemicTag: 'EMOTION' }),
    );
    expect(mockWhere).toHaveBeenCalled();
  });

  it('logs at info level with entry ID and tag on success', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"tag": "BELIEF"}'));

    await tagEntry(entryId, content);

    expect(mockLogInfo).toHaveBeenCalledWith(
      { entryId, tag: 'BELIEF' },
      'pensieve.tag',
    );
  });

  it('returns null and does not throw when LLM call fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API unreachable'));

    const result = await tagEntry(entryId, content);

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'API unreachable' }),
      'pensieve.tag.error',
    );
  });

  it('returns null when LLM returns unparseable response', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('not json at all'));

    const result = await tagEntry(entryId, content);

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'Unparseable LLM response' }),
      'pensieve.tag.error',
    );
  });

  it('returns null when LLM returns an invalid tag name', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"tag": "BANANA"}'));

    const result = await tagEntry(entryId, content);

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'Invalid tag: BANANA' }),
      'pensieve.tag.error',
    );
  });

  it('returns null when DB update fails', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse('{"tag": "FEAR"}'));
    mockWhere.mockRejectedValueOnce(new Error('connection lost'));

    const result = await tagEntry(entryId, content);

    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ entryId, error: 'connection lost' }),
      'pensieve.tag.error',
    );
  });
});
