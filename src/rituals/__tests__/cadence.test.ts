/**
 * src/rituals/__tests__/cadence.test.ts — Phase 25 Plan 02 Task 2 (RIT-08)
 *
 * Unit tests for `computeNextRunAt(now, cadence, config)`. Pure-function (no
 * DB, no network, no fake-timer mocks) — `now` is passed explicitly. Asserts:
 *
 *   1. Daily cadence — returns today's slot (Paris local time) when called
 *      before the slot.
 *   2. Daily cadence — advances to tomorrow when called at-or-after today's
 *      slot.
 *   3. DST spring-forward (2026-03-29 Europe/Paris): wall-clock 21:00 Paris
 *      preserved across the 23h-day transition (CET → CEST).
 *   4. DST fall-back (2026-10-25 Europe/Paris): wall-clock 21:00 Paris
 *      preserved across the 25h-day transition (CEST → CET).
 *   5. Weekly cadence — advances to next configured ISO weekday (fire_dow=7
 *      = Sunday).
 *   6. Monthly cadence — advances by 1 month preserving fire time.
 *   7. Quarterly cadence — advances by 3 months preserving fire time.
 *   8. (Implicit, enforced by grep guard external to this file): cadence.ts
 *      must not contain `86_400_000`, `86400000`, `setUTCHours`, or
 *      `setHours` — Pitfall 2/3 prevention.
 *
 * Run in isolation:
 *   npx vitest run src/rituals/__tests__/cadence.test.ts
 */
import { describe, it, expect } from 'vitest';
import { computeNextRunAt } from '../cadence.js';
import type { RitualConfig } from '../types.js';

const baseConfig: RitualConfig = {
  fire_at: '21:00',
  skip_threshold: 3,
  mute_until: null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1',
  schema_version: 1,
};

// ── Daily cadence ──────────────────────────────────────────────────────────

describe('computeNextRunAt — daily cadence', () => {
  it("returns today 21:00 Paris when called before today's slot", () => {
    // 2026-04-15 10:00 UTC = 12:00 Paris (CEST/+2). Today's 21:00 slot has
    // not yet fired today. Expected: 2026-04-15 21:00 Paris = 19:00 UTC.
    const now = new Date('2026-04-15T10:00:00.000Z');
    const next = computeNextRunAt(now, 'daily', baseConfig);
    expect(next.toISOString()).toBe('2026-04-15T19:00:00.000Z');
  });

  it("advances to tomorrow when called after today's slot", () => {
    // 2026-04-15 22:00 UTC = 00:00+1 Paris (already past 21:00 slot).
    // Expected: 2026-04-16 21:00 Paris = 19:00 UTC.
    const now = new Date('2026-04-15T22:00:00.000Z');
    const next = computeNextRunAt(now, 'daily', baseConfig);
    expect(next.toISOString()).toBe('2026-04-16T19:00:00.000Z');
  });
});

// ── DST safety (RIT-08 wall-clock preservation) ────────────────────────────

describe('computeNextRunAt — DST safety', () => {
  it('preserves wall-clock 21:00 across spring-forward (2026-03-29 Europe/Paris)', () => {
    // 2026-03-28 20:00 UTC = 21:00 Paris (CET/+1, before the switch).
    // 2026-03-29 21:00 Paris is on the OTHER side of the spring-forward
    // boundary (now CEST/+2) → 19:00 UTC.
    // If cadence.ts uses `Date.setHours` or `+24h ms`, this returns 20:00 UTC
    // (off by one hour). Luxon's wall-clock arithmetic preserves 21:00 local.
    const now = new Date('2026-03-28T20:00:00.000Z');
    const next = computeNextRunAt(now, 'daily', baseConfig);
    expect(next.toISOString()).toBe('2026-03-29T19:00:00.000Z');
  });

  it('preserves wall-clock 21:00 across fall-back (2026-10-25 Europe/Paris)', () => {
    // 2026-10-24 19:00 UTC = 21:00 Paris (CEST/+2, before the switch).
    // 2026-10-25 21:00 Paris is on the OTHER side of the fall-back boundary
    // (now CET/+1) → 20:00 UTC.
    const now = new Date('2026-10-24T19:00:00.000Z');
    const next = computeNextRunAt(now, 'daily', baseConfig);
    expect(next.toISOString()).toBe('2026-10-25T20:00:00.000Z');
  });
});

// ── Weekly / monthly / quarterly cadences ──────────────────────────────────

describe('computeNextRunAt — weekly/monthly/quarterly', () => {
  it('weekly: advances to next configured weekday (fire_dow=7 = Sunday)', () => {
    // 2026-04-13 is a Monday (ISO weekday=1). fire_dow=7 = Sunday → next
    // Sunday is 2026-04-19. Fire at 20:00 Paris (CEST/+2) = 18:00 UTC.
    const weeklyConfig: RitualConfig = {
      ...baseConfig,
      fire_at: '20:00',
      fire_dow: 7,
    };
    const now = new Date('2026-04-13T08:00:00.000Z');
    const next = computeNextRunAt(now, 'weekly', weeklyConfig);
    expect(next.toISOString()).toBe('2026-04-19T18:00:00.000Z');
  });

  it('weekly: advances to NEXT week if today is the configured weekday but past slot', () => {
    // 2026-04-19 is a Sunday (ISO weekday=7). 19:00 UTC = 21:00 Paris CEST,
    // which is at the slot — so we expect next Sunday 2026-04-26 at 20:00
    // Paris (= 18:00 UTC).
    const weeklyConfig: RitualConfig = {
      ...baseConfig,
      fire_at: '20:00',
      fire_dow: 7,
    };
    const now = new Date('2026-04-19T19:00:00.000Z');
    const next = computeNextRunAt(now, 'weekly', weeklyConfig);
    expect(next.toISOString()).toBe('2026-04-26T18:00:00.000Z');
  });

  it('monthly: advances by 1 month preserving fire time (Paris CEST)', () => {
    // 2026-04-15 10:00 UTC = 12:00 Paris. Today's 21:00 slot is in the
    // future relative to now, but monthly advances by +1 month from that
    // local target → 2026-05-15 21:00 Paris = 19:00 UTC.
    const now = new Date('2026-04-15T10:00:00.000Z');
    const next = computeNextRunAt(now, 'monthly', baseConfig);
    expect(next.toISOString()).toBe('2026-05-15T19:00:00.000Z');
  });

  it('quarterly: advances by 3 months preserving fire time (Paris CEST)', () => {
    // Same anchor as monthly: 2026-04-15 10:00 UTC. +3 months → 2026-07-15
    // 21:00 Paris (still CEST) = 19:00 UTC.
    const now = new Date('2026-04-15T10:00:00.000Z');
    const next = computeNextRunAt(now, 'quarterly', baseConfig);
    expect(next.toISOString()).toBe('2026-07-15T19:00:00.000Z');
  });
});
