#!/usr/bin/env tsx
/**
 * scripts/validate-journal-monotonic.ts — Phase 32 item #3.
 *
 * CI guardrail asserting that `src/db/migrations/meta/_journal.json` entries
 * are monotonically non-decreasing in their `when` (unix-ms) field. Drizzle
 * applies migrations in entries-array order, but the `when` field ALSO
 * influences ordering when migrations are sorted on read; a year-stale typo
 * (be22af0 in this repo) caused exactly that class of bug. The fix is
 * tested-in-CI: any future stale-`when` typo trips this gate before it can
 * ship.
 *
 * Exit codes:
 *   0 — all entries strictly monotonic non-decreasing
 *   1 — non-monotonic detected (prints offending pair + remediation hint)
 *   2 — file cannot be read or parsed
 *
 * Invoked by scripts/test.sh as a pre-migration gate. Also safe to run
 * standalone: `npx tsx scripts/validate-journal-monotonic.ts`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JOURNAL_PATH = resolve(
  process.cwd(),
  'src/db/migrations/meta/_journal.json',
);

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function main(): void {
  let raw: string;
  try {
    raw = readFileSync(JOURNAL_PATH, 'utf-8');
  } catch (err) {
    console.error(`❌ Cannot read ${JOURNAL_PATH}: ${(err as Error).message}`);
    process.exit(2);
  }

  let parsed: JournalFile;
  try {
    parsed = JSON.parse(raw) as JournalFile;
  } catch (err) {
    console.error(`❌ Cannot parse ${JOURNAL_PATH}: ${(err as Error).message}`);
    process.exit(2);
  }

  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    console.error(`❌ ${JOURNAL_PATH} has no entries[]`);
    process.exit(2);
  }

  for (let i = 1; i < parsed.entries.length; i++) {
    const prev = parsed.entries[i - 1]!;
    const curr = parsed.entries[i]!;
    if (typeof prev.when !== 'number' || typeof curr.when !== 'number') {
      console.error(
        `❌ Entry ${i - 1}/${i} (${prev.tag} → ${curr.tag}) has non-numeric "when" field`,
      );
      process.exit(1);
    }
    if (curr.when < prev.when) {
      console.error('❌ Migrations journal _journal.json is NON-MONOTONIC.');
      console.error('');
      console.error(`  idx ${prev.idx} (${prev.tag}): when = ${prev.when}`);
      console.error(`    → ${new Date(prev.when).toISOString()}`);
      console.error(`  idx ${curr.idx} (${curr.tag}): when = ${curr.when}`);
      console.error(`    → ${new Date(curr.when).toISOString()}`);
      console.error('');
      console.error(
        'A later entry has an EARLIER `when` than its predecessor. This is the',
      );
      console.error(
        'class of bug that shipped to prod in commit be22af0 (a year-stale `when`',
      );
      console.error(
        'typo broke drizzle migration ordering). Fix the "when" value of the',
      );
      console.error(
        'newer entry to be >= its predecessor (typically Date.now() at commit time).',
      );
      process.exit(1);
    }
  }

  console.log(
    `✓ Migrations journal _journal.json monotonicity verified (${parsed.entries.length} entries)`,
  );
}

main();
