import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageError } from '../../utils/errors.js';

// Mock db module before importing store — prevents config.ts from loading
// and requiring real env vars.
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../../db/connection.js', () => ({
  db: { insert: mockInsert },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Now safe to import store — mocked deps won't trigger env var checks
const { storePensieveEntry } = await import('../store.js');
const { pensieveEntries } = await import('../../db/schema.js');

describe('storePensieveEntry', () => {
  const fakeRow = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    content: '  I felt uneasy about the meeting  ',
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

  it('returns the inserted row with content verbatim (no trimming)', async () => {
    mockReturning.mockResolvedValueOnce([fakeRow]);

    const result = await storePensieveEntry(fakeRow.content);

    expect(result.content).toBe('  I felt uneasy about the meeting  ');
    expect(result.id).toBe(fakeRow.id);
    expect(mockInsert).toHaveBeenCalledWith(pensieveEntries);
    expect(mockValues).toHaveBeenCalledWith({
      content: '  I felt uneasy about the meeting  ',
      source: 'telegram',
      metadata: null,
    });
  });

  it('passes metadata through to the insert', async () => {
    const meta = { telegramMessageId: 42, telegramChatId: 100 };
    const rowWithMeta = { ...fakeRow, metadata: meta };
    mockReturning.mockResolvedValueOnce([rowWithMeta]);

    const result = await storePensieveEntry('hello', 'api', meta);

    expect(mockValues).toHaveBeenCalledWith({
      content: 'hello',
      source: 'api',
      metadata: meta,
    });
    expect(result.metadata).toEqual(meta);
  });

  it('throws StorageError on empty string', async () => {
    await expect(storePensieveEntry('')).rejects.toThrow(StorageError);
    await expect(storePensieveEntry('')).rejects.toThrow('Content must not be empty');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('wraps DB errors in StorageError with cause chain', async () => {
    const dbError = new Error('connection refused');
    mockReturning.mockRejectedValueOnce(dbError);

    try {
      await storePensieveEntry('valid content');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).cause).toBe(dbError);
      expect((err as StorageError).message).toBe('Failed to store pensieve entry');
    }
  });
});
