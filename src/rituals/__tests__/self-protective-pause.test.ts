/**
 * src/rituals/__tests__/self-protective-pause.test.ts — Phase 28 Plan 04 Task 1
 *
 * Phase 28 Plan 04 SKIP-06 — self-protective pause
 *
 * Real-DB integration tests for:
 *   - hasReachedEvasiveTrigger: returns true when >= 2 evasive responses
 *     within a rolling 14-day window
 *   - autoReEnableExpiredMutes: re-enables rituals where config.mute_until
 *     has expired; leaves manual_disable rituals (no mute_until) untouched.
 *
 * 8 test cases covering all boundary conditions from RESEARCH §SC-3
 * and PLAN 28-04 Task 1 behavior list.
 *
 * Cumulative afterAll: mockAnthropicCreate.not.toHaveBeenCalled() — these
 * helpers should never reach Anthropic.
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/self-protective-pause.test.ts
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

// ── Mock Anthropic (defensive — these helpers must NEVER reach LLM) ───────
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku-3',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

// ── Mock bot.api.sendMessage (defensive) ────────────────────────────────────
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 1234 }),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualResponses,
  ritualConfigEvents,
  ritualFireEvents,
} from '../../db/schema.js';
import { hasReachedEvasiveTrigger, autoReEnableExpiredMutes } from '../skip-tracking.js';

// ── Test fixture config ───────────────────────────────────────────────────────
const FIXTURE_PREFIX = 'self-pause-test-';
const BASE_CONFIG = {
  fire_at: '21:00',
  skip_threshold: 3,
  mute_until: null as string | null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1' as const,
  schema_version: 1 as const,
};

let seededRitualIds: string[] = [];

async function seedRitual(overrides: Partial<typeof BASE_CONFIG & { mute_until: string | null }> = {}) {
  const config = { ...BASE_CONFIG, ...overrides };
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: `${FIXTURE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'daily',
      nextRunAt: new Date(Date.now() + 86_400_000), // tomorrow
      enabled: true,
      config,
      skipCount: 0,
    })
    .returning();
  seededRitualIds.push(ritual!.id);
  return ritual!;
}

async function seedDisabledRitual(muteUntil: string | null) {
  const config: Record<string, unknown> = { ...BASE_CONFIG };
  if (muteUntil !== null) {
    config.mute_until = muteUntil;
  } else {
    // Explicitly no mute_until (manual_disable case)
    delete config.mute_until;
  }
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: `${FIXTURE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'daily',
      nextRunAt: new Date(Date.now() + 86_400_000),
      enabled: false, // disabled
      config,
      skipCount: 0,
    })
    .returning();
  seededRitualIds.push(ritual!.id);
  return ritual!;
}

/**
 * Insert a ritual_responses row with evasive classification metadata.
 */
async function seedEvasiveResponse(ritualId: string, createdAt: Date) {
  const [resp] = await db
    .insert(ritualResponses)
    .values({
      ritualId,
      firedAt: createdAt,
      respondedAt: createdAt,
      promptText: 'What should change?',
      metadata: {
        kind: 'adjustment_dialogue_response',
        classification: 'evasive',
        greg_text: 'I dunno',
      },
    })
    .returning();
  return resp!;
}

async function cleanFixtures() {
  if (seededRitualIds.length > 0) {
    await db.delete(ritualConfigEvents).where(inArray(ritualConfigEvents.ritualId, seededRitualIds));
    await db.delete(ritualResponses).where(inArray(ritualResponses.ritualId, seededRitualIds));
    // Phase 41 D-41-05: autoReEnableExpiredMutes now emits a RESPONDED
    // ritual_fire_events row paired with each re-enable so computeSkipCount
    // replay sees an anchor. Cleanup must delete those rows before the
    // parent rituals row, or the FK constraint blocks deletion.
    await db.delete(ritualFireEvents).where(inArray(ritualFireEvents.ritualId, seededRitualIds));
    await db.delete(rituals).where(inArray(rituals.id, seededRitualIds));
    seededRitualIds = [];
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 28 Plan 04 SKIP-06 — self-protective pause', () => {
  beforeEach(async () => {
    await cleanFixtures();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
  });

  afterAll(async () => {
    await cleanFixtures();
    // Cumulative defensive assertion — helpers must NEVER call Anthropic
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockAnthropicParse).not.toHaveBeenCalled();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  it('Test 1 (hasReachedEvasiveTrigger, 0 evasive): returns false with no ritual_responses rows', async () => {
    const ritual = await seedRitual();

    const result = await hasReachedEvasiveTrigger(ritual.id);

    expect(result).toBe(false);
  });

  it('Test 2 (1 evasive within 14d): returns false — need >= 2', async () => {
    const ritual = await seedRitual();

    // 1 evasive response, 7 days ago (within 14-day window)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await seedEvasiveResponse(ritual.id, sevenDaysAgo);

    const result = await hasReachedEvasiveTrigger(ritual.id);

    expect(result).toBe(false);
  });

  it('Test 3 (2 evasive within 14d): returns true', async () => {
    const ritual = await seedRitual();

    // 2 evasive responses within 14-day window
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 3600 * 1000);
    await seedEvasiveResponse(ritual.id, sevenDaysAgo);
    await seedEvasiveResponse(ritual.id, oneDayAgo);

    const result = await hasReachedEvasiveTrigger(ritual.id);

    expect(result).toBe(true);
  });

  it('Test 4 (2 evasive but > 14d apart): returns false — older row is outside rolling window', async () => {
    const ritual = await seedRitual();

    // First response is 20 days ago — outside the 14-day rolling window
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    // Second response is 1 day ago — inside the window
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 3600 * 1000);

    await seedEvasiveResponse(ritual.id, twentyDaysAgo);
    await seedEvasiveResponse(ritual.id, oneDayAgo);

    const result = await hasReachedEvasiveTrigger(ritual.id);

    // Only 1 row within 14d window → returns false (need >= 2)
    expect(result).toBe(false);
  });

  it('Test 5 (autoReEnableExpiredMutes, no expired): returns 0 when mute_until is in the future', async () => {
    const futureMute = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await seedDisabledRitual(futureMute);

    const count = await autoReEnableExpiredMutes(new Date());

    expect(count).toBe(0);
  });

  it('Test 6 (autoReEnableExpiredMutes, expired): re-enables ritual + clears mute_until + writes ritual_config_events', async () => {
    // mute_until was 1 minute ago — expired
    const expiredMute = new Date(Date.now() - 60 * 1000).toISOString();
    const ritual = await seedDisabledRitual(expiredMute);

    const count = await autoReEnableExpiredMutes(new Date());

    expect(count).toBe(1);

    // Ritual should now be enabled=true
    const [updated] = await db
      .select({ enabled: rituals.enabled, config: rituals.config })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(updated!.enabled).toBe(true);

    // mute_until should be cleared (null in config)
    const cfg = updated!.config as Record<string, unknown>;
    // jsonb_set with 'null'::jsonb sets the value to JSON null; the JS cast yields null
    const muteUntilValue = cfg.mute_until;
    expect(muteUntilValue === null || muteUntilValue === undefined).toBe(true);

    // ritual_config_events row written with actor='system' + patch.kind='auto_re_enable'
    const eventRows = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id))
      .limit(1);
    expect(eventRows).toHaveLength(1);
    const event = eventRows[0]!;
    expect(event.actor).toBe('system');
    const patch = event.patch as Record<string, unknown>;
    expect(patch.kind).toBe('auto_re_enable');
  });

  it('Test 7 (manual_disable does NOT auto-re-enable): ritual with enabled=false but no mute_until stays disabled', async () => {
    // manual_disable: enabled=false, config has NO mute_until field
    const ritual = await seedDisabledRitual(null);

    const count = await autoReEnableExpiredMutes(new Date());

    expect(count).toBe(0);

    // Ritual must remain disabled
    const [updated] = await db
      .select({ enabled: rituals.enabled })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(updated!.enabled).toBe(false);

    // No ritual_config_events row should exist
    const eventRows = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    expect(eventRows).toHaveLength(0);
  });

  it('Test 8 (idempotency under repeat): second call returns 0 after re-enable; no second config event', async () => {
    const expiredMute = new Date(Date.now() - 60 * 1000).toISOString();
    const ritual = await seedDisabledRitual(expiredMute);

    // First call re-enables
    const count1 = await autoReEnableExpiredMutes(new Date());
    expect(count1).toBe(1);

    // Second call: ritual is already enabled=true, mute_until=null → nothing to do
    const count2 = await autoReEnableExpiredMutes(new Date());
    expect(count2).toBe(0);

    // Only ONE ritual_config_events row (from first call)
    const eventRows = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    expect(eventRows).toHaveLength(1);
  });
});
