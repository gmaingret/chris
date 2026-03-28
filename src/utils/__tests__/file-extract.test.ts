import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileExtractionError } from '../../utils/errors.js';

// ── Mock pdf-parse ─────────────────────────────────────────────────────────
const mockGetText = vi.fn();
const mockDestroy = vi.fn();

vi.mock('pdf-parse', () => {
  class MockPDFParse {
    getText = mockGetText;
    destroy = mockDestroy;
  }
  return { PDFParse: MockPDFParse };
});

// ── Import after mocks ────────────────────────────────────────────────────
const { extractText } = await import('../file-extract.js');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('file extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PDF extraction', () => {
    it('extracts text and page count from a PDF buffer', async () => {
      mockGetText.mockResolvedValueOnce({
        text: 'Hello world from PDF',
        total: 3,
        pages: [],
      });

      const result = await extractText(
        Buffer.from('fake-pdf-content'),
        'application/pdf',
      );

      expect(result.text).toBe('Hello world from PDF');
      expect(result.pageCount).toBe(3);
      expect(mockDestroy).toHaveBeenCalled();
    });

    it('throws FileExtractionError when pdf-parse fails', async () => {
      mockGetText.mockRejectedValueOnce(new Error('corrupt PDF'));

      await expect(
        extractText(Buffer.from('bad'), 'application/pdf'),
      ).rejects.toThrow(FileExtractionError);
    });
  });

  describe('plain text extraction', () => {
    it('extracts text/plain as UTF-8', async () => {
      const content = 'Hello, plain text!';
      const result = await extractText(Buffer.from(content), 'text/plain');
      expect(result.text).toBe(content);
      expect(result.pageCount).toBeUndefined();
    });

    it('extracts text/markdown as UTF-8', async () => {
      const content = '# Heading\n\nParagraph';
      const result = await extractText(Buffer.from(content), 'text/markdown');
      expect(result.text).toBe(content);
    });

    it('extracts text/csv as UTF-8', async () => {
      const content = 'a,b,c\n1,2,3';
      const result = await extractText(Buffer.from(content), 'text/csv');
      expect(result.text).toBe(content);
    });

    it('extracts application/json as UTF-8', async () => {
      const content = '{"key": "value"}';
      const result = await extractText(Buffer.from(content), 'application/json');
      expect(result.text).toBe(content);
    });
  });

  describe('unsupported types', () => {
    it('throws FileExtractionError for image/png', async () => {
      await expect(
        extractText(Buffer.from('pixels'), 'image/png'),
      ).rejects.toThrow(FileExtractionError);
    });

    it('throws FileExtractionError for application/zip', async () => {
      await expect(
        extractText(Buffer.from('zipped'), 'application/zip'),
      ).rejects.toThrow(FileExtractionError);
    });

    it('includes unsupported MIME type in error message', async () => {
      await expect(
        extractText(Buffer.from('data'), 'video/mp4'),
      ).rejects.toThrow(/video\/mp4/);
    });
  });
});
