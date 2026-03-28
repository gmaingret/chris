import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 hex digest of the given content string.
 * Used for content-hash deduplication of pensieve entries.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}
