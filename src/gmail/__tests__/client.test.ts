import { describe, it, expect, vi } from 'vitest';
import { listThreads, getThread, extractMessageBody, getMessageHeader } from '../client.js';

// Helper to create a mock Gmail API
function createMockGmail(overrides: Record<string, unknown> = {}) {
  return {
    users: {
      threads: {
        list: vi.fn(),
        get: vi.fn(),
        ...overrides,
      },
    },
  } as any;
}

// Helper to base64url-encode a string
function b64url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

describe('gmail client', () => {
  describe('listThreads', () => {
    it('lists threads with a query', async () => {
      const gmail = createMockGmail();
      gmail.users.threads.list.mockResolvedValue({
        data: {
          threads: [{ id: 't1', snippet: 'Hello' }],
          nextPageToken: null,
        },
      });

      const result = await listThreads(gmail, 'after:2025/01/01');

      expect(gmail.users.threads.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'after:2025/01/01',
        pageToken: undefined,
        maxResults: 100,
      });
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].id).toBe('t1');
    });

    it('passes pageToken for pagination', async () => {
      const gmail = createMockGmail();
      gmail.users.threads.list.mockResolvedValue({
        data: {
          threads: [{ id: 't2' }],
          nextPageToken: 'page3',
        },
      });

      const result = await listThreads(gmail, 'q', 'page2');

      expect(gmail.users.threads.list).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: 'page2' }),
      );
      expect(result.nextPageToken).toBe('page3');
    });

    it('returns empty array when no threads', async () => {
      const gmail = createMockGmail();
      gmail.users.threads.list.mockResolvedValue({
        data: { threads: undefined, nextPageToken: null },
      });

      const result = await listThreads(gmail, 'q');
      expect(result.threads).toEqual([]);
    });
  });

  describe('getThread', () => {
    it('fetches thread with full format', async () => {
      const gmail = createMockGmail();
      const threadData = { id: 't1', messages: [{ id: 'm1' }] };
      gmail.users.threads.get.mockResolvedValue({ data: threadData });

      const result = await getThread(gmail, 't1');

      expect(gmail.users.threads.get).toHaveBeenCalledWith({
        userId: 'me',
        id: 't1',
        format: 'full',
      });
      expect(result).toEqual(threadData);
    });
  });

  describe('getMessageHeader', () => {
    it('extracts header by name (case-insensitive)', () => {
      const msg = {
        payload: {
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'Subject', value: 'Test email' },
          ],
        },
      } as any;

      expect(getMessageHeader(msg, 'from')).toBe('alice@example.com');
      expect(getMessageHeader(msg, 'Subject')).toBe('Test email');
    });

    it('returns undefined for missing header', () => {
      const msg = { payload: { headers: [] } } as any;
      expect(getMessageHeader(msg, 'X-Missing')).toBeUndefined();
    });

    it('returns undefined for missing payload', () => {
      const msg = {} as any;
      expect(getMessageHeader(msg, 'From')).toBeUndefined();
    });
  });

  describe('extractMessageBody', () => {
    it('extracts text/plain body from simple message', () => {
      const msg = {
        payload: {
          mimeType: 'text/plain',
          body: { data: b64url('Hello world') },
        },
      } as any;

      expect(extractMessageBody(msg)).toBe('Hello world');
    });

    it('extracts text/html body and converts to text', () => {
      const msg = {
        payload: {
          mimeType: 'text/html',
          body: { data: b64url('<p>Hello <b>world</b></p>') },
        },
      } as any;

      const result = extractMessageBody(msg);
      expect(result).toContain('Hello');
      expect(result).toContain('world');
      // Should not contain HTML tags
      expect(result).not.toContain('<p>');
      expect(result).not.toContain('<b>');
    });

    it('prefers text/plain in multipart/alternative', () => {
      const msg = {
        payload: {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: b64url('Plain text version') },
            },
            {
              mimeType: 'text/html',
              body: { data: b64url('<p>HTML version</p>') },
            },
          ],
        },
      } as any;

      expect(extractMessageBody(msg)).toBe('Plain text version');
    });

    it('falls back to HTML when no text/plain in multipart', () => {
      const msg = {
        payload: {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/html',
              body: { data: b64url('<p>Only HTML</p>') },
            },
          ],
        },
      } as any;

      const result = extractMessageBody(msg);
      expect(result).toContain('Only HTML');
      expect(result).not.toContain('<p>');
    });

    it('handles nested multipart structures', () => {
      const msg = {
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: b64url('Nested plain text') },
                },
                {
                  mimeType: 'text/html',
                  body: { data: b64url('<p>Nested HTML</p>') },
                },
              ],
            },
            {
              mimeType: 'application/pdf',
              filename: 'doc.pdf',
              body: { data: b64url('fake-pdf-data'), attachmentId: 'att1' },
            },
          ],
        },
      } as any;

      expect(extractMessageBody(msg)).toBe('Nested plain text');
    });

    it('skips attachment parts', () => {
      const msg = {
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: b64url('Message body') },
            },
            {
              mimeType: 'image/png',
              filename: 'photo.png',
              body: { attachmentId: 'att1' },
            },
          ],
        },
      } as any;

      expect(extractMessageBody(msg)).toBe('Message body');
    });

    it('returns empty string for message with no payload', () => {
      expect(extractMessageBody({} as any)).toBe('');
    });

    it('returns empty string for message with no text parts', () => {
      const msg = {
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            {
              mimeType: 'image/png',
              body: { attachmentId: 'att1' },
            },
          ],
        },
      } as any;

      expect(extractMessageBody(msg)).toBe('');
    });
  });
});
