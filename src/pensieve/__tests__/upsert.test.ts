import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageError } from '../../utils/errors.js';

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Mock content-hash ──────────────────────────────────────────────────────
const mockComputeContentHash = vi.fn();
vi.mock('../../utils/content-hash.js', () => ({
  computeContentHash: (...args: unknown[]) => mockComputeContentHash(...args),
}));

// ── Mock DB ────────────────────────────────────────────────────────────────
const dbMock = {
  selectResult: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  deleteWhere: vi.fn(),
};

vi.mock('../../db/connection.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => dbMock.selectResult()),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => dbMock.insertReturning()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => dbMock.updateReturning()),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => dbMock.deleteWhere()),
    })),
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────
import { storePensieveEntryUpsert } from '../store.js';

describe('upsert', () => {
  const baseMeta = { threadId: 'thread-123' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeContentHash.mockReturnValue('hash-abc');
  });

  it('creates a new entry when not found', async () => {
    dbMock.selectResult.mockResolvedValue([]);
    dbMock.insertReturning.mockResolvedValue([
      {
        id: 'entry-1',
        content: 'Hello',
        source: 'gmail',
        contentHash: 'hash-abc',
        metadata: baseMeta,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await storePensieveEntryUpsert(
      'Hello',
      'gmail',
      baseMeta,
      'threadId',
    );

    expect(result.action).toBe('created');
    expect(result.entry.id).toBe('entry-1');
    expect(result.entry.content).toBe('Hello');
  });

  it('skips unchanged entry (same hash)', async () => {
    dbMock.selectResult.mockResolvedValue([
      {
        id: 'entry-1',
        content: 'Hello',
        source: 'gmail',
        contentHash: 'hash-abc',
        metadata: baseMeta,
      },
    ]);

    const result = await storePensieveEntryUpsert(
      'Hello',
      'gmail',
      baseMeta,
      'threadId',
    );

    expect(result.action).toBe('skipped');
    expect(result.entry.id).toBe('entry-1');
    // Should not have called insert or update
    expect(dbMock.insertReturning).not.toHaveBeenCalled();
    expect(dbMock.updateReturning).not.toHaveBeenCalled();
  });

  it('updates changed entry and deletes old embeddings', async () => {
    dbMock.selectResult.mockResolvedValue([
      {
        id: 'entry-1',
        content: 'Old content',
        source: 'gmail',
        contentHash: 'old-hash',
        metadata: baseMeta,
      },
    ]);
    dbMock.updateReturning.mockResolvedValue([
      {
        id: 'entry-1',
        content: 'New content',
        source: 'gmail',
        contentHash: 'hash-abc',
        metadata: baseMeta,
        updatedAt: new Date(),
      },
    ]);
    dbMock.deleteWhere.mockResolvedValue(undefined);

    const result = await storePensieveEntryUpsert(
      'New content',
      'gmail',
      baseMeta,
      'threadId',
    );

    expect(result.action).toBe('updated');
    expect(result.entry.content).toBe('New content');
    // Verify old embeddings were deleted
    expect(dbMock.deleteWhere).toHaveBeenCalled();
  });

  it('throws StorageError on empty content', async () => {
    await expect(
      storePensieveEntryUpsert('', 'gmail', baseMeta, 'threadId'),
    ).rejects.toThrow(StorageError);
    await expect(
      storePensieveEntryUpsert('', 'gmail', baseMeta, 'threadId'),
    ).rejects.toThrow('Content must not be empty');
  });

  it('throws StorageError when externalIdField is missing from metadata', async () => {
    await expect(
      storePensieveEntryUpsert('content', 'gmail', {}, 'threadId'),
    ).rejects.toThrow(StorageError);
    await expect(
      storePensieveEntryUpsert('content', 'gmail', {}, 'threadId'),
    ).rejects.toThrow("Metadata field 'threadId' is required for upsert");
  });

  it('wraps unexpected DB errors in StorageError', async () => {
    dbMock.selectResult.mockRejectedValue(new Error('Connection refused'));

    await expect(
      storePensieveEntryUpsert('content', 'gmail', baseMeta, 'threadId'),
    ).rejects.toThrow(StorageError);
    await expect(
      storePensieveEntryUpsert('content', 'gmail', baseMeta, 'threadId'),
    ).rejects.toThrow('Failed to upsert pensieve entry');
  });
});
