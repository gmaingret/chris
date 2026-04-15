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
import { join } from 'node:path';

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

describe('chokepoint audit: decisions.status mutations', () => {
  it('only src/decisions/lifecycle.ts mutates decisions.status', () => {
    const files = walk('src');
    const violations: string[] = [];
    for (const f of files) {
      const normalized = f.replace(/\\/g, '/');
      if (normalized === 'src/decisions/lifecycle.ts') continue;
      const body = readFileSync(f, 'utf8');
      if (/\.update\(\s*decisions\s*\)[\s\S]{0,200}?status\s*:/.test(body)) {
        violations.push(`${f}: found .update(decisions).set({ status: ... })`);
      }
      if (/UPDATE\s+decisions\s+SET[\s\S]{0,100}?status/i.test(body)) {
        violations.push(`${f}: found raw UPDATE decisions SET ... status`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('decision_events is strictly append-only: ZERO .update/.delete callsites anywhere under src/', () => {
    const files = walk('src');
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
