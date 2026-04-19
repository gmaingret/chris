import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * RETR-05 + RETR-06 Boundary Audit
 *
 * D031 separates structured facts (pensieveEntries epistemic tags + ground-truth)
 * from interpretation (episodic_summaries). This audit proves two invariants:
 *
 * 1. RETR-05 — The Known Facts block (built in src/chris/personality.ts from
 *    src/pensieve/ground-truth.ts) never references episodic_summaries. Summary
 *    text is interpretation; Known Facts is verbatim fact. Mixing them violates
 *    D031.
 *
 * 2. RETR-06 — The pensieve_embeddings INSERT path (src/pensieve/embeddings.ts)
 *    never references episodic_summaries. Embedding summary text alongside raw
 *    entries competes the interpreted signal with the verbatim signal in
 *    semantic search, displacing the raw emotional signal (PITFALLS #11).
 *
 * These are architectural boundaries. If a future change accidentally wires
 * summaries into either surface, this test fails loudly at CI time with a
 * file:line diagnostic.
 *
 * Design notes:
 * - ESM module: `__dirname` is unavailable, so we resolve via `import.meta.url`.
 * - Tests read source text only — they do not import or execute production code,
 *   so the audit is unaffected by any test-time module hoisting (vi.mock) and
 *   needs no DB or external dependency.
 * - Regex uses word boundaries so identifiers like `episodic_summaries_legacy`
 *   would also match (they start with `episodic_summaries`), but identifiers
 *   that merely *contain* these substrings inside a longer name would not
 *   spuriously match because of the leading `\b`. This is the desired strictness:
 *   any reference to the table or the Drizzle export at all is a violation.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Walk up from src/chris/__tests__/ to project root.
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

async function readSource(relPath: string): Promise<string> {
  return readFile(resolve(PROJECT_ROOT, relPath), 'utf8');
}

/** Search `contents` for any match of /episodic_summaries|episodicSummaries/
 *  with word boundaries. Returns one entry per offending line. */
function findEpisodicReferences(
  contents: string,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Build a fresh regex per line to avoid global-flag lastIndex carryover.
    const matched = /\bepisodic_summaries\b|\bepisodicSummaries\b/.test(line);
    if (matched) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function formatHits(hits: Array<{ line: number; text: string }>): string {
  return hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n');
}

describe('RETR-05: Known Facts boundary (summary text never enters Known Facts block)', () => {
  it('src/chris/personality.ts has zero references to episodic_summaries', async () => {
    const src = await readSource('src/chris/personality.ts');
    const hits = findEpisodicReferences(src);
    expect(
      hits,
      `RETR-05 violation: src/chris/personality.ts references episodic_summaries at:\n` +
        formatHits(hits) +
        '\n\nThe Known Facts block (buildKnownFactsBlock) must ONLY pull from ' +
        'GROUND_TRUTH. Summary text is interpretation, not fact. See D031.',
    ).toEqual([]);
  });

  it('src/pensieve/ground-truth.ts has zero references to episodic_summaries', async () => {
    const src = await readSource('src/pensieve/ground-truth.ts');
    const hits = findEpisodicReferences(src);
    expect(
      hits,
      `RETR-05 violation: src/pensieve/ground-truth.ts references episodic_summaries at:\n` +
        formatHits(hits) +
        '\n\nground-truth.ts is the data source for the Known Facts block. ' +
        'It must contain only verbatim fact, never summary prose. See D031.',
    ).toEqual([]);
  });
});

describe('RETR-06: pensieve_embeddings boundary (summary text never embedded)', () => {
  it('src/pensieve/embeddings.ts has zero references to episodic_summaries', async () => {
    const src = await readSource('src/pensieve/embeddings.ts');
    const hits = findEpisodicReferences(src);
    expect(
      hits,
      `RETR-06 violation: src/pensieve/embeddings.ts references episodic_summaries at:\n` +
        formatHits(hits) +
        '\n\nThe pensieve_embeddings INSERT path must only embed raw pensieve_entries. ' +
        'Embedding summary text pollutes semantic search by competing with verbatim ' +
        'entries. See PITFALLS #11 and D031.',
    ).toEqual([]);
  });

  it('src/pensieve/embeddings.ts INSERT statements reference only pensieveEmbeddings.entryId (no episodic content)', async () => {
    const src = await readSource('src/pensieve/embeddings.ts');
    // Match db.insert(pensieveEmbeddings).values({ ... })
    // Non-greedy multiline match captures the full call site.
    const insertBlocks = src.match(/db\.insert\(pensieveEmbeddings\)[\s\S]*?\)/g) ?? [];
    expect(
      insertBlocks.length,
      'expected at least one db.insert(pensieveEmbeddings) site to exist in embeddings.ts ' +
        '(if this changes, the audit pattern must be updated)',
    ).toBeGreaterThanOrEqual(1);
    for (const block of insertBlocks) {
      expect(
        /episodic/i.test(block),
        `RETR-06 violation: an INSERT into pensieveEmbeddings references episodic content:\n${block}\n\n` +
          `Only pensieve_entries content should be embedded. See D031 + PITFALLS #11.`,
      ).toBe(false);
    }
  });
});
