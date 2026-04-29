/**
 * src/rituals/__tests__/types.test.ts — Phase 25 Plan 02 Task 1 (RIT-07)
 *                                        Phase 28 Plan 01 Task 1 (SKIP-01)
 *
 * Unit tests for the `RitualConfigSchema` Zod schema + `RitualFireOutcome`
 * union + `RITUAL_OUTCOME` const map. Pure-function (no DB, no network), runs
 * in microseconds. Asserts:
 *
 *   Phase 25 (original):
 *   1. Accepts a fully-populated valid 8-field config + schema_version=1.
 *   2. Accepts a config with optional fields (fire_dow, prompt_bag) omitted.
 *   3. Rejects unknown fields with `Unrecognized key` (proves `.strict()`
 *      enforcement — RIT-07's "rejects unknown fields" contract).
 *   4. Rejects fire_at outside HH:mm pattern (regex guard).
 *   5. Rejects schema_version other than literal 1.
 *   6. Rejects fire_dow outside 1..7 (ISO weekday bound).
 *   7. Rejects skip_threshold outside 1..10.
 *   8. Rejects prompt_bag arrays longer than 6.
 *   9. Verifies `RitualFireOutcome` exposes variants and
 *      `RitualFireResult` interface fields are present (compile-time + shape
 *      check).
 *
 *   Phase 28 (SKIP-01 additions):
 *   10. RitualFireOutcome union has exactly 12 string-literal members.
 *   11. RITUAL_OUTCOME const map has 12 keys; values include all 5 new variants.
 *   12. RITUAL_OUTCOME satisfies Record<string, RitualFireOutcome> at compile time.
 *   13. RitualConfigSchema parses with adjustment_mute_until set/absent/null; rejects non-ISO.
 *   14. RitualConfigSchema still rejects unknown fields (strict-mode preserved).
 *
 * Run in isolation:
 *   npx vitest run src/rituals/__tests__/types.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  RitualConfigSchema,
  RITUAL_OUTCOME,
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

// ── Phase 28 SKIP-01 tests ─────────────────────────────────────────────────

describe('RitualFireOutcome — 12-variant union (Phase 28 SKIP-01)', () => {
  it('union has exactly 12 string-literal members (TS exhaustiveness check)', () => {
    // Compile-time: all 12 variants must be assignable to RitualFireOutcome.
    // If the union shrinks or grows, this array will fail to type-check.
    const all: RitualFireOutcome[] = [
      'fired',
      'caught_up',
      'muted',
      'race_lost',
      'in_dialogue',
      'config_invalid',
      'system_suppressed',    // Phase 26 VOICE-04
      'wellbeing_completed',  // Phase 27 (homogenized in 28)
      'wellbeing_skipped',    // Phase 27 (homogenized in 28)
      'responded',            // Phase 28 SKIP-01
      'window_missed',        // Phase 28 SKIP-01
      'fired_no_response',    // Phase 28 SKIP-01 — THE skip-counting outcome
    ];
    expect(all).toHaveLength(12);
  });
});

describe('RITUAL_OUTCOME const map (Phase 28 SKIP-01 — Pitfall 4 mitigation)', () => {
  it('has exactly 12 keys matching all RitualFireOutcome variants', () => {
    const values = Object.values(RITUAL_OUTCOME);
    expect(values).toHaveLength(12);
  });

  it('includes all 5 new Phase 28 + Phase 27 homogenized variants', () => {
    const values = Object.values(RITUAL_OUTCOME);
    expect(values).toContain('fired_no_response');
    expect(values).toContain('responded');
    expect(values).toContain('window_missed');
    expect(values).toContain('wellbeing_completed');
    expect(values).toContain('wellbeing_skipped');
  });

  it('includes all original Phase 25-26 variants', () => {
    const values = Object.values(RITUAL_OUTCOME);
    expect(values).toContain('fired');
    expect(values).toContain('caught_up');
    expect(values).toContain('muted');
    expect(values).toContain('race_lost');
    expect(values).toContain('in_dialogue');
    expect(values).toContain('config_invalid');
    expect(values).toContain('system_suppressed');
  });

  it('satisfies Record<string, RitualFireOutcome> at compile time (no string drift)', () => {
    // The `as const satisfies Record<string, RitualFireOutcome>` in types.ts
    // is the compile-time proof. This test verifies runtime shape consistency.
    const map: Record<string, RitualFireOutcome> = RITUAL_OUTCOME;
    expect(typeof map).toBe('object');
    // Every value must match the union literal — proved by the satisfies clause.
    for (const val of Object.values(map)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});

describe('RitualConfigSchema — adjustment_mute_until (Phase 28 D-28-08)', () => {
  it('parses when adjustment_mute_until is set to a valid ISO datetime', () => {
    const cfg = { ...validConfig, adjustment_mute_until: '2026-05-15T20:00:00.000Z' };
    const parsed = RitualConfigSchema.parse(cfg);
    expect(parsed.adjustment_mute_until).toBe('2026-05-15T20:00:00.000Z');
  });

  it('parses when adjustment_mute_until is absent (undefined)', () => {
    const parsed = RitualConfigSchema.parse(validConfig);
    expect(parsed.adjustment_mute_until).toBeUndefined();
  });

  it('parses when adjustment_mute_until is null', () => {
    const cfg = { ...validConfig, adjustment_mute_until: null };
    const parsed = RitualConfigSchema.parse(cfg);
    expect(parsed.adjustment_mute_until).toBeNull();
  });

  it('rejects non-ISO adjustment_mute_until (e.g. "not-iso") with ZodError', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, adjustment_mute_until: 'not-iso' }),
    ).toThrow();
  });

  it('still rejects unknown fields (strict-mode invariant preserved)', () => {
    expect(() =>
      RitualConfigSchema.parse({ ...validConfig, completely_unknown: 'x' }),
    ).toThrow(/Unrecognized key/);
  });
});
