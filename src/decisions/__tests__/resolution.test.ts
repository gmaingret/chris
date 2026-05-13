/**
 * src/decisions/__tests__/resolution.test.ts — Phase 35 Plan 35-02 (SURF-02, D-28)
 *
 * ACCOUNTABILITY mode negative-injection invariant per CONTEXT.md D-28:
 *   "JOURNAL, INTERROGATE, PRODUCE, PHOTOS, ACCOUNTABILITY do NOT receive
 *    profile injection. ... regression test asserting these 5 handlers do
 *    NOT call getOperationalProfiles()."
 *
 * Wave 2 scope rationale:
 *   - handleResolution's full happy-path requires extensive scaffolding
 *     (decisions row + temporal Pensieve fixture + Anthropic mock + lifecycle
 *     transition mock + classifyOutcome mock + DB write mocks for the
 *     fire-and-forget post-mortem branch).
 *   - The full handler fixture properly belongs in a future deferred-items
 *     follow-up; live-accountability.test.ts already covers the SDK boundary.
 *   - For the wire-drift detector that D-28 demands, the structural invariant
 *     is sufficient: source-level proof that resolution.ts does NOT import
 *     getOperationalProfiles or formatProfilesForPrompt. If a future phase
 *     accidentally wires the import, the parsing assertion fires loudly.
 *
 * Run in isolation:
 *   npx vitest run src/decisions/__tests__/resolution.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESOLUTION_SOURCE = readFileSync(
  resolve(__dirname, '../resolution.ts'),
  'utf-8',
);

describe('ACCOUNTABILITY operational-profile injection (D-28 negative invariant)', () => {
  it('resolution.ts does NOT import getOperationalProfiles (D-28 — out-of-scope mode)', () => {
    // ACCOUNTABILITY is intentionally out-of-scope per PROFILE_INJECTION_MAP.
    // The handler must not call getOperationalProfiles — verified at the
    // structural (import-level) layer here so that an accidental wire-drift
    // in a future phase fails this test before it can ship.
    expect(RESOLUTION_SOURCE).not.toMatch(/\bgetOperationalProfiles\b/);
  });

  it('resolution.ts does NOT import formatProfilesForPrompt (D-28 — wire-drift detector)', () => {
    expect(RESOLUTION_SOURCE).not.toMatch(/\bformatProfilesForPrompt\b/);
  });

  it('resolution.ts does NOT import from src/memory/profiles (D-28 — defense in depth)', () => {
    // No import line — direct or re-exported — from the profiles module.
    expect(RESOLUTION_SOURCE).not.toMatch(/from\s+['"]\.\.\/memory\/profiles(\.js)?['"]/);
  });
});
