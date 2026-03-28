import { describe, it, expect } from 'vitest';
import { collapseThread, stripQuotedReplies } from '../collapse.js';

// Helper to base64url-encode a string
function b64url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function makeMessage(opts: {
  from?: string;
  subject?: string;
  body?: string;
  date?: number;
  mimeType?: string;
}) {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    internalDate: String(opts.date ?? Date.now()),
    payload: {
      mimeType: opts.mimeType ?? 'text/plain',
      headers: [
        { name: 'From', value: opts.from ?? 'alice@example.com' },
        { name: 'Subject', value: opts.subject ?? 'Test Subject' },
      ],
      body: { data: b64url(opts.body ?? '') },
    },
  };
}

describe('collapse', () => {
  describe('stripQuotedReplies', () => {
    it('removes > prefixed lines', () => {
      const text = 'My reply\n> Previous message\n> More quoted\nAfter quotes';
      expect(stripQuotedReplies(text)).toBe('My reply\nAfter quotes');
    });

    it('stops at On ... wrote: pattern', () => {
      const text = 'My reply\n\nOn Mon, Jan 1, 2025 at 10:00 AM Alice <alice@example.com> wrote:\n> Old message';
      expect(stripQuotedReplies(text)).toBe('My reply');
    });

    it('stops at forwarded message delimiter', () => {
      const text = 'Before forward\n---------- Forwarded message ----------\nForwarded content';
      expect(stripQuotedReplies(text)).toBe('Before forward');
    });

    it('handles text with no quotes', () => {
      const text = 'Just a normal message\nWith multiple lines';
      expect(stripQuotedReplies(text)).toBe('Just a normal message\nWith multiple lines');
    });

    it('handles empty text', () => {
      expect(stripQuotedReplies('')).toBe('');
    });
  });

  describe('collapseThread', () => {
    it('collapses a single-message thread', () => {
      const thread = {
        id: 't1',
        messages: [
          makeMessage({
            from: 'alice@example.com',
            subject: 'Hello',
            body: 'Hi there!',
            date: 1704067200000, // 2024-01-01 00:00 UTC
          }),
        ],
      };

      const result = collapseThread(thread);

      expect(result.subject).toBe('Hello');
      expect(result.participants).toEqual(['alice@example.com']);
      expect(result.text).toContain('Subject: Hello');
      expect(result.text).toContain('--- alice@example.com (2024-01-01 00:00) ---');
      expect(result.text).toContain('Hi there!');
    });

    it('collapses a multi-message thread chronologically', () => {
      const thread = {
        id: 't2',
        messages: [
          makeMessage({
            from: 'bob@example.com',
            subject: 'Re: Hello',
            body: 'Reply from Bob',
            date: 1704153600000, // 2024-01-02 00:00 UTC
          }),
          makeMessage({
            from: 'alice@example.com',
            subject: 'Hello',
            body: 'Original from Alice',
            date: 1704067200000, // 2024-01-01 00:00 UTC
          }),
        ],
      };

      const result = collapseThread(thread);

      // Should be sorted chronologically (Alice first, Bob second)
      const aliceIndex = result.text.indexOf('alice@example.com');
      const bobIndex = result.text.indexOf('bob@example.com');
      expect(aliceIndex).toBeLessThan(bobIndex);
      expect(result.participants).toContain('alice@example.com');
      expect(result.participants).toContain('bob@example.com');
    });

    it('extracts subject from first message', () => {
      const thread = {
        id: 't3',
        messages: [
          makeMessage({ subject: 'Important Topic', body: 'Content' }),
        ],
      };

      expect(collapseThread(thread).subject).toBe('Important Topic');
    });

    it('handles thread with no messages', () => {
      const result = collapseThread({ id: 't4', messages: [] });
      expect(result.subject).toBe('(no subject)');
      expect(result.participants).toEqual([]);
    });

    it('handles HTML-only messages', () => {
      const thread = {
        id: 't5',
        messages: [
          makeMessage({
            body: '<p>HTML content</p>',
            mimeType: 'text/html',
            date: 1704067200000,
          }),
        ],
      };

      const result = collapseThread(thread);
      expect(result.text).toContain('HTML content');
      expect(result.text).not.toContain('<p>');
    });

    it('strips quoted replies from messages', () => {
      const thread = {
        id: 't6',
        messages: [
          makeMessage({
            from: 'alice@example.com',
            body: 'Original message',
            date: 1704067200000,
          }),
          makeMessage({
            from: 'bob@example.com',
            body: 'My reply\n\nOn Mon wrote:\n> Original message',
            date: 1704153600000,
          }),
        ],
      };

      const result = collapseThread(thread);
      // Bob's section should only contain "My reply", not the quoted original
      const bobSection = result.text.split('bob@example.com')[1];
      expect(bobSection).toContain('My reply');
      expect(bobSection).not.toContain('Original message');
    });

    it('skips messages with empty body after stripping', () => {
      const thread = {
        id: 't7',
        messages: [
          makeMessage({
            from: 'alice@example.com',
            body: 'Real content',
            date: 1704067200000,
          }),
          makeMessage({
            from: 'bob@example.com',
            body: '',
            date: 1704153600000,
          }),
        ],
      };

      const result = collapseThread(thread);
      // Should only have Alice's section, not an empty Bob section
      expect(result.text).not.toContain('bob@example.com');
    });
  });
});
