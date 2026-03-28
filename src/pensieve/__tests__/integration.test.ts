import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db (supports both insert and update chains) ───────────────────────
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  HAIKU_MODEL: 'claude-3-5-haiku-20241022',
}));

// ── Import modules under test after mocks ──────────────────────────────────
const { storePensieveEntry } = await import('../store.js');
const { tagEntry } = await import('../tagger.js');

describe('store → tag integration', () => {
  const fakeEntryId = 'aabbccdd-1122-3344-5566-778899001122';

  const fakeRow = {
    id: fakeEntryId,
    content: 'I am terrified of public speaking',
    epistemicTag: null,
    source: 'telegram',
    metadata: null,
    createdAt: new Date('2025-06-01'),
    updatedAt: new Date('2025-06-01'),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockResolvedValue(undefined);
  });

  it('stores an entry then tags it — both target the same entry ID', async () => {
    // Step 1: store returns the entry
    mockReturning.mockResolvedValueOnce([fakeRow]);

    const row = await storePensieveEntry('I am terrified of public speaking', 'telegram');

    expect(row.content).toBe('I am terrified of public speaking');
    expect(row.epistemicTag).toBeNull();
    expect(row.id).toBe(fakeEntryId);

    // Step 2: tag the entry — LLM returns FEAR
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"tag": "FEAR"}' }],
    });

    const tag = await tagEntry(row.id, row.content);

    expect(tag).toBe('FEAR');

    // Verify both operations targeted the same entry ID
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ epistemicTag: 'FEAR' }),
    );
    expect(mockWhere).toHaveBeenCalled();
  });

  it('store succeeds even when tagger fails — fire-and-forget guarantee', async () => {
    // Store succeeds
    mockReturning.mockResolvedValueOnce([fakeRow]);
    const row = await storePensieveEntry('Some thought', 'telegram');
    expect(row.id).toBe(fakeEntryId);

    // Tagger fails — LLM throws
    mockCreate.mockRejectedValueOnce(new Error('service unavailable'));
    const tag = await tagEntry(row.id, row.content);

    // Tag is null, but no exception propagated
    expect(tag).toBeNull();
    // Store result is unaffected
    expect(row.content).toBe('I am terrified of public speaking');
  });
});
