import { PDFParse } from 'pdf-parse';
import { FileExtractionError } from './errors.js';

/** MIME types that can be read as plain UTF-8 text. */
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

export interface ExtractedText {
  text: string;
  pageCount?: number;
}

/**
 * Extract text from a file buffer based on its MIME type.
 *
 * Supports PDF (via pdf-parse) and plain text formats.
 * Throws FileExtractionError for unsupported types or extraction failures.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedText> {
  if (mimeType === 'application/pdf') {
    return extractPdf(buffer);
  }

  if (TEXT_MIME_TYPES.has(mimeType)) {
    return { text: buffer.toString('utf-8') };
  }

  throw new FileExtractionError(
    `Unsupported file type: ${mimeType}. I can read PDFs, plain text, Markdown, CSV, and JSON files.`,
  );
}

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return {
      text: result.text,
      pageCount: result.total,
    };
  } catch (error) {
    throw new FileExtractionError(
      'Failed to extract text from PDF — the file may be corrupted or password-protected.',
      error,
    );
  }
}
