import { describe, it, expect } from 'vitest';
import {
  GROUND_TRUTH,
  GROUND_TRUTH_MAP,
  type GroundTruthEntry,
  type FactCategory,
} from '../ground-truth.js';

describe('ground-truth module', () => {
  it('GROUND_TRUTH covers all stable categories + at-most-2 dynamic locations', () => {
    // 2026-05-11: locations refactored from 4 static entries to a dated
    // LOCATION_LOG that exposes 0-2 entries (current + optionally next).
    // Stable: 3 identity + 2 property + 3 business + 1 financial = 9.
    // Dynamic: 1 current + 0 or 1 next = 1 or 2 (never 0; LOCATION_LOG
    // covers 2026 throughout). Total = 10 or 11.
    expect(Array.isArray(GROUND_TRUTH)).toBe(true);
    expect(GROUND_TRUTH.length).toBeGreaterThanOrEqual(10);
    expect(GROUND_TRUTH.length).toBeLessThanOrEqual(11);

    const identityEntries = GROUND_TRUTH.filter((e) => e.category === 'identity');
    const locationEntries = GROUND_TRUTH.filter((e) => e.category === 'location_history');
    const propertyEntries = GROUND_TRUTH.filter((e) => e.category === 'property');
    const businessEntries = GROUND_TRUTH.filter((e) => e.category === 'business');
    const financialEntries = GROUND_TRUTH.filter((e) => e.category === 'financial');

    expect(identityEntries.length).toBe(3);
    expect(locationEntries.length).toBeGreaterThanOrEqual(1);
    expect(locationEntries.length).toBeLessThanOrEqual(2);
    expect(propertyEntries.length).toBe(2);
    expect(businessEntries.length).toBe(3);
    expect(financialEntries.length).toBe(1);
  });

  it('GROUND_TRUTH_MAP is a Record mapping all keys to string values', () => {
    expect(typeof GROUND_TRUTH_MAP).toBe('object');
    expect(GROUND_TRUTH_MAP).not.toBeNull();
    const keys = Object.keys(GROUND_TRUTH_MAP);
    // See preceding test — total varies 10-11 with dynamic location entries.
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys.length).toBeLessThanOrEqual(11);
    for (const key of keys) {
      expect(typeof GROUND_TRUTH_MAP[key]).toBe('string');
      expect(GROUND_TRUTH_MAP[key]!.length).toBeGreaterThan(0);
    }
  });

  it('every GroundTruthEntry has non-empty key, value, and category fields', () => {
    for (const entry of GROUND_TRUTH) {
      expect(typeof entry.key).toBe('string');
      expect(entry.key.length).toBeGreaterThan(0);
      expect(typeof entry.value).toBe('string');
      expect(entry.value.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });

  it('FactCategory type only allows the five valid categories', () => {
    const validCategories: FactCategory[] = [
      'identity',
      'location_history',
      'property',
      'business',
      'financial',
    ];
    for (const entry of GROUND_TRUTH) {
      expect(validCategories).toContain(entry.category);
    }
  });

  it("GROUND_TRUTH_MAP['rental_property'] === 'Golfe-Juan, France'", () => {
    expect(GROUND_TRUTH_MAP['rental_property']).toBe('Golfe-Juan, France');
  });

  it("GROUND_TRUTH_MAP['birth_date'] === '1979-06-15'", () => {
    expect(GROUND_TRUTH_MAP['birth_date']).toBe('1979-06-15');
  });

  it("GROUND_TRUTH_MAP['fi_target'] === '$1,500,000'", () => {
    expect(GROUND_TRUTH_MAP['fi_target']).toBe('$1,500,000');
  });
});
