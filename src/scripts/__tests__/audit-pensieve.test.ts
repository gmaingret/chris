// Unit tests for audit-pensieve.ts — Phase 6 (RETR-03)
// Tests pure logic: matchEntryToGroundTruth, generateCorrectedContent, formatAuditReport.
// No DB or embedding calls needed for these tests.

import { describe, it, expect, vi } from 'vitest';

// Mock DB connection to avoid requiring DATABASE_URL for pure-logic tests
vi.mock('../../db/connection.js', () => ({ db: {} }));
vi.mock('../../pensieve/embeddings.js', () => ({ embedAndStore: vi.fn() }));
import {
  matchEntryToGroundTruth,
  generateCorrectedContent,
  formatAuditReport,
  type AuditResult,
  type AuditStatus,
  type AuditAction,
} from '../audit-pensieve.js';

// ── Test 1: matchEntryToGroundTruth — Cagnes-sur-Mer rental context ──────────

describe('matchEntryToGroundTruth', () => {
  it('returns matched=true with incorrect=true for Cagnes-sur-Mer in rental context', () => {
    const content = 'My apartment in Cagnes-sur-Mer is rented out through Citya.';
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(true);
    expect(result.key).toBe('rental_property');
    expect(result.isCorrect).toBe(false);
    expect(result.issue).toBeDefined();
    expect(result.issue).toContain('Cagnes-sur-Mer');
  });

  // ── Test 2: matchEntryToGroundTruth — unrelated content ───────────────────

  it('returns matched=false for content unrelated to any ground-truth key', () => {
    const content = 'I had a great coffee this morning and felt energized.';
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(false);
    expect(result.key).toBeUndefined();
    expect(result.isCorrect).toBeUndefined();
  });

  it('returns matched=true with isCorrect=true for correct rental property content', () => {
    const content = 'My rental property in Golfe-Juan has been managed by Citya since October 2022.';
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(true);
    expect(result.key).toBe('rental_property');
    expect(result.isCorrect).toBe(true);
  });

  it('returns matched=true with incorrect=true for wrong move direction', () => {
    const content = "I'm planning to move from Georgia to Saint Petersburg next month.";
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(true);
    expect(result.isCorrect).toBe(false);
    expect(result.issue).toBeDefined();
  });

  // WR-01 fix: permanent_relocation entries must not be consumed by next_move block
  it('returns permanent_relocation (not next_move) for "permanently relocate to Batumi around September 2026"', () => {
    const content = 'The plan is to permanently relocate to Batumi around September 2026.';
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(true);
    expect(result.key).toBe('permanent_relocation');
    expect(result.isCorrect).toBe(true);
  });

  it('returns next_move for "moving to Batumi, Georgia around April 28 for about a month"', () => {
    const content = "I'm moving to Batumi, Georgia around April 28 for about a month.";
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(true);
    expect(result.key).toBe('next_move');
    expect(result.isCorrect).toBe(true);
  });

  it('returns permanent_relocation (not next_move) for "Moving to Batumi permanently"', () => {
    const content = 'Moving to Batumi permanently.';
    const result = matchEntryToGroundTruth(content);

    expect(result.matched).toBe(true);
    expect(result.key).toBe('permanent_relocation');
    expect(result.isCorrect).toBe(true);
  });
});

// ── Test 3: generateCorrectedContent ─────────────────────────────────────────

describe('generateCorrectedContent', () => {
  it('returns a string containing the correct value for rental_property', () => {
    const original = 'My apartment in Cagnes-sur-Mer is rented out through Citya.';
    const result = generateCorrectedContent('rental_property', original);

    expect(typeof result).toBe('string');
    expect(result).toContain('Golfe-Juan');
    expect(result).toContain('[Audit correction]');
  });

  it('returns a string with correct value for current_location', () => {
    const original = "I'm planning to move from Georgia to Saint Petersburg next month.";
    const result = generateCorrectedContent('current_location', original);

    expect(typeof result).toBe('string');
    expect(result).toContain('[Audit correction]');
    expect(result).toContain('Saint Petersburg');
  });
});

// ── Test 4: formatAuditReport ─────────────────────────────────────────────────

describe('formatAuditReport', () => {
  const sampleResults: AuditResult[] = [
    {
      entryId: 'aabbccdd-1234-5678-abcd-ef0123456789',
      content: 'My apartment in Cagnes-sur-Mer is rented out through Citya.',
      status: 'incorrect' as AuditStatus,
      action: 'soft_deleted' as AuditAction,
      groundTruthKey: 'rental_property',
      correctedContent: '[Audit correction] rental_property: Golfe-Juan, France',
    },
    {
      entryId: 'bbccddee-2345-6789-bcde-f01234567890',
      content: 'My rental property in Golfe-Juan has been managed by Citya.',
      status: 'correct' as AuditStatus,
      action: 'kept' as AuditAction,
      groundTruthKey: 'rental_property',
    },
  ];

  it('generates markdown with correct header and table structure', () => {
    const report = formatAuditReport(sampleResults, false);

    expect(report).toContain('# Pensieve Audit Report');
    expect(report).toContain('Entry ID');
    expect(report).toContain('Content');
    expect(report).toContain('Status');
    expect(report).toContain('Action');
  });

  it('includes summary counts', () => {
    const report = formatAuditReport(sampleResults, false);

    expect(report).toMatch(/total reviewed.*2|2.*total/i);
    expect(report).toContain('incorrect');
    expect(report).toContain('correct');
  });

  it('marks wet-run report correctly', () => {
    const report = formatAuditReport(sampleResults, false);
    expect(report).toContain('wet-run');
  });

  it('marks dry-run report correctly', () => {
    const report = formatAuditReport(sampleResults, true);
    expect(report).toContain('dry-run');
  });
});

// ── Test 5: AuditResult type structure ───────────────────────────────────────

describe('AuditResult type', () => {
  it('has all required fields', () => {
    // This test validates the TypeScript type shape via an object literal
    const result: AuditResult = {
      entryId: 'test-id',
      content: 'test content',
      status: 'correct',
      action: 'kept',
    };

    expect(result.entryId).toBe('test-id');
    expect(result.content).toBe('test content');
    expect(result.status).toBe('correct');
    expect(result.action).toBe('kept');
    // Optional fields
    expect(result.groundTruthKey).toBeUndefined();
    expect(result.correctedContent).toBeUndefined();
  });

  it('accepts incorrect status with would_correct action', () => {
    const result: AuditResult = {
      entryId: 'test-id-2',
      content: 'My apartment in Cagnes-sur-Mer is rented through Citya.',
      status: 'incorrect',
      action: 'would_correct',
      groundTruthKey: 'rental_property',
      correctedContent: '[Audit correction] rental_property: Golfe-Juan, France',
    };

    expect(result.status).toBe('incorrect');
    expect(result.action).toBe('would_correct');
    expect(result.groundTruthKey).toBe('rental_property');
    expect(result.correctedContent).toBeDefined();
  });
});
