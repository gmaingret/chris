import { gmail_v1 } from 'googleapis';
import { convert } from 'html-to-text';
import { logger } from '../utils/logger.js';

type Gmail = gmail_v1.Gmail;
type GmailMessage = gmail_v1.Schema$Message;
type GmailMessagePart = gmail_v1.Schema$MessagePart;

/**
 * List Gmail threads matching a query with pagination support.
 * Returns thread stubs (id + snippet) and an optional nextPageToken.
 */
export async function listThreads(
  gmail: Gmail,
  query: string,
  pageToken?: string,
): Promise<{ threads: gmail_v1.Schema$Thread[]; nextPageToken?: string | null }> {
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: query,
    pageToken: pageToken ?? undefined,
    maxResults: 100,
  });

  return {
    threads: res.data.threads ?? [],
    nextPageToken: res.data.nextPageToken,
  };
}

/**
 * Fetch full thread detail including all messages with MIME payloads.
 */
export async function getThread(
  gmail: Gmail,
  threadId: string,
): Promise<gmail_v1.Schema$Thread> {
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return res.data;
}

/**
 * Extract a named header value from a Gmail message's payload.headers[].
 */
export function getMessageHeader(
  message: GmailMessage,
  headerName: string,
): string | undefined {
  const headers = message.payload?.headers ?? [];
  const header = headers.find(
    (h) => h.name?.toLowerCase() === headerName.toLowerCase(),
  );
  return header?.value ?? undefined;
}

/**
 * Recursively walk MIME parts to extract the text body.
 * Prefers text/plain over text/html. Falls back to html-to-text conversion.
 */
export function extractMessageBody(message: GmailMessage): string {
  const payload = message.payload;
  if (!payload) return '';

  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  walkParts(payload, plainParts, htmlParts);

  // Prefer plain text
  if (plainParts.length > 0) {
    return plainParts.join('\n');
  }

  // Fall back to converted HTML
  if (htmlParts.length > 0) {
    return htmlParts
      .map((html) =>
        convert(html, {
          wordwrap: false,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        }),
      )
      .join('\n');
  }

  return '';
}

/**
 * Recursive MIME part walker that collects text/plain and text/html bodies.
 * Handles: simple messages (body on payload), multipart/alternative,
 * nested multipart, and skips non-text attachments.
 */
function walkParts(
  part: GmailMessagePart,
  plainParts: string[],
  htmlParts: string[],
): void {
  const mimeType = part.mimeType ?? '';

  // Leaf node with body data
  if (part.body?.data) {
    const decoded = Buffer.from(part.body.data, 'base64url').toString('utf-8');
    if (mimeType === 'text/plain') {
      plainParts.push(decoded);
    } else if (mimeType === 'text/html') {
      htmlParts.push(decoded);
    }
    // Skip other MIME types (attachments, images, etc.)
    return;
  }

  // Container node — recurse into parts
  if (part.parts) {
    for (const subPart of part.parts) {
      walkParts(subPart, plainParts, htmlParts);
    }
  }
}
