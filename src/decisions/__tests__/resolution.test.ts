/**
 * Phase 16 Wave 0 RED scaffold — Resolution + Post-mortem accountability.
 * Covers RES-02 through RES-06.
 *
 * ALL tests are intentionally failing (RED). They import functions that do not
 * yet exist (src/decisions/resolution.ts). Plans 03-05 will turn these GREEN.
 *
 * Run: npx vitest run src/decisions/__tests__/resolution.test.ts
 */
// @ts-expect-error — Plan 03 creates src/decisions/resolution.ts
import { handleResolution, handlePostmortem, classifyOutcome } from '../resolution.js';
// @ts-expect-error — Plan 03 adds getTemporalPensieve to src/pensieve/retrieve.ts
import { getTemporalPensieve } from '../../pensieve/retrieve.js';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  pensieveEntries,
} from '../../db/schema.js';

// ── Mock Anthropic client ──────────────────────────────────────────────────

const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate },
  },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
  OPUS_MODEL: 'test-opus',
  callLLM: vi.fn().mockResolvedValue('{}'),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

async function seedDecision(status: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(decisions)
    .values({
      status: status as never,
      decisionText: 'I will quit my job and go consulting',
      resolveBy: new Date(Date.now() + 86_400_000),
      reasoning: 'consulting pays more',
      prediction: "I'll be happier within 3 months",
      falsificationCriterion: 'I am not happier after 3 months',
      ...overrides,
    })
    .returning();
  return row!.id as string;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('handleResolution', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await db.delete(pensieveEntries);
    await db.delete(decisionEvents);
    await db.delete(decisions);
    await db.delete(decisionCaptureState);
    vi.restoreAllMocks();
  });

  it('transitions decision from due to resolved', async () => {
    const decisionId = await seedDecision('due');
    await db.insert(decisionCaptureState).values({
      chatId: 100n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I acknowledge your resolution.' }],
    });

    await handleResolution(100n, 'I quit and it was the right call.', decisionId);

    const [row] = await db.select().from(decisions);
    expect(row!.status).toBe('resolved');
  });

  it('stores resolution text on the decision row', async () => {
    const decisionId = await seedDecision('due');
    await db.insert(decisionCaptureState).values({
      chatId: 101n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Acknowledged.' }],
    });

    await handleResolution(101n, 'I stayed and regret it.', decisionId);

    const [row] = await db.select().from(decisions);
    expect(row!.resolution).toContain('I stayed and regret it.');
  });

  it('sets capture state to AWAITING_POSTMORTEM', async () => {
    const decisionId = await seedDecision('due');
    await db.insert(decisionCaptureState).values({
      chatId: 102n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Noted.' }],
    });

    await handleResolution(102n, 'Things went well.', decisionId);

    const [captureRow] = await db.select().from(decisionCaptureState);
    expect(captureRow!.stage).toBe('AWAITING_POSTMORTEM');
  });

  it('writes two Pensieve entries with DECISION tag and sourceRefId', async () => {
    const decisionId = await seedDecision('due');
    await db.insert(decisionCaptureState).values({
      chatId: 103n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Acknowledged.' }],
    });

    await handleResolution(103n, 'I did it.', decisionId);

    const entries = await db.select().from(pensieveEntries);
    const decisionEntries = entries.filter(
      (e) => (e.metadata as Record<string, unknown>)?.sourceRefId === decisionId,
    );
    expect(decisionEntries.length).toBeGreaterThanOrEqual(2);
    for (const entry of decisionEntries) {
      expect(entry.epistemicTag).toBe('DECISION');
    }
  });

  it('returns acknowledgment concatenated with post-mortem question', async () => {
    const decisionId = await seedDecision('due');
    await db.insert(decisionCaptureState).values({
      chatId: 104n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Thanks for sharing how it went.' }],
    });

    const response = await handleResolution(104n, 'It was a miss.', decisionId);

    // Should include both acknowledgment and post-mortem follow-up
    expect(response).toContain('Thanks for sharing');
    expect(response).toContain('\n');
  });

  it('catches OptimisticConcurrencyError gracefully on concurrent transition', async () => {
    const decisionId = await seedDecision('resolved'); // already resolved — simulates concurrent sweep
    await db.insert(decisionCaptureState).values({
      chatId: 105n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId,
    });

    // Should not throw — should handle gracefully
    const response = await handleResolution(105n, 'I did it.', decisionId);
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });
});

describe('handlePostmortem', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await db.delete(pensieveEntries);
    await db.delete(decisionEvents);
    await db.delete(decisions);
    await db.delete(decisionCaptureState);
    vi.restoreAllMocks();
  });

  it('stores resolution_notes on the decision row', async () => {
    const decisionId = await seedDecision('resolved');
    await db.insert(decisionCaptureState).values({
      chatId: 200n,
      stage: 'AWAITING_POSTMORTEM' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Noted.' }],
    });

    await handlePostmortem(200n, 'I learned that I overestimated my speed.', decisionId);

    const [row] = await db.select().from(decisions);
    expect(row!.resolutionNotes).toContain('I learned that I overestimated my speed.');
  });

  it('transitions decision from resolved to reviewed', async () => {
    const decisionId = await seedDecision('resolved');
    await db.insert(decisionCaptureState).values({
      chatId: 201n,
      stage: 'AWAITING_POSTMORTEM' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Noted.' }],
    });

    await handlePostmortem(201n, 'It was a hit.', decisionId);

    const [row] = await db.select().from(decisions);
    expect(row!.status).toBe('reviewed');
  });

  it('clears capture state', async () => {
    const decisionId = await seedDecision('resolved');
    await db.insert(decisionCaptureState).values({
      chatId: 202n,
      stage: 'AWAITING_POSTMORTEM' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Noted.' }],
    });

    await handlePostmortem(202n, 'Post-mortem notes.', decisionId);

    const rows = await db.select().from(decisionCaptureState);
    expect(rows.length).toBe(0);
  });

  it('returns one-line acknowledgment in user language', async () => {
    const decisionId = await seedDecision('resolved');
    await db.insert(decisionCaptureState).values({
      chatId: 203n,
      stage: 'AWAITING_POSTMORTEM' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Noted.' }],
    });

    const response = await handlePostmortem(203n, 'All done.', decisionId);

    // Should return a short one-line acknowledgment
    const validAcks = ['Noted.', 'Note.', 'Принято.'];
    const isValidAck = validAcks.some((ack) => response.trim().startsWith(ack)) ||
      response.trim().length < 50;
    expect(isValidAck).toBe(true);
  });

  it('writes Pensieve entry for post-mortem answer', async () => {
    const decisionId = await seedDecision('resolved');
    await db.insert(decisionCaptureState).values({
      chatId: 204n,
      stage: 'AWAITING_POSTMORTEM' as never,
      draft: {},
      decisionId,
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Noted.' }],
    });

    await handlePostmortem(204n, 'I learned I should slow down.', decisionId);

    const entries = await db.select().from(pensieveEntries);
    const decisionEntries = entries.filter(
      (e) => (e.metadata as Record<string, unknown>)?.sourceRefId === decisionId,
    );
    expect(decisionEntries.length).toBeGreaterThanOrEqual(1);
    expect(decisionEntries[0]!.epistemicTag).toBe('DECISION');
  });
});

describe('classifyOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns hit for confirmed prediction', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"outcome":"hit"}' }],
    });

    const result = await classifyOutcome(
      'I will be happier within 3 months',
      'I was happier within 3 months',
    );
    expect(result).toBe('hit');
  });

  it('returns miss for falsified prediction', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"outcome":"miss"}' }],
    });

    const result = await classifyOutcome(
      'I will be happier within 3 months',
      'I was not happier at all',
    );
    expect(result).toBe('miss');
  });

  it('falls back to ambiguous on parse failure', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'garbage non-json output here' }],
    });

    const result = await classifyOutcome(
      'I will be happier within 3 months',
      'some resolution text',
    );
    expect(result).toBe('ambiguous');
  });
});

describe('getTemporalPensieve', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await db.delete(pensieveEntries);
  });

  it('returns entries within +/-48h window only', async () => {
    const center = new Date('2026-04-16T12:00:00Z');
    const minus72h = new Date(center.getTime() - 72 * 3600_000);
    const minus24h = new Date(center.getTime() - 24 * 3600_000);
    const plus24h = new Date(center.getTime() + 24 * 3600_000);
    const plus72h = new Date(center.getTime() + 72 * 3600_000);

    await db.insert(pensieveEntries).values([
      {
        content: 'entry at -72h',
        source: 'telegram',
        epistemicTag: 'OBSERVATION',
        createdAt: minus72h,
      },
      {
        content: 'entry at -24h',
        source: 'telegram',
        epistemicTag: 'OBSERVATION',
        createdAt: minus24h,
      },
      {
        content: 'entry at +24h',
        source: 'telegram',
        epistemicTag: 'OBSERVATION',
        createdAt: plus24h,
      },
      {
        content: 'entry at +72h',
        source: 'telegram',
        epistemicTag: 'OBSERVATION',
        createdAt: plus72h,
      },
    ]);

    const results = await getTemporalPensieve(center, 48 * 3600_000);
    const contents = results.map((r: { content: string }) => r.content);

    expect(contents).toContain('entry at -24h');
    expect(contents).toContain('entry at +24h');
    expect(contents).not.toContain('entry at -72h');
    expect(contents).not.toContain('entry at +72h');
  });

  it('excludes soft-deleted entries', async () => {
    const center = new Date('2026-04-16T12:00:00Z');
    const minus12h = new Date(center.getTime() - 12 * 3600_000);

    await db.insert(pensieveEntries).values([
      {
        content: 'live entry',
        source: 'telegram',
        epistemicTag: 'OBSERVATION',
        createdAt: minus12h,
      },
      {
        content: 'deleted entry',
        source: 'telegram',
        epistemicTag: 'OBSERVATION',
        createdAt: minus12h,
        deletedAt: new Date(),
      },
    ]);

    const results = await getTemporalPensieve(center, 48 * 3600_000);
    const contents = results.map((r: { content: string }) => r.content);

    expect(contents).toContain('live entry');
    expect(contents).not.toContain('deleted entry');
  });
});
