/**
 * Phase 39 Plan 39-01 — COACH psychological-isolation negative invariant (PSURF-05).
 *
 * D-14 + REQUIREMENTS.md PSURF-05: src/chris/modes/coach.ts MUST NOT reference any
 * psychological-profile vocabulary. Trait → coaching-conclusion is circular reasoning
 * ("you should X because you score high on Y"); injecting psychological profiles into
 * COACH violates D027 (the Hard Rule) per PITFALLS.md §1 — sycophancy injection via
 * profile authority framing is the load-bearing M011 risk this test guards against.
 *
 * Test mechanism: readFile + per-line regex sweep over a codebase-specific vocabulary
 * pattern. Fails LOUD with the offending line numbers + a remediation hint pointing at
 * REFLECT/PSYCHOLOGY as the correct injection sites.
 *
 * Structural mirror: src/memory/profiles/__tests__/psych-boundary-audit.test.ts (PSCH-10).
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Depth 4: src/chris/modes/__tests__/ → src/chris/modes → src/chris → src → project root.
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
    if (pattern.test(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function formatHits(hits: Array<{ line: number; text: string }>): string {
  return hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n');
}

// Codebase-specific identifiers — NOT generic words ("profile", "trait") which
// legitimately appear in operational coach.ts. Word boundaries (\b) prevent
// partial-token matches.
const PSYCH_VOCAB =
  /\b(psychological|getPsychologicalProfiles|formatPsychologicalProfilesForPrompt|hexaco|schwartz|attachment|HEXACO|SCHWARTZ|ATTACHMENT|PSYCHOLOGICAL_PROFILE_INJECTION_MAP|PSYCHOLOGICAL_HARD_RULE_EXTENSION)\b/;

const COACH_FILE = 'src/chris/modes/coach.ts';

describe('PSURF-05: COACH handler is psychological-profile-isolated (D027 Hard Rule)', () => {
  it(`${COACH_FILE} contains zero psychological-vocabulary references`, async () => {
    const src = await readSource(COACH_FILE);
    const hits = findHits(src, PSYCH_VOCAB);
    expect(
      hits,
      `D027 Hard Rule violation: ${COACH_FILE} references psychological-profile vocabulary at:\n` +
        formatHits(hits) +
        '\n\nCOACH must NOT inject psychological profiles. Trait → coaching-conclusion is ' +
        'circular reasoning ("you should X because you score high on Y"). See PITFALLS.md §1 ' +
        '(D027 sycophancy injection via profile authority framing) and PROJECT.md D027.\n\n' +
        'If you need coaching to use psychological data, route through REFLECT or PSYCHOLOGY ' +
        '(both ARE wired for psychological injection per PSURF-03). Do NOT weaken this boundary.',
    ).toEqual([]);
  });
});
