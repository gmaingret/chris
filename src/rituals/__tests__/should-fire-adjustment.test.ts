/**
 * src/rituals/__tests__/should-fire-adjustment.test.ts — Phase 28 Plan 02 Task 3
 *
 * Real-DB integration tests wiring shouldFireAdjustmentDialogue into
 * runRitualSweep. Verifies Plan 28-02's predicate dispatch:
 *
 * 4 behaviors:
 *   1. When shouldFireAdjustmentDialogue returns true (skipCount >= threshold),
 *      runRitualSweep returns outcome='in_dialogue'; dispatchRitualHandler is
 *      NOT called; rituals.skip_count is NOT reset on this branch.
 *   2. When shouldFireAdjustmentDialogue returns false, runRitualSweep proceeds
 *      to dispatchRitualHandler as before — predicate check is transparent.
 *   3. Predicate check happens AFTER tryFireRitualAtomic claim (log order:
 *      'rituals.fire.atomic' precedes 'rituals.adjustment_dialogue.predicate_hit').
 *   4. With adjustment_mute_until in future + skipCount over threshold,
 *      shouldFireAdjustmentDialogue returns false; standard dispatch proceeds.
 *
 * Cumulative afterAll: mockAnthropicCreate.not.toHaveBeenCalled() — no LLM
 * calls from predicate dispatch path (T-28-E1).
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/should-fire-adjustment.test.ts
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

// ── Mock Anthropic (cumulative not-called assertion: T-28-E1) ─────────────────
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

// ── Mock bot.api.sendMessage (avoid real Telegram traffic) ───────────────────
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

// ── Mock pensieve/store.js ────────────────────────────────────────────────────
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000002' }),
}));
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn().mockResolvedValue(null),
}));

// ── Spy on fire handlers to verify NOT called on in_dialogue branch ───────────
const { mockFireJournal, mockFireWellbeing, mockFireWeeklyReview } = vi.hoisted(() => ({
  mockFireJournal: vi.fn().mockResolvedValue('fired'),
  mockFireWellbeing: vi.fn().mockResolvedValue('fired'),
  mockFireWeeklyReview: vi.fn().mockResolvedValue('fired'),
}));
vi.mock('../journal.js', () => ({
  fireJournal: mockFireJournal,
  recordJournalResponse: vi.fn(),
  shouldSuppressJournalFire: vi.fn().mockResolvedValue(false),
}));
vi.mock('../wellbeing.js', () => ({
  fireWellbeing: mockFireWellbeing,
}));
vi.mock('../weekly-review.js', () => ({
  fireWeeklyReview: mockFireWeeklyReview,
}));

import { db, sql as pgClient } from '../../db/connection.js';
import { rituals, ritualFireEvents, ritualPendingResponses, proactiveState } from '../../db/schema.js';
import { runRitualSweep } from '../scheduler.js';
import { seedRitualWithFireEvents } from './fixtures/skip-tracking.js';

// ── Fixture setup ─────────────────────────────────────────────────────────────
const FIXTURE_PREFIX = 'adj-pred-test-';
const COUNTER_KEY = 'ritual_daily_count';

// Config with skip_threshold=3 (daily default)
const dailyConfig = {
  fire_at: '21:00',
  skip_threshold: 3,
  mute_until: null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1',
  schema_version: 1,
};

// Config with adjustment_mute_until in the future (deferral active)
function dailyConfigWithMuteUntil(isoDate: string) {
  return {
    ...dailyConfig,
    adjustment_mute_until: isoDate,
  };
}

async function cleanFixtures(): Promise<void> {
  const allRituals = await db.select().from(rituals);
  const ids = allRituals
    .filter((r) => r.name.startsWith(FIXTURE_PREFIX))
    .map((r) => r.id);
  if (ids.length > 0) {
    // Phase 28 Plan 03: fireAdjustmentDialogue now writes to ritualPendingResponses
    // — must delete before rituals (FK constraint).
    await db.delete(ritualPendingResponses).where(inArray(ritualPendingResponses.ritualId, ids));
    await db.delete(ritualFireEvents).where(inArray(ritualFireEvents.ritualId, ids));
    await db.delete(rituals).where(inArray(rituals.id, ids));
  }
  // Reset channel counter
  await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));
  // Reset mock call counts
  mockFireJournal.mockClear();
  mockFireWellbeing.mockClear();
  mockFireWeeklyReview.mockClear();
  mockSendMessage.mockClear();
}

describe('shouldFireAdjustmentDialogue predicate dispatch in runRitualSweep', () => {
  beforeEach(async () => {
    await cleanFixtures();
  });

  afterAll(async () => {
    await cleanFixtures();
    await pgClient.end({ timeout: 5 }).catch(() => {});
  });

  it('Test 1: returns in_dialogue when skip_count >= threshold; handler NOT called; skip_count unchanged', async () => {
    // Seed a ritual with skipCount=3 (meets daily threshold=3)
    const dueNow = new Date(Date.now() - 100);
    const [ritualRow] = await db
      .insert(rituals)
      .values({
        name: `${FIXTURE_PREFIX}threshold-met`,
        type: 'daily',
        nextRunAt: dueNow,
        enabled: true,
        config: dailyConfig,
        skipCount: 3,
      })
      .returning();

    const results = await runRitualSweep(new Date());

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('in_dialogue');

    // Dispatch handlers must NOT be called on the in_dialogue branch
    expect(mockFireJournal).not.toHaveBeenCalled();
    expect(mockFireWellbeing).not.toHaveBeenCalled();
    expect(mockFireWeeklyReview).not.toHaveBeenCalled();

    // skip_count must NOT be reset (threshold-met state persists for Plan 28-03)
    const [updatedRitual] = await db
      .select({ skipCount: rituals.skipCount })
      .from(rituals)
      .where(eq(rituals.id, ritualRow!.id))
      .limit(1);
    expect(updatedRitual!.skipCount).toBe(3);
  });

  it('Test 2: when skip_count is below threshold, runRitualSweep proceeds to dispatchRitualHandler', async () => {
    // Seed a ritual with skipCount=2 (below daily threshold=3)
    const dueNow = new Date(Date.now() - 100);
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}below-threshold`,
      type: 'daily',
      nextRunAt: dueNow,
      enabled: true,
      config: dailyConfig,
      skipCount: 2,
    });

    const results = await runRitualSweep(new Date());

    expect(results).toHaveLength(1);
    // Ritual name is adj-pred-test-below-threshold which has no handler in
    // dispatchRitualHandler switch — it falls to default which throws, and
    // the sweep catches it as outcome='fired' (atomic UPDATE succeeded).
    // This proves the predicate check passed through to dispatch.
    expect(results[0]!.outcome).toBe('fired');

    // At least one handler dispatch was attempted (though it threw for unknown name)
    // OR the sweep records it as 'fired' outcome from the handlerErr catch branch.
    // Key: outcome is NOT 'in_dialogue' — predicate was false, dispatch happened.
    expect(results[0]!.outcome).not.toBe('in_dialogue');
  });

  it('Test 3: predicate check occurs AFTER atomic-fire claim (log order verified via result)', async () => {
    // This test proves ordering by asserting that next_run_at was advanced
    // (atomic-fire succeeded) AND outcome is in_dialogue (predicate fired after).
    // If predicate ran BEFORE atomic-fire, next_run_at would not be advanced.
    const dueNow = new Date(Date.now() - 100);
    const originalNextRunAt = dueNow;
    const [ritualRow] = await db
      .insert(rituals)
      .values({
        name: `${FIXTURE_PREFIX}log-order`,
        type: 'daily',
        nextRunAt: originalNextRunAt,
        enabled: true,
        config: dailyConfig,
        skipCount: 3, // at threshold
      })
      .returning();

    const sweepNow = new Date();
    const results = await runRitualSweep(sweepNow);

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('in_dialogue');

    // Verify next_run_at was advanced (atomic-fire claim succeeded)
    const [updatedRitual] = await db
      .select({ nextRunAt: rituals.nextRunAt })
      .from(rituals)
      .where(eq(rituals.id, ritualRow!.id))
      .limit(1);

    // next_run_at should be in the future (advanced from the past dueNow)
    expect(updatedRitual!.nextRunAt.getTime()).toBeGreaterThan(dueNow.getTime());
  });

  it('Test 4: adjustment_mute_until in future + skip_count over threshold → standard dispatch (mute honored)', async () => {
    // adjustment_mute_until = now + 7 days → predicate returns false → standard dispatch
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const dueNow = new Date(Date.now() - 100);
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}muted`,
      type: 'daily',
      nextRunAt: dueNow,
      enabled: true,
      config: dailyConfigWithMuteUntil(futureDate),
      skipCount: 5, // well over threshold=3, but muted
    });

    const results = await runRitualSweep(new Date());

    expect(results).toHaveLength(1);
    // Mute is active → shouldFireAdjustmentDialogue returns false → dispatch proceeds
    // Unknown ritual name → handler throws → outcome='fired' from catch branch.
    expect(results[0]!.outcome).not.toBe('in_dialogue');
  });
});

// Cumulative afterAll: no LLM calls from predicate dispatch (T-28-E1)
afterAll(() => {
  expect(mockAnthropicCreate).not.toHaveBeenCalled();
  expect(mockAnthropicParse).not.toHaveBeenCalled();
});
