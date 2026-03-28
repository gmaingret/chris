import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriveSyncError } from '../../utils/errors.js';

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Build a mock Drive client ──────────────────────────────────────────────
function createMockDrive() {
  return {
    files: {
      list: vi.fn(),
      export: vi.fn(),
      get: vi.fn(),
    },
    changes: {
      getStartPageToken: vi.fn(),
      list: vi.fn(),
    },
  };
}

// ── Import module under test ───────────────────────────────────────────────
import {
  listFiles,
  exportFileAsText,
  getStartPageToken,
  getChanges,
} from '../client.js';

describe('drive/client', () => {
  let drive: ReturnType<typeof createMockDrive>;

  beforeEach(() => {
    vi.clearAllMocks();
    drive = createMockDrive();
  });

  describe('listFiles', () => {
    it('returns files matching supported MIME types', async () => {
      drive.files.list.mockResolvedValue({
        data: {
          files: [
            { id: 'doc-1', name: 'My Doc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2025-01-01T00:00:00Z' },
            { id: 'sheet-1', name: 'My Sheet', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2025-01-02T00:00:00Z' },
          ],
          nextPageToken: 'page2token',
        },
      });

      const result = await listFiles(drive as any);

      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({
        id: 'doc-1',
        name: 'My Doc',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: '2025-01-01T00:00:00Z',
      });
      expect(result.nextPageToken).toBe('page2token');
      expect(drive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('trashed=false'),
          fields: expect.stringContaining('files(id, name, mimeType, modifiedTime)'),
        }),
      );
    });

    it('handles pagination with pageToken', async () => {
      drive.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: null },
      });

      const result = await listFiles(drive as any, 'page2token');

      expect(result.files).toHaveLength(0);
      expect(result.nextPageToken).toBeNull();
      expect(drive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: 'page2token' }),
      );
    });

    it('handles empty results', async () => {
      drive.files.list.mockResolvedValue({
        data: { files: undefined, nextPageToken: undefined },
      });

      const result = await listFiles(drive as any);

      expect(result.files).toHaveLength(0);
      expect(result.nextPageToken).toBeNull();
    });

    it('wraps API errors in DriveSyncError', async () => {
      drive.files.list.mockRejectedValue(new Error('API quota exceeded'));

      await expect(listFiles(drive as any)).rejects.toThrow(DriveSyncError);
      await expect(listFiles(drive as any)).rejects.toThrow('Failed to list Drive files');
    });
  });

  describe('exportFileAsText', () => {
    it('exports Google Doc as text/plain', async () => {
      drive.files.export.mockResolvedValue({ data: 'Hello document content' });

      const text = await exportFileAsText(drive as any, 'doc-1', 'application/vnd.google-apps.document');

      expect(text).toBe('Hello document content');
      expect(drive.files.export).toHaveBeenCalledWith({
        fileId: 'doc-1',
        mimeType: 'text/plain',
      });
    });

    it('exports Google Sheet as text/csv', async () => {
      drive.files.export.mockResolvedValue({ data: 'col1,col2\nval1,val2' });

      const text = await exportFileAsText(drive as any, 'sheet-1', 'application/vnd.google-apps.spreadsheet');

      expect(text).toBe('col1,col2\nval1,val2');
      expect(drive.files.export).toHaveBeenCalledWith({
        fileId: 'sheet-1',
        mimeType: 'text/csv',
      });
    });

    it('downloads text/plain file directly via media', async () => {
      drive.files.get.mockResolvedValue({ data: 'plain text content' });

      const text = await exportFileAsText(drive as any, 'txt-1', 'text/plain');

      expect(text).toBe('plain text content');
      expect(drive.files.get).toHaveBeenCalledWith(
        { fileId: 'txt-1', alt: 'media' },
        { responseType: 'text' },
      );
    });

    it('downloads text/markdown file directly via media', async () => {
      drive.files.get.mockResolvedValue({ data: '# Markdown heading' });

      const text = await exportFileAsText(drive as any, 'md-1', 'text/markdown');

      expect(text).toBe('# Markdown heading');
      expect(drive.files.get).toHaveBeenCalledWith(
        { fileId: 'md-1', alt: 'media' },
        { responseType: 'text' },
      );
    });

    it('downloads text/csv file directly via media', async () => {
      drive.files.get.mockResolvedValue({ data: 'a,b\n1,2' });

      const text = await exportFileAsText(drive as any, 'csv-1', 'text/csv');

      expect(text).toBe('a,b\n1,2');
    });

    it('wraps export errors in DriveSyncError', async () => {
      drive.files.export.mockRejectedValue(new Error('Not Found'));

      await expect(
        exportFileAsText(drive as any, 'bad-id', 'application/vnd.google-apps.document'),
      ).rejects.toThrow(DriveSyncError);
      await expect(
        exportFileAsText(drive as any, 'bad-id', 'application/vnd.google-apps.document'),
      ).rejects.toThrow('Failed to export file bad-id');
    });
  });

  describe('getStartPageToken', () => {
    it('returns the start page token string', async () => {
      drive.changes.getStartPageToken.mockResolvedValue({
        data: { startPageToken: '12345' },
      });

      const token = await getStartPageToken(drive as any);

      expect(token).toBe('12345');
    });

    it('throws DriveSyncError when token is missing', async () => {
      drive.changes.getStartPageToken.mockResolvedValue({
        data: { startPageToken: null },
      });

      await expect(getStartPageToken(drive as any)).rejects.toThrow(DriveSyncError);
      await expect(getStartPageToken(drive as any)).rejects.toThrow('returned no startPageToken');
    });

    it('wraps API errors in DriveSyncError', async () => {
      drive.changes.getStartPageToken.mockRejectedValue(new Error('auth error'));

      await expect(getStartPageToken(drive as any)).rejects.toThrow(DriveSyncError);
    });
  });

  describe('getChanges', () => {
    it('returns changes and new start page token', async () => {
      drive.changes.list.mockResolvedValue({
        data: {
          changes: [
            {
              fileId: 'doc-1',
              file: { id: 'doc-1', name: 'Updated Doc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2025-06-01T00:00:00Z' },
              removed: false,
            },
          ],
          newStartPageToken: '67890',
        },
      });

      const result = await getChanges(drive as any, '12345');

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toEqual({
        fileId: 'doc-1',
        file: {
          id: 'doc-1',
          name: 'Updated Doc',
          mimeType: 'application/vnd.google-apps.document',
          modifiedTime: '2025-06-01T00:00:00Z',
        },
        removed: false,
      });
      expect(result.newStartPageToken).toBe('67890');
      expect(drive.changes.list).toHaveBeenCalledWith(
        expect.objectContaining({
          pageToken: '12345',
          includeRemoved: true,
        }),
      );
    });

    it('handles removed files (file is null)', async () => {
      drive.changes.list.mockResolvedValue({
        data: {
          changes: [
            { fileId: 'deleted-1', file: null, removed: true },
          ],
          newStartPageToken: '67891',
        },
      });

      const result = await getChanges(drive as any, '12345');

      expect(result.changes[0]).toEqual({
        fileId: 'deleted-1',
        file: null,
        removed: true,
      });
    });

    it('handles empty changes', async () => {
      drive.changes.list.mockResolvedValue({
        data: {
          changes: undefined,
          newStartPageToken: '12345',
        },
      });

      const result = await getChanges(drive as any, '12345');

      expect(result.changes).toHaveLength(0);
      expect(result.newStartPageToken).toBe('12345');
    });

    it('wraps API errors in DriveSyncError', async () => {
      drive.changes.list.mockRejectedValue(new Error('invalid token'));

      await expect(getChanges(drive as any, 'bad-token')).rejects.toThrow(DriveSyncError);
      await expect(getChanges(drive as any, 'bad-token')).rejects.toThrow('Failed to get Drive changes');
    });
  });
});
