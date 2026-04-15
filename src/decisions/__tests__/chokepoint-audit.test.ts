/**
 * Wave 0 GREEN test — chokepoint audit.
 *
 * Static/grep-based test (NOT integration — no DB access). Asserts two invariants:
 *   (a) decisions.status is never SET outside src/decisions/lifecycle.ts.
 *   (b) decision_events is append-only: ZERO .update(decisionEvents) or .delete(decisionEvents)
 *       callsites anywhere under src/ (no exemptions — Plan 04 never UPDATEs decision_events).
 *
 * Passes trivially in Wave 0 (no code mutates decisions.status yet). Guards against future
 * drift introduced by Plan 04 / downstream phases.
 *
 * Run: npx vitest run src/decisions/__tests__/chokepoint-audit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Anchor all path comparisons to the repo root (two levels up from this test
// file: src/decisions/__tests__/chokepoint-audit.test.ts). Previously the test
// used bare string prefixes like 'src/decisions/lifecycle.ts', which only
// worked when vitest ran from the repo root; any other CWD would make every
// lifecycle call a false-positive violation. (WR-05)
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const LIFECYCLE_REL = 'src/decisions/lifecycle.ts';

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'migrations' || entry === '__tests__') continue;
      walk(full, files);
    } else if (full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function toRepoRel(abs: string): string {
  return relative(REPO_ROOT, abs).replace(/\\/g, '/');
}

describe('chokepoint audit: decisions.status mutations', () => {
  it('only src/decisions/lifecycle.ts mutates decisions.status', () => {
    const files = walk(SRC_ROOT);
    const violations: string[] = [];
    for (const f of files) {
      const normalized = toRepoRel(f);
      if (normalized === LIFECYCLE_REL) continue;
      const body = readFileSync(f, 'utf8');
      // WR-05: `\bstatus\b\s*:` requires a word boundary so `statusCode:` or
      // `status_note:` do not trip the audit. 200-char window still catches
      // `.set({ ..., status: ... })` patterns in reasonably nested objects.
      if (/\.update\(\s*decisions\s*\)[\s\S]{0,200}?\bstatus\b\s*:/.test(body)) {
        violations.push(`${normalized}: found .update(decisions).set({ status: ... })`);
      }
      if (/UPDATE\s+decisions\s+SET[\s\S]{0,100}?\bstatus\b/i.test(body)) {
        violations.push(`${normalized}: found raw UPDATE decisions SET ... status`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('decision_events is strictly append-only: ZERO .update/.delete callsites anywhere under src/', () => {
    const files = walk(SRC_ROOT);
    const violations: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, 'utf8');
      // No exemption — restructured chokepoint never UPDATEs decisionEvents.
      if (/\.update\(\s*decisionEvents\s*\)/.test(body)) {
        violations.push(`${f}: .update(decisionEvents) is forbidden`);
      }
      if (/\.delete\(\s*decisionEvents\s*\)/.test(body)) {
        violations.push(`${f}: .delete(decisionEvents) is forbidden`);
      }
      if (/\btx\.update\(\s*decisionEvents\s*\)/.test(body)) {
        violations.push(`${f}: tx.update(decisionEvents) is forbidden`);
      }
    }
    expect(violations).toEqual([]);
  });
});
