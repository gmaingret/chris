import { describe, it, expect, vi } from 'vitest';

// Mock DB connection to avoid requiring DATABASE_URL for pure-logic tests
vi.mock('../../db/connection.js', () => ({ db: {} }));
vi.mock('../../pensieve/embeddings.js', () => ({ embedAndStore: vi.fn() }));

import { SEED_ENTRIES } from '../seed-audit-data.js';

describe('seed-audit-data SEED_ENTRIES', () => {
  it('has entries for every ground-truth category', () => {
    // Each entry's metadata.groundTruthKey or content should map to all 5 categories
    // We verify by checking the presence of content that covers each category
    const allContent = SEED_ENTRIES.map((e) => e.content.toLowerCase()).join(' ');

    // identity
    expect(allContent).toMatch(/born|french|nationality/);
    // location_history
    expect(allContent).toMatch(/saint petersburg|batumi|antibes/);
    // property
    expect(allContent).toMatch(/golfe-juan|cagnes-sur-mer|citya/);
    // business
    expect(allContent).toMatch(/maingret|georgian|panama/);
    // financial
    expect(allContent).toMatch(/\$1\.5 million|1,500,000|fi target/);
  });

  it('has at least 2 entries with metadata.seedScenario === "error"', () => {
    const errorEntries = SEED_ENTRIES.filter((e) => e.metadata.seedScenario === 'error');
    expect(errorEntries.length).toBeGreaterThanOrEqual(2);
  });

  it('has an error entry containing "Cagnes-sur-Mer" in context of rental property', () => {
    const errorEntries = SEED_ENTRIES.filter((e) => e.metadata.seedScenario === 'error');
    const rentalError = errorEntries.find(
      (e) =>
        e.content.includes('Cagnes-sur-Mer') &&
        (e.content.toLowerCase().includes('rented') ||
          e.content.toLowerCase().includes('rental') ||
          e.content.toLowerCase().includes('apartment') ||
          e.content.toLowerCase().includes('property') ||
          e.content.toLowerCase().includes('citya')),
    );
    expect(rentalError).toBeDefined();
  });

  it('has an error entry with wrong move direction (from Georgia to Saint Petersburg)', () => {
    const errorEntries = SEED_ENTRIES.filter((e) => e.metadata.seedScenario === 'error');
    const directionError = errorEntries.find(
      (e) =>
        e.content.toLowerCase().includes('georgia') &&
        e.content.toLowerCase().includes('saint petersburg'),
    );
    expect(directionError).toBeDefined();
  });

  it('has exactly 13 entries (11 correct + 2 error)', () => {
    expect(SEED_ENTRIES.length).toBe(13);
    const correct = SEED_ENTRIES.filter((e) => e.metadata.seedScenario === 'correct');
    const error = SEED_ENTRIES.filter((e) => e.metadata.seedScenario === 'error');
    expect(correct.length).toBe(11);
    expect(error.length).toBe(2);
  });

  it('covers all 11 correct ground-truth keys including next_move', () => {
    const correctKeys = SEED_ENTRIES
      .filter((e) => e.metadata.seedScenario === 'correct')
      .map((e) => e.metadata.groundTruthKey)
      .filter((k): k is string => !!k);

    const expectedKeys = [
      'birth_date', 'nationality',
      'current_location', 'next_move', 'after_batumi', 'permanent_relocation',
      'rental_property',
      'business_us', 'business_georgia', 'residency_panama',
      'fi_target',
    ];

    for (const key of expectedKeys) {
      expect(correctKeys).toContain(key);
    }
  });

  it('every entry has correct shape: non-empty content, valid epistemicTag, source=telegram', () => {
    const validTags = ['FACT', 'RELATIONSHIP'] as const;
    for (const entry of SEED_ENTRIES) {
      expect(typeof entry.content).toBe('string');
      expect(entry.content.length).toBeGreaterThan(0);
      expect(validTags).toContain(entry.epistemicTag);
      expect(entry.source).toBe('telegram');
      expect(entry.metadata).toBeDefined();
      expect(['correct', 'error']).toContain(entry.metadata.seedScenario);
    }
  });
});
