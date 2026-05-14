/**
 * src/memory/profiles/__tests__/schwartz.test.ts — Phase 38 Plan 38-02 Task 3
 *
 * Per-generator unit test for generateSchwartzProfile (PGEN-03). Mirror of
 * hexaco.test.ts with 10-value substitutions. Real Docker postgres + mocked
 * Anthropic SDK + mocked logger.
 *
 * Coverage:
 *   1. Below-threshold short-circuit
 *   2. Above-threshold happy path
 *   3. Sonnet system text routing — Schwartz directive header
 *   4. prevHistorySnapshot threading (PGEN-07)
 *   5. substrate_hash audit-trail (PGEN-06)
 *   6. last_updated host-injection (Pitfall 7)
 *   7. Error isolation
 *   8. NO hash-skip regression guard (Pitfall 1)
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/schwartz.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        parse: mockAnthropicParse,
        create: vi.fn(),
      },
    },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

import { sql, eq } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  pensieveEntries,
  profileSchwartz,
  profileHistory,
} from '../../../db/schema.js';
import { loadPsychologicalSubstrate } from '../psychological-shared.js';
import { generateSchwartzProfile } from '../schwartz.js';
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from '../../psychological-profile-prompt.js';

const PINNED_NOW = new Date('2026-05-01T09:00:00Z');
const IN_WINDOW_APRIL = new Date('2026-04-15T10:00:00Z');

/**
 * Valid Sonnet Schwartz response — 10 dim objects with valid datetime
 * `last_updated` + top-level data_consistency + overall_confidence.
 */
function validSchwartzResponse() {
  const dim = (score: number, conf: number) => ({
    score, confidence: conf, last_updated: '2026-04-15T09:00:00.000Z',
  });
  return {
    parsed_output: {
      self_direction: dim(4.0, 0.55),
      stimulation: dim(3.5, 0.5),
      hedonism: dim(3.2, 0.5),
      achievement: dim(4.3, 0.6),
      power: dim(2.8, 0.5),
      security: dim(3.6, 0.55),
      conformity: dim(2.5, 0.45),
      tradition: dim(2.7, 0.45),
      benevolence: dim(4.2, 0.6),
      universalism: dim(4.0, 0.55),
      data_consistency: 0.5,
      overall_confidence: 0.7,
    },
  };
}

async function cleanupAll() {
  await db.delete(profileHistory);
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  // Reset profile_schwartz 'primary' row to cold-start state.
  await db
    .update(profileSchwartz)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      selfDirection: sql`'null'::jsonb`,
      stimulation: sql`'null'::jsonb`,
      hedonism: sql`'null'::jsonb`,
      achievement: sql`'null'::jsonb`,
      power: sql`'null'::jsonb`,
      security: sql`'null'::jsonb`,
      conformity: sql`'null'::jsonb`,
      tradition: sql`'null'::jsonb`,
      benevolence: sql`'null'::jsonb`,
      universalism: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileSchwartz.name, 'primary'));
}

async function seedAboveThresholdCorpus() {
  for (let i = 0; i < 6; i++) {
    await db.insert(pensieveEntries).values({
      content: `entry ${i} ` + ('word '.repeat(1000)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_APRIL,
    });
  }
}

describe('generateSchwartzProfile (PGEN-03)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    await cleanupAll();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  afterAll(async () => {
    await cleanupAll();
  });

  // ── 1. Below-threshold short-circuit ──────────────────────────────────

  it('below-threshold substrate → skipped_below_threshold (no Sonnet call)', async () => {
    await db.insert(pensieveEntries).values({
      content: ('word '.repeat(100)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_APRIL,
    });

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(true);

    const outcome = await generateSchwartzProfile({ substrate });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(0);
    expect(outcome.outcome).toBe('skipped_below_threshold');
    expect(outcome.profileType).toBe('schwartz');
    if (outcome.outcome === 'skipped_below_threshold') {
      expect(outcome.wordCount).toBe(100);
    }

    const skipLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.psychological.schwartz.skipped_below_threshold',
    );
    expect(skipLogCalls).toHaveLength(1);
  });

  // ── 2. Above-threshold happy path ─────────────────────────────────────

  it('above-threshold substrate + valid Sonnet response → updated outcome with full row state', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValueOnce(validSchwartzResponse());

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);

    const outcome = await generateSchwartzProfile({ substrate });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe('updated');
    expect(outcome.profileType).toBe('schwartz');
    if (outcome.outcome === 'updated') {
      expect(outcome.overallConfidence).toBe(0.7);
      expect(outcome.wordCount).toBeGreaterThan(5000);
    }

    const rows = await db
      .select()
      .from(profileSchwartz)
      .where(eq(profileSchwartz.name, 'primary'))
      .limit(1);
    const row = rows[0]!;
    expect(row.name).toBe('primary');
    expect(row.overallConfidence).toBeCloseTo(0.7, 5);
    expect(row.wordCount).toBeGreaterThan(5000);
    expect(row.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.selfDirection).not.toBeNull();
    expect(row.universalism).not.toBeNull();

    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(1);
    expect(history[0]!.profileTableName).toBe('profile_schwartz');
  });

  // ── 3. Sonnet system text routing ─────────────────────────────────────

  it('assembled system text contains Schwartz directive + PSYCHOLOGICAL_HARD_RULE_EXTENSION', async () => {
    await seedAboveThresholdCorpus();

    let capturedSystemText = '';
    mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
      capturedSystemText = req.system?.[0]?.text ?? '';
      return Promise.resolve(validSchwartzResponse());
    });

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    await generateSchwartzProfile({ substrate });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
    expect(capturedSystemText).toContain('## Profile Focus — Schwartz Universal Values');
    expect(capturedSystemText).toContain(PSYCHOLOGICAL_HARD_RULE_EXTENSION);
  });

  // ── 4. prevHistorySnapshot threading (PGEN-07) ───────────────────────

  it('prior profile_history snapshot is threaded into the prompt', async () => {
    await seedAboveThresholdCorpus();

    const knownSnapshot = {
      self_direction: { score: 3.0, confidence: 0.4, last_updated: '2026-03-15T09:00:00Z' },
      data_consistency: 0.3,
      overall_confidence: 0.4,
    };
    const primary = (await db
      .select()
      .from(profileSchwartz)
      .where(eq(profileSchwartz.name, 'primary'))
      .limit(1))[0]!;
    await db.insert(profileHistory).values({
      profileTableName: 'profile_schwartz',
      profileId: primary.id,
      snapshot: knownSnapshot,
    });

    let capturedSystemText = '';
    mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
      capturedSystemText = req.system?.[0]?.text ?? '';
      return Promise.resolve(validSchwartzResponse());
    });

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.prevHistorySnapshot).not.toBeNull();

    await generateSchwartzProfile({ substrate });

    // The JSON-stringify ordering is postgres jsonb-determined
    // (alphabetical), not source-literal-determined, so we assert on field
    // contents rather than literal stringification.
    expect(capturedSystemText).toContain('## CURRENT PROFILE STATE');
    expect(capturedSystemText).toContain('"self_direction"');
    expect(capturedSystemText).toContain('"score": 3');
    expect(capturedSystemText).toContain('"overall_confidence": 0.4');
    expect(capturedSystemText).toContain('"data_consistency": 0.3');
  });

  // ── 5. Substrate-hash audit trail (PGEN-06) ──────────────────────────

  it('post-fire row has 64-char hex substrate_hash (audit-trail only; not used for skip)', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValueOnce(validSchwartzResponse());

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    await generateSchwartzProfile({ substrate });

    const row = (await db
      .select()
      .from(profileSchwartz)
      .where(eq(profileSchwartz.name, 'primary'))
      .limit(1))[0]!;
    expect(row.substrateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 6. last_updated host-injection (Pitfall 7) ───────────────────────

  it('invalid Sonnet last_updated tolerated via host injection before v3 re-validate', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: {
        ...validSchwartzResponse().parsed_output,
        self_direction: { score: 4.0, confidence: 0.5, last_updated: 'not-a-datetime' },
      },
    });

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    const outcome = await generateSchwartzProfile({ substrate });

    expect(outcome.outcome).toBe('updated');
    expect(mockLoggerError).not.toHaveBeenCalled();

    const row = (await db
      .select()
      .from(profileSchwartz)
      .where(eq(profileSchwartz.name, 'primary'))
      .limit(1))[0]!;
    const sd = row.selfDirection as unknown as { last_updated: string } | null;
    expect(sd).not.toBeNull();
    expect(sd!.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── 7. Error isolation — malformed Sonnet output ─────────────────────

  it('malformed Sonnet output returns error outcome without throwing', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: { malformed: true, data_consistency: 0.5, overall_confidence: 0.5 },
    });

    const substrate = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    const outcome = await generateSchwartzProfile({ substrate });

    expect(outcome.outcome).toBe('error');
    if (outcome.outcome === 'error') {
      expect(outcome.error).toBeTruthy();
    }
    const errorLogCalls = mockLoggerWarn.mock.calls.filter(
      (c) => c[1] === 'chris.psychological.schwartz.error',
    );
    expect(errorLogCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── 8. NO hash-skip regression guard (Pitfall 1) ─────────────────────

  it('identical substrate across 2 cycles → cumulative 2 Sonnet calls (NOT 1 — UNCONDITIONAL FIRE)', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValue(validSchwartzResponse());

    const substrate1 = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    const outcome1 = await generateSchwartzProfile({ substrate: substrate1 });
    expect(outcome1.outcome).toBe('updated');
    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);

    const substrate2 = await loadPsychologicalSubstrate('schwartz', PINNED_NOW);
    const outcome2 = await generateSchwartzProfile({ substrate: substrate2 });
    expect(outcome2.outcome).toBe('updated');

    expect(mockAnthropicParse).toHaveBeenCalledTimes(2);

    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(2);
  });
});
