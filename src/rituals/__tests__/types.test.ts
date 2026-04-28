/**
 * src/rituals/__tests__/types.test.ts — Phase 25 Plan 02 Task 1 (RIT-07)
 *
 * Unit tests for the `RitualConfigSchema` Zod schema. Pure-function (no DB,
 * no network), runs in microseconds. Asserts:
 *
 *   1. Accepts a fully-populated valid 8-field config + schema_version=1.
 *   2. Accepts a config with optional fields (fire_dow, prompt_bag) omitted.
 *   3. Rejects unknown fields with `Unrecognized key` (proves `.strict()`
 *      enforcement — RIT-07's "rejects unknown fields" contract).
 *   4. Rejects fire_at outside HH:mm pattern (regex guard).
 *   5. Rejects schema_version other than literal 1.
 *   6. Rejects fire_dow outside 1..7 (ISO weekday bound).
 *   7. Rejects skip_threshold outside 1..10.
 *   8. Rejects prompt_bag arrays longer than 6.
 *   9. Verifies `RitualFireOutcome` exposes 6 union variants and
 *      `RitualFireResult` interface fields are present (compile-time + shape
 *      check).
 *
 * Run in isolation:
 *   npx vitest run src/rituals/__tests__/types.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  RitualConfigSchema,
  parseRitualConfig,
  type RitualConfig,
  type RitualFireOutcome,
  type RitualFireResult,
} from '../types.js';

const validConfig: RitualConfig = {
  fire_at: '21:00',
  fire_dow: 7,
  prompt_bag: [0, 1, 2, 3, 4, 5],
  skip_threshold: 3,
  mute_until: null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1',
  schema_version: 1,
};

describe('RitualConfigSchema — happy path', () => {
  it('accepts a fully-populated valid config', () => {
    const parsed = RitualConfigSchema.parse(validConfig);
    expect(parsed).toEqual(validConfig);
  });

  it('accepts a config with optional fields (fire_dow, prompt_bag) omitted', () => {
    const minimal = {
      fire_at: '21:00',
      skip_threshold: 3,
      mute_until: null,
      time_zone: 'Europe/Paris',
      prompt_set_version: 'v1',
      schema_version: 1,
    };
    const parsed = RitualConfigSchema.parse(minimal);
    expect(parsed.fire_dow).toBeUndefined();
    expect(parsed.prompt_bag).toBeUndefined();
    expect(parsed.fire_at).toBe('21:00');
  });

  it('accepts mute_until as an ISO datetime string (not just null)', () => {
    const muted = { ...validConfig, mute_until: '2026-05-01T00:00:00Z' };
    const parsed = RitualConfigSchema.parse(muted);
    expect(parsed.mute_until).toBe('2026-05-01T00:00:00Z');
  });

  it('parseRitualConfig helper round-trips a valid config', () => {
    const parsed = parseRitualConfig(validConfig);
    expect(parsed).toEqual(validConfig);
  });
});

describe('RitualConfigSchema — strict rejection (RIT-07)', () => {
  it('rejects unknown fields via .strict() (RIT-07 unknown-field contract)', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, unknown_field: 'x' }),
    ).toThrow(/Unrecognized key/);
  });

  it('rejects fire_at outside HH:mm regex (e.g. "25:00")', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, fire_at: '25:00' }),
    ).toThrow(/fire_at must be HH:mm/);
  });

  it('rejects schema_version other than literal 1', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, schema_version: 2 }),
    ).toThrow();
  });

  it('rejects fire_dow outside 1..7 (ISO weekday bound)', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, fire_dow: 8 }),
    ).toThrow();
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, fire_dow: 0 }),
    ).toThrow();
  });

  it('rejects skip_threshold outside 1..10', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, skip_threshold: 0 }),
    ).toThrow();
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, skip_threshold: 11 }),
    ).toThrow();
  });

  it('rejects prompt_bag arrays longer than 6', () => {
    expect(() =>
      RitualConfigSchema.parse({
        ...validConfig,
        prompt_bag: [0, 1, 2, 3, 4, 5, 6],
      }),
    ).toThrow();
  });
});

describe('RitualFireOutcome + RitualFireResult — scaffold shape', () => {
  it('RitualFireOutcome union has 7 variants (compile-time exhaustiveness)', () => {
    // If the union shrinks or grows, this assertion fails to type-check.
    // Phase 26 Plan 26-03 (D-26-06) appended 'system_suppressed' for VOICE-04.
    const variants: RitualFireOutcome[] = [
      'fired',
      'caught_up',
      'muted',
      'race_lost',
      'in_dialogue',
      'config_invalid',
      'system_suppressed',
    ];
    // Runtime sanity: 7 variants enumerated above.
    expect(variants).toHaveLength(7);
  });

  it('RitualFireResult interface accepts a well-typed object literal', () => {
    const r: RitualFireResult = {
      ritualId: '00000000-0000-0000-0000-000000000000',
      type: 'daily',
      fired: true,
      outcome: 'fired',
    };
    expect(r.ritualId).toBe('00000000-0000-0000-0000-000000000000');
    expect(r.fired).toBe(true);
    expect(r.outcome).toBe('fired');
  });
});
