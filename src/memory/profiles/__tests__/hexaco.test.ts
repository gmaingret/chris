/**
 * src/memory/profiles/__tests__/hexaco.test.ts — Phase 38 Plan 38-02 Task 3
 *
 * Per-generator unit test for generateHexacoProfile (PGEN-02). Real Docker
 * postgres + mocked Anthropic SDK + mocked logger.
 *
 * Coverage:
 *   1. Below-threshold short-circuit (PSCH-08 → PGEN-02) — no Sonnet call,
 *      outcome 'skipped_below_threshold'.
 *   2. Above-threshold happy path — Sonnet call, row populated, profile_history
 *      row written, outcome 'updated' with overall_confidence verbatim.
 *   3. Sonnet system text routing — assembled prompt contains the HEXACO
 *      directive header + PSYCHOLOGICAL_HARD_RULE_EXTENSION.
 *   4. prevHistorySnapshot threading (PGEN-07) — prior snapshot is serialized
 *      into the assembled system text.
 *   5. substrate_hash audit-trail (PGEN-06) — post-call row has 64-char hex.
 *   6. last_updated host-injection (Pitfall 7) — invalid datetime in Sonnet
 *      output is tolerated because the host overwrites with ISO before v3
 *      re-validate.
 *   7. Error isolation — malformed Sonnet output returns 'error' outcome
 *      without throwing.
 *   8. NO hash-skip regression guard (Pitfall 1) — Cycle 1+2 with identical
 *      substrate produces cumulative 2 Sonnet calls, NOT 1.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/hexaco.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

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

// Imports AFTER vi.mock so modules under test see the mocked deps.
import { sql, eq } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  pensieveEntries,
  profileHexaco,
  profileHistory,
} from '../../../db/schema.js';
import { loadPsychologicalSubstrate } from '../psychological-shared.js';
import { generateHexacoProfile } from '../hexaco.js';
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from '../../psychological-profile-prompt.js';

// ── Test fixtures ──────────────────────────────────────────────────────

// Anchor NOW deterministically. Previous calendar month (Europe/Paris) is
// April 2026. We seed corpus into mid-April so it falls inside the window.
const PINNED_NOW = new Date('2026-05-01T09:00:00Z');
const IN_WINDOW_APRIL = new Date('2026-04-15T10:00:00Z');

/**
 * Valid Sonnet HEXACO response — 6 dim objects with valid datetime
 * `last_updated` + top-level data_consistency + overall_confidence. Mimics
 * a well-formed structured-output emission.
 */
function validHexacoResponse() {
  return {
    parsed_output: {
      honesty_humility: { score: 4.2, confidence: 0.6, last_updated: '2026-04-15T09:00:00.000Z' },
      emotionality: { score: 3.1, confidence: 0.5, last_updated: '2026-04-15T09:00:00.000Z' },
      extraversion: { score: 3.8, confidence: 0.55, last_updated: '2026-04-15T09:00:00.000Z' },
      agreeableness: { score: 3.5, confidence: 0.5, last_updated: '2026-04-15T09:00:00.000Z' },
      conscientiousness: { score: 4.0, confidence: 0.65, last_updated: '2026-04-15T09:00:00.000Z' },
      openness: { score: 4.5, confidence: 0.7, last_updated: '2026-04-15T09:00:00.000Z' },
      data_consistency: 0.55,
      overall_confidence: 0.62,
    },
  };
}

async function cleanupAll() {
  // Truncate pensieve_entries + episodic_summaries + profile_history.
  // profile_hexaco is preserved (migration 0013 seeded the 'primary' row;
  // we reset its mutable columns below instead of truncating).
  await db.delete(profileHistory);
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  // Reset profile_hexaco 'primary' row to cold-start state. Dim columns are
  // jsonb .notNull() with default 'null'::jsonb; use sql`'null'::jsonb` to
  // restore that exact value (NOT JS null which would be SQL NULL).
  await db
    .update(profileHexaco)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      honestyHumility: sql`'null'::jsonb`,
      emotionality: sql`'null'::jsonb`,
      extraversion: sql`'null'::jsonb`,
      agreeableness: sql`'null'::jsonb`,
      conscientiousness: sql`'null'::jsonb`,
      openness: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileHexaco.name, 'primary'));
}

/**
 * Seed 6000 words of telegram-source pensieve entries into the April 2026
 * window so the substrate loader crosses the 5000-word floor.
 */
async function seedAboveThresholdCorpus() {
  // Insert 6 rows × ~1000 words each = 6000 total words.
  for (let i = 0; i < 6; i++) {
    await db.insert(pensieveEntries).values({
      content: `entry ${i} ` + ('word '.repeat(1000)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_APRIL,
    });
  }
}

describe('generateHexacoProfile (PGEN-02)', () => {
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
    // 100 words is far below the 5000-word floor.
    await db.insert(pensieveEntries).values({
      content: ('word '.repeat(100)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_APRIL,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(true);

    const outcome = await generateHexacoProfile({ substrate });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(0);
    expect(outcome.outcome).toBe('skipped_below_threshold');
    expect(outcome.profileType).toBe('hexaco');
    if (outcome.outcome === 'skipped_below_threshold') {
      expect(outcome.wordCount).toBe(100);
    }

    // Verbatim log key emitted
    const skipLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.psychological.hexaco.skipped_below_threshold',
    );
    expect(skipLogCalls).toHaveLength(1);
  });

  // ── 2. Above-threshold happy path ─────────────────────────────────────

  it('above-threshold substrate + valid Sonnet response → updated outcome with full row state', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValueOnce(validHexacoResponse());

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);

    const outcome = await generateHexacoProfile({ substrate });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe('updated');
    expect(outcome.profileType).toBe('hexaco');
    if (outcome.outcome === 'updated') {
      expect(outcome.overallConfidence).toBe(0.62);
      expect(outcome.wordCount).toBeGreaterThan(5000);
    }

    // Row state
    const rows = await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1);
    const row = rows[0]!;
    expect(row.name).toBe('primary');
    expect(row.overallConfidence).toBeCloseTo(0.62, 5);
    expect(row.wordCount).toBeGreaterThan(5000);
    expect(row.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.honestyHumility).not.toBeNull();
    expect(row.openness).not.toBeNull();

    // profile_history has 1 new row with the prior (cold-start) snapshot
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(1);
    expect(history[0]!.profileTableName).toBe('profile_hexaco');
    // The snapshot includes the previous (cold-start) overallConfidence=0
    const snap = history[0]!.snapshot as unknown as { overallConfidence: number };
    expect(snap.overallConfidence).toBe(0);
  });

  // ── 3. Sonnet system text routing ─────────────────────────────────────

  it('assembled system text contains HEXACO directive + PSYCHOLOGICAL_HARD_RULE_EXTENSION', async () => {
    await seedAboveThresholdCorpus();

    let capturedSystemText = '';
    mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
      capturedSystemText = req.system?.[0]?.text ?? '';
      return Promise.resolve(validHexacoResponse());
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    await generateHexacoProfile({ substrate });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
    expect(capturedSystemText).toContain('## Profile Focus — HEXACO Big-Six Personality');
    expect(capturedSystemText).toContain(PSYCHOLOGICAL_HARD_RULE_EXTENSION);
  });

  // ── 4. prevHistorySnapshot threading (PGEN-07) ───────────────────────

  it('prior profile_history snapshot is threaded into the prompt', async () => {
    await seedAboveThresholdCorpus();

    // Insert a prior profile_history row with a known snapshot.
    const knownSnapshot = {
      honesty_humility: { score: 3.0, confidence: 0.4, last_updated: '2026-03-15T09:00:00Z' },
      data_consistency: 0.3,
      overall_confidence: 0.35,
    };
    // We need a profileId from the profile_hexaco primary row.
    const primary = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;
    await db.insert(profileHistory).values({
      profileTableName: 'profile_hexaco',
      profileId: primary.id,
      snapshot: knownSnapshot,
    });

    let capturedSystemText = '';
    mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
      capturedSystemText = req.system?.[0]?.text ?? '';
      return Promise.resolve(validHexacoResponse());
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    // Sanity: prevHistorySnapshot was loaded
    expect(substrate.prevHistorySnapshot).not.toBeNull();

    await generateHexacoProfile({ substrate });

    // Assembled system text contains the prevState block (D-09 conditional
    // injection — non-null prevState renders under '## CURRENT PROFILE
    // STATE'). The JSON-stringify ordering is postgres jsonb-determined
    // (alphabetical), not source-literal-determined, so we assert on field
    // contents rather than literal stringification.
    expect(capturedSystemText).toContain('## CURRENT PROFILE STATE');
    expect(capturedSystemText).toContain('"honesty_humility"');
    expect(capturedSystemText).toContain('"score": 3');
    expect(capturedSystemText).toContain('"overall_confidence": 0.35');
    expect(capturedSystemText).toContain('"data_consistency": 0.3');
  });

  // ── 5. Substrate-hash audit trail (PGEN-06) ──────────────────────────

  it('post-fire row has 64-char hex substrate_hash (audit-trail only; not used for skip)', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValueOnce(validHexacoResponse());

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    await generateHexacoProfile({ substrate });

    const row = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;
    expect(row.substrateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 6. last_updated host-injection (Pitfall 7) ───────────────────────

  it('invalid Sonnet last_updated tolerated via host injection before v3 re-validate', async () => {
    await seedAboveThresholdCorpus();
    // Sonnet returns one dim with a malformed last_updated. Host should
    // overwrite with `new Date().toISOString()` BEFORE v3 re-validate, so
    // the v3 `.datetime().strict()` constraint passes.
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: {
        ...validHexacoResponse().parsed_output,
        honesty_humility: { score: 4.0, confidence: 0.5, last_updated: 'not-a-datetime' },
      },
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    const outcome = await generateHexacoProfile({ substrate });

    expect(outcome.outcome).toBe('updated');
    expect(mockLoggerError).not.toHaveBeenCalled();

    // The persisted row has a valid ISO last_updated (host-injected)
    const row = (await db
      .select()
      .from(profileHexaco)
      .where(eq(profileHexaco.name, 'primary'))
      .limit(1))[0]!;
    const hh = row.honestyHumility as unknown as { last_updated: string } | null;
    expect(hh).not.toBeNull();
    expect(hh!.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ── 7. Error isolation — malformed Sonnet output ─────────────────────

  it('malformed Sonnet output returns error outcome without throwing', async () => {
    await seedAboveThresholdCorpus();
    // Omits all 6 HEXACO dim keys — Zod v3 boundary re-validate fails.
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: { malformed: true, data_consistency: 0.5, overall_confidence: 0.5 },
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    const outcome = await generateHexacoProfile({ substrate });

    expect(outcome.outcome).toBe('error');
    if (outcome.outcome === 'error') {
      expect(outcome.error).toBeTruthy();
    }
    // logger.warn was called with the error key
    const errorLogCalls = mockLoggerWarn.mock.calls.filter(
      (c) => c[1] === 'chris.psychological.hexaco.error',
    );
    expect(errorLogCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── 8. NO hash-skip regression guard (Pitfall 1) ─────────────────────

  it('identical substrate across 2 cycles → cumulative 2 Sonnet calls (NOT 1 — UNCONDITIONAL FIRE)', async () => {
    await seedAboveThresholdCorpus();
    mockAnthropicParse.mockResolvedValue(validHexacoResponse()); // any call returns valid

    // Cycle 1
    const substrate1 = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    const outcome1 = await generateHexacoProfile({ substrate: substrate1 });
    expect(outcome1.outcome).toBe('updated');
    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);

    // Cycle 2 — IDENTICAL substrate (no DB mutation, same `now`).
    // PGEN-06 UNCONDITIONAL FIRE: substrate_hash matches but Sonnet is
    // still called. profile_history grows by 1 row per cycle.
    const substrate2 = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    const outcome2 = await generateHexacoProfile({ substrate: substrate2 });
    expect(outcome2.outcome).toBe('updated');

    // CRITICAL — INVERSE OF M010 hash-skip semantics
    expect(mockAnthropicParse).toHaveBeenCalledTimes(2);

    // profile_history has 2 rows (one per fire)
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(2);
  });
});
