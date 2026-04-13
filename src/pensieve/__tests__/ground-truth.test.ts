import { describe, it, expect } from 'vitest';
import {
  GROUND_TRUTH,
  GROUND_TRUTH_MAP,
  type GroundTruthEntry,
  type FactCategory,
} from '../ground-truth.js';

describe('ground-truth module', () => {
  it('GROUND_TRUTH is an array with exactly 13 entries covering all categories', () => {
    expect(Array.isArray(GROUND_TRUTH)).toBe(true);
    expect(GROUND_TRUTH.length).toBe(13);

    const identityEntries = GROUND_TRUTH.filter((e) => e.category === 'identity');
    const locationEntries = GROUND_TRUTH.filter((e) => e.category === 'location_history');
    const propertyEntries = GROUND_TRUTH.filter((e) => e.category === 'property');
    const businessEntries = GROUND_TRUTH.filter((e) => e.category === 'business');
    const financialEntries = GROUND_TRUTH.filter((e) => e.category === 'financial');

    expect(identityEntries.length).toBe(3);
    expect(locationEntries.length).toBe(4);
    expect(propertyEntries.length).toBe(2);
    expect(businessEntries.length).toBe(3);
    expect(financialEntries.length).toBe(1);
  });

  it('GROUND_TRUTH_MAP is a Record mapping all 13 keys to string values', () => {
    expect(typeof GROUND_TRUTH_MAP).toBe('object');
    expect(GROUND_TRUTH_MAP).not.toBeNull();
    const keys = Object.keys(GROUND_TRUTH_MAP);
    expect(keys.length).toBe(13);
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
