import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageError } from '../../utils/errors.js';

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

// ── Mock DB ────────────────────────────────────────────────────────────────
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { storePensieveEntryDedup } = await import('../store.js');
const { computeContentHash } = await import('../../utils/content-hash.js');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('storePensieveEntryDedup — content-hash dedup', () => {
  const fakeEntry = {
    id: 'existing-entry-id',
    content: 'some content',
    contentHash: computeContentHash('some content'),
    epistemicTag: null,
    source: 'telegram',
    metadata: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new entry when no duplicate exists and sets contentHash', async () => {
    mockSelectLimit.mockResolvedValueOnce([]); // No existing entry
    const newEntry = { ...fakeEntry, id: 'new-entry-id' };
    mockReturning.mockResolvedValueOnce([newEntry]);

    const result = await storePensieveEntryDedup('some content', 'telegram_file');

    expect(result.id).toBe('new-entry-id');
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'some content',
        source: 'telegram_file',
        contentHash: computeContentHash('some content'),
      }),
    );
  });

  it('returns existing entry when duplicate content is found (skips insert)', async () => {
    mockSelectLimit.mockResolvedValueOnce([fakeEntry]); // Existing entry found

    const result = await storePensieveEntryDedup('some content');

    expect(result.id).toBe('existing-entry-id');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('logs pensieve.store.dedup when skipping duplicate', async () => {
    mockSelectLimit.mockResolvedValueOnce([fakeEntry]);

    await storePensieveEntryDedup('some content');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: fakeEntry.contentHash,
        existingEntryId: 'existing-entry-id',
      }),
      'pensieve.store.dedup',
    );
  });

  it('computes correct SHA-256 contentHash', async () => {
    mockSelectLimit.mockResolvedValueOnce([]);
    const newEntry = { ...fakeEntry, id: 'new-id' };
    mockReturning.mockResolvedValueOnce([newEntry]);

    await storePensieveEntryDedup('test content');

    const expectedHash = computeContentHash('test content');
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: expectedHash }),
    );
    // SHA-256 hex is always 64 chars
    expect(expectedHash).toHaveLength(64);
  });

  it('throws StorageError on empty content', async () => {
    await expect(storePensieveEntryDedup('')).rejects.toThrow(StorageError);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('throws StorageError when DB query fails', async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error('connection refused'));

    await expect(storePensieveEntryDedup('content')).rejects.toThrow(StorageError);
  });
});
