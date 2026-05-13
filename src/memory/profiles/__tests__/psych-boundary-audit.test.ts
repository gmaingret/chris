/**
 * Phase 37 Plan 37-02 Task 4 (PSCH-10) — psychological/operational boundary audit
 *
 * Two-directional vocabulary regex sweep enforcing D047 at CI time:
 *
 *   1. OPERATIONAL_VOCAB MUST NOT appear in the two psychological-substrate
 *      files (psychological-schemas + psychological-shared).
 *
 *   2. PSYCHOLOGICAL_VOCAB MUST NOT appear in the eight operational-substrate
 *      files (profile-prompt, profile-updater, profiles/shared, profiles/
 *      schemas, plus the four per-dimension generators).
 *
 * Self-allowlist by absence (D-34): this audit file is NOT listed in either
 * array; it intentionally contains both vocabularies (in the regex literals
 * and in the file-list literals) and would otherwise self-flag.
 *
 * Cross-vocabulary reading is permitted in the top-level profiles module —
 * that module is the orchestration hub for both M010 and M011 readers
 * (D-21), intentionally contains both vocabularies, and is omitted from
 * both arrays below.
 *
 * Pitfall 6 (false positive on comments / docstrings) is accepted: the
 * vocabularies are domain nouns unlikely to appear coincidentally in
 * operational/psychological documentation. If a false-positive surfaces in
 * the future, remediation = rename the offending docstring word in the
 * source file, NOT relax the regex. The locked-narrow vocab list minimizes
 * false-positive risk.
 *
 * Test count: 2 psychological-file checks + 8 operational-file checks = 10
 * `it` cases; runtime <1s (fs.readFile + line-by-line regex scan only).
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Depth 4: src/memory/profiles/__tests__/ → src/memory/profiles → src/memory
// → src → project root.
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

async function readSource(relPath: string): Promise<string> {
  return readFile(resolve(PROJECT_ROOT, relPath), 'utf8');
}

/**
 * Per-line regex scan. Returns one `{line, text}` entry per offending line.
 * Word-boundary regex (`\b...\b`) so identifiers that merely *contain* the
 * vocab substring inside a longer name don't match (intent: any standalone
 * reference to the domain noun at all is a violation).
 */
function findHits(
  contents: string,
  pattern: RegExp,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Build a fresh regex per call to avoid global-flag lastIndex carryover.
    if (pattern.test(line)) {
      hits.push({ line: i + 1, text: line.trim() });
    }
  }
  return hits;
}

function formatHits(hits: Array<{ line: number; text: string }>): string {
  return hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n');
}

const OPERATIONAL_VOCAB = /\b(jurisdictional|capital|health|family)\b/;
const PSYCHOLOGICAL_VOCAB = /\b(hexaco|schwartz|attachment)\b/;

// 2 psychological substrate files. The top-level profiles module is
// intentionally omitted (D-21 — it contains both vocabs by design as the
// M010+M011 orchestration hub). This audit file itself intentionally
// omitted (self-allowlist by absence per D-34).
const PSYCHOLOGICAL_FILES = [
  'src/memory/profiles/psychological-schemas.ts',
  'src/memory/profiles/psychological-shared.ts',
];

// 8 operational substrate files. Top-level profiles module again
// intentionally omitted (D-21) — see comment on PSYCHOLOGICAL_FILES above.
const OPERATIONAL_FILES = [
  'src/memory/profile-prompt.ts',
  'src/memory/profile-updater.ts',
  'src/memory/profiles/shared.ts',
  'src/memory/profiles/schemas.ts',
  'src/memory/profiles/jurisdictional.ts',
  'src/memory/profiles/capital.ts',
  'src/memory/profiles/health.ts',
  'src/memory/profiles/family.ts',
];

describe('PSCH-10: D047 boundary — operational vocab forbidden in psychological files', () => {
  for (const file of PSYCHOLOGICAL_FILES) {
    it(`${file} has zero operational-vocabulary references`, async () => {
      const src = await readSource(file);
      const hits = findHits(src, OPERATIONAL_VOCAB);
      expect(
        hits,
        `D047 violation: ${file} references operational vocabulary at:\n` +
          formatHits(hits) +
          '\n\nPsychological profile files must not reference operational ' +
          'profile dimensions. Cross-reading is permitted via profiles.ts; ' +
          'cross-writing in shared substrate is forbidden.',
      ).toEqual([]);
    });
  }
});

describe('PSCH-10: D047 boundary — psychological vocab forbidden in operational files', () => {
  for (const file of OPERATIONAL_FILES) {
    it(`${file} has zero psychological-vocabulary references`, async () => {
      const src = await readSource(file);
      const hits = findHits(src, PSYCHOLOGICAL_VOCAB);
      expect(
        hits,
        `D047 violation: ${file} references psychological vocabulary at:\n` +
          formatHits(hits) +
          '\n\nOperational profile files must not reference psychological ' +
          'profile dimensions. Cross-writing in shared substrate is forbidden.',
      ).toEqual([]);
    });
  }
});
