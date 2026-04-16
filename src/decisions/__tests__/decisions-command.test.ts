/**
 * Phase 17 Plan 03 — /decisions command handler integration tests.
 *
 * Tests all sub-commands:
 *   - (no-args) returns counts dashboard, not usage text
 *   - open  → sorted one-liners or no-open message
 *   - recent → newest-first or no-recent message
 *   - stats [window] → accuracy block or invalid-window error
 *   - suppressions → list active or no-suppressions message
 *   - unsuppress <phrase> → removed confirmation or not-found message
 *   - reclassify → re-classifies reviewed decisions sequentially, writes events
 *   - unknown sub → updated usage message
 *
 * DB-backed tests use Docker Postgres (real rows via Drizzle inserts).
 * LLM calls (classifyOutcome, classifyAccuracy) are mocked for reclassify tests.
 *
 * Run: npx vitest run src/decisions/__tests__/decisions-command.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Context } from 'grammy';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
} from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { handleDecisionsCommand } from '../../bot/handlers/decisions.js';

// ── Mock language helper (always returns English) ───────────────────────────

vi.mock('../../chris/language.js', () => ({
  getLastUserLanguage: vi.fn().mockReturnValue('English'),
  detectLanguage: vi.fn().mockReturnValue('English'),
}));

// ── Mock LLM calls used by reclassify ───────────────────────────────────────

vi.mock('../../decisions/resolution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../decisions/resolution.js')>();
  return {
    ...actual,
    classifyOutcome: vi.fn().mockResolvedValue('hit'),
  };
});

vi.mock('../../decisions/classify-accuracy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../decisions/classify-accuracy.js')>();
  return {
    ...actual,
    classifyAccuracy: vi.fn().mockResolvedValue('sound'),
  };
});

// ── Shared DB lifecycle ───────────────────────────────────────────────────────

const TEST_CHAT_ID = 77001;
const TEST_CHAT_BIG = BigInt(TEST_CHAT_ID);

async function cleanupTables() {
  await db.delete(decisionEvents);
  await db.delete(decisions);
  await db.delete(decisionCaptureState);
  await db.delete(decisionTriggerSuppressions);
}

beforeAll(async () => {
  const result = await sql`SELECT 1 as ok`;
  expect(result[0]!.ok).toBe(1);
});

afterAll(async () => {
  await sql.end();
});

afterEach(async () => {
  await cleanupTables();
  vi.clearAllMocks();
});

// ── ctx helper ────────────────────────────────────────────────────────────────

function makeCtx(commandText: string): { ctx: Context; replies: string[] } {
  const replies: string[] = [];
  const ctx = {
    chat: { id: TEST_CHAT_ID },
    message: { text: commandText },
    reply: vi.fn().mockImplementation((text: string) => {
      replies.push(text);
      return Promise.resolve();
    }),
  } as unknown as Context;
  return { ctx, replies };
}

// ── Helper: insert a minimal decision row ─────────────────────────────────────

async function insertDecision(overrides: {
  status?: 'open-draft' | 'open' | 'due' | 'resolved' | 'reviewed' | 'withdrawn' | 'stale' | 'abandoned';
  accuracyClass?: string | null;
  domainTag?: string | null;
  resolvedAt?: Date | null;
  resolveBy?: Date;
  decisionText?: string;
  prediction?: string;
  resolution?: string | null;
} = {}) {
  const defaults = {
    status: 'reviewed' as const,
    decisionText: 'Test decision',
    reasoning: 'Test reasoning',
    prediction: 'Test prediction',
    falsificationCriterion: 'Test criterion',
    resolveBy: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    chatId: TEST_CHAT_BIG,
    resolvedAt: new Date(),
    accuracyClass: null as string | null,
    domainTag: null as string | null,
    resolution: null as string | null,
  };
  const merged = { ...defaults, ...overrides };
  const result = await db.insert(decisions).values({
    status: merged.status,
    decisionText: merged.decisionText,
    reasoning: merged.reasoning,
    prediction: merged.prediction,
    falsificationCriterion: merged.falsificationCriterion,
    resolveBy: merged.resolveBy,
    chatId: merged.chatId,
    resolvedAt: merged.resolvedAt,
    accuracyClass: merged.accuracyClass,
    domainTag: merged.domainTag,
    resolution: merged.resolution,
  }).returning({ id: decisions.id });
  return result[0]!.id;
}

// ── Test: no-args returns dashboard ──────────────────────────────────────────

describe('/decisions (no args) — dashboard', () => {
  it('returns counts dashboard, not usage text', async () => {
    await insertDecision({ status: 'open' });
    await insertDecision({ status: 'reviewed', accuracyClass: 'hit/sound' });

    const { ctx, replies } = makeCtx('/decisions');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    // Dashboard contains count info, not usage message
    expect(replies[0]).toContain('open');
    expect(replies[0]).not.toContain('Usage:');
    expect(replies[0]).not.toContain('Coming in Phase');
  });

  it('dashboard contains sub-command list at the bottom', async () => {
    const { ctx, replies } = makeCtx('/decisions');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('/decisions open');
  });
});

// ── Test: /decisions open ────────────────────────────────────────────────────

describe('/decisions open', () => {
  it('returns sorted one-liners when open decisions exist', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await insertDecision({ status: 'open', decisionText: 'Later decision', resolveBy: later });
    await insertDecision({ status: 'open', decisionText: 'Soon decision', resolveBy: soon });

    const { ctx, replies } = makeCtx('/decisions open');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    const text = replies[0]!;
    // "Soon decision" should appear before "Later decision" (soonest-first)
    expect(text.indexOf('Soon decision')).toBeLessThan(text.indexOf('Later decision'));
  });

  it('returns no-open message when no open decisions exist', async () => {
    const { ctx, replies } = makeCtx('/decisions open');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toBe('No open decisions.');
  });
});

// ── Test: /decisions recent ───────────────────────────────────────────────────

describe('/decisions recent', () => {
  it('returns newest-first one-liners when recent decisions exist', async () => {
    const older = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const newer = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await insertDecision({
      status: 'reviewed',
      decisionText: 'Older decision',
      resolvedAt: older,
      accuracyClass: 'hit/sound',
    });
    await insertDecision({
      status: 'reviewed',
      decisionText: 'Newer decision',
      resolvedAt: newer,
      accuracyClass: 'miss/flawed',
    });

    const { ctx, replies } = makeCtx('/decisions recent');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    const text = replies[0]!;
    // "Newer decision" should appear before "Older decision" (newest-first)
    expect(text.indexOf('Newer decision')).toBeLessThan(text.indexOf('Older decision'));
  });

  it('returns no-recent message when no resolved decisions exist', async () => {
    await insertDecision({ status: 'open' });

    const { ctx, replies } = makeCtx('/decisions recent');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toBe('No recent decisions.');
  });
});

// ── Test: /decisions suppressions ────────────────────────────────────────────

describe('/decisions suppressions', () => {
  it('lists active suppression phrases', async () => {
    await db.insert(decisionTriggerSuppressions).values([
      { chatId: TEST_CHAT_BIG, phrase: 'thinking about' },
      { chatId: TEST_CHAT_BIG, phrase: 'considering' },
    ]);

    const { ctx, replies } = makeCtx('/decisions suppressions');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('thinking about');
    expect(replies[0]).toContain('considering');
    expect(replies[0]).toContain('Active suppressions:');
  });

  it('returns no-suppressions message when list is empty', async () => {
    const { ctx, replies } = makeCtx('/decisions suppressions');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toBe('No active suppressions.');
  });
});

// ── Test: /decisions unsuppress <phrase> ─────────────────────────────────────

describe('/decisions unsuppress', () => {
  it('removes an existing phrase and confirms', async () => {
    await db.insert(decisionTriggerSuppressions).values({
      chatId: TEST_CHAT_BIG,
      phrase: 'thinking about',
    });

    const { ctx, replies } = makeCtx('/decisions unsuppress thinking about');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('Removed suppression');
    expect(replies[0]).toContain('thinking about');

    // Verify it's actually gone
    const remaining = await db.select()
      .from(decisionTriggerSuppressions)
      .where(and(
        eq(decisionTriggerSuppressions.chatId, TEST_CHAT_BIG),
        eq(decisionTriggerSuppressions.phrase, 'thinking about'),
      ));
    expect(remaining).toHaveLength(0);
  });

  it('reports not found for a phrase that does not exist', async () => {
    const { ctx, replies } = makeCtx('/decisions unsuppress no such phrase');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('Suppression not found');
    expect(replies[0]).toContain('no such phrase');
  });

  it('returns usage message when no phrase arg given', async () => {
    const { ctx, replies } = makeCtx('/decisions unsuppress');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('unsuppress');
    expect(replies[0]).toContain('Usage');
  });
});

// ── Test: unknown sub-command returns updated usage message ───────────────────

describe('/decisions <unknown sub>', () => {
  it('returns usage message for unknown sub-command', async () => {
    const { ctx, replies } = makeCtx('/decisions unknownsubcommand');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('Usage:');
    expect(replies[0]).toContain('open');
    expect(replies[0]).toContain('recent');
    expect(replies[0]).toContain('stats');
    expect(replies[0]).toContain('suppressions');
    expect(replies[0]).toContain('reclassify');
  });
});

// ── Test: /decisions stats ────────────────────────────────────────────────────

describe('/decisions stats', () => {
  it('stats with no arg uses 90-day default', async () => {
    const { ctx, replies } = makeCtx('/decisions stats');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    // formatStatsBlock with empty rows shows "90-day window: N=0, threshold not met"
    expect(replies[0]).toContain('90');
  });

  it('stats 30 returns 30-day stats', async () => {
    const { ctx, replies } = makeCtx('/decisions stats 30');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('30');
  });

  it('stats 365 returns 365-day stats', async () => {
    const { ctx, replies } = makeCtx('/decisions stats 365');
    await handleDecisionsCommand(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('365');
  });

  it('stats 7 returns invalid window error (T-17-03-01)', async () => {
    const { ctx, replies } = makeCtx('/decisions stats 7');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('Valid windows: 30, 90, 365');
  });

  it('stats 999 returns invalid window error', async () => {
    const { ctx, replies } = makeCtx('/decisions stats 999');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toContain('Valid windows: 30, 90, 365');
  });
});

// ── Test: /decisions reclassify ───────────────────────────────────────────────

describe('/decisions reclassify', () => {
  it('reclassify with 0 reviewed decisions replies no-reclassify message', async () => {
    await insertDecision({ status: 'open' }); // open, not reviewed

    const { ctx, replies } = makeCtx('/decisions reclassify');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toBe('No reviewed decisions to reclassify.');
  });

  it('reclassify with 2 reviewed decisions calls classifyOutcome + classifyAccuracy sequentially', async () => {
    const { classifyOutcome } = await import('../../decisions/resolution.js');
    const { classifyAccuracy } = await import('../../decisions/classify-accuracy.js');

    await insertDecision({
      status: 'reviewed',
      resolution: 'It happened as predicted',
      decisionText: 'Decision A',
    });
    await insertDecision({
      status: 'reviewed',
      resolution: 'It did not happen',
      decisionText: 'Decision B',
    });

    const { ctx, replies } = makeCtx('/decisions reclassify');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toBe('Reclassified 2 decisions.');
    expect(vi.mocked(classifyOutcome)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(classifyAccuracy)).toHaveBeenCalledTimes(2);
  });

  it('reclassify updates decisions rows with new accuracyClass', async () => {
    const id = await insertDecision({
      status: 'reviewed',
      resolution: 'It happened',
      accuracyClass: null,
    });

    const { ctx } = makeCtx('/decisions reclassify');
    await handleDecisionsCommand(ctx);

    const updated = await db.select({ accuracyClass: decisions.accuracyClass })
      .from(decisions)
      .where(eq(decisions.id, id));
    // classifyOutcome mock returns 'hit', classifyAccuracy mock returns 'sound'
    expect(updated[0]!.accuracyClass).toBe('hit/sound');
  });

  it('reclassify appends classified events to decision_events (originals preserved)', async () => {
    const id1 = await insertDecision({ status: 'reviewed', resolution: 'Happened' });
    const id2 = await insertDecision({ status: 'reviewed', resolution: 'Did not happen' });

    // Insert pre-existing events to verify they are NOT removed
    await db.insert(decisionEvents).values([
      { decisionId: id1, eventType: 'status_changed', snapshot: { from: 'open', to: 'reviewed' }, actor: 'system' },
      { decisionId: id2, eventType: 'status_changed', snapshot: { from: 'open', to: 'reviewed' }, actor: 'system' },
    ]);

    const { ctx } = makeCtx('/decisions reclassify');
    await handleDecisionsCommand(ctx);

    // Each decision should have the pre-existing event PLUS a new classified event
    for (const id of [id1, id2]) {
      const events = await db.select()
        .from(decisionEvents)
        .where(eq(decisionEvents.decisionId, id));
      expect(events.length).toBeGreaterThanOrEqual(2);
      const classifiedEvents = events.filter(e => e.eventType === 'classified');
      expect(classifiedEvents).toHaveLength(1);
      const statusEvents = events.filter(e => e.eventType === 'status_changed');
      expect(statusEvents).toHaveLength(1); // original preserved
    }
  });

  it('reclassify replies with count of reclassified decisions', async () => {
    await insertDecision({ status: 'reviewed', resolution: 'Happened' });
    await insertDecision({ status: 'reviewed', resolution: 'Happened again' });
    await insertDecision({ status: 'reviewed', resolution: 'Did not happen' });

    const { ctx, replies } = makeCtx('/decisions reclassify');
    await handleDecisionsCommand(ctx);

    expect(replies[0]).toBe('Reclassified 3 decisions.');
  });

  it('reclassify only processes reviewed decisions with non-null resolution', async () => {
    // This one should be reclassified (reviewed + has resolution)
    await insertDecision({ status: 'reviewed', resolution: 'Done' });
    // These should NOT be reclassified
    await insertDecision({ status: 'reviewed', resolution: null }); // no resolution
    await insertDecision({ status: 'open', resolution: null }); // wrong status

    const { classifyOutcome } = await import('../../decisions/resolution.js');

    const { ctx, replies } = makeCtx('/decisions reclassify');
    await handleDecisionsCommand(ctx);

    // Only 1 reviewed+resolution row qualifies
    expect(replies[0]).toBe('Reclassified 1 decisions.');
    expect(vi.mocked(classifyOutcome)).toHaveBeenCalledTimes(1);
  });
});
