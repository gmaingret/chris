import { gmail_v1 } from 'googleapis';
import { extractMessageBody, getMessageHeader } from './client.js';

type GmailThread = gmail_v1.Schema$Thread;
type GmailMessage = gmail_v1.Schema$Message;

export interface CollapsedThread {
  text: string;
  subject: string;
  participants: string[];
}

/**
 * Strip quoted reply blocks from an email body.
 * Removes:
 * - Lines starting with `>` (standard quote markers)
 * - Everything after `On ... wrote:` patterns
 * - Everything after `---------- Forwarded message ----------`
 */
export function stripQuotedReplies(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    // Stop at "On ... wrote:" patterns (common in Gmail)
    if (/^On .+ wrote:\s*$/.test(line)) {
      break;
    }

    // Stop at forwarded message delimiter
    if (line.trim() === '---------- Forwarded message ----------') {
      break;
    }

    // Skip quoted lines (starting with >)
    if (/^>/.test(line.trim())) {
      continue;
    }

    result.push(line);
  }

  return result.join('\n').trim();
}

/**
 * Collapse a Gmail thread (multiple messages) into a single chronological
 * text entry suitable for storage and embedding.
 *
 * Format:
 *   Subject: [subject]
 *
 *   --- [sender] (YYYY-MM-DD HH:MM) ---
 *   [body]
 *
 *   --- [sender] (YYYY-MM-DD HH:MM) ---
 *   [body]
 */
export function collapseThread(thread: GmailThread): CollapsedThread {
  const messages = thread.messages ?? [];
  const subject = messages.length > 0
    ? (getMessageHeader(messages[0], 'Subject') ?? '(no subject)')
    : '(no subject)';

  const participantSet = new Set<string>();
  const sections: string[] = [];

  // Sort messages chronologically by internalDate
  const sorted = [...messages].sort((a, b) => {
    const dateA = Number(a.internalDate ?? 0);
    const dateB = Number(b.internalDate ?? 0);
    return dateA - dateB;
  });

  for (const message of sorted) {
    const sender = getMessageHeader(message, 'From') ?? 'Unknown';
    participantSet.add(sender);

    const dateMs = Number(message.internalDate ?? 0);
    const date = dateMs > 0
      ? formatDate(new Date(dateMs))
      : 'Unknown date';

    const body = stripQuotedReplies(extractMessageBody(message));
    if (!body) continue;

    sections.push(`--- ${sender} (${date}) ---\n${body}`);
  }

  const text = `Subject: ${subject}\n\n${sections.join('\n\n')}`;

  return {
    text,
    subject,
    participants: [...participantSet],
  };
}

/**
 * Format a Date as YYYY-MM-DD HH:MM in UTC.
 */
function formatDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
