/**
 * src/rituals/__tests__/refusal-pre-check.integration.test.ts
 * Phase 28 Plan 04 SKIP-07 — M006 refusal pre-check + evasive-trigger handling
 *
 * Real-DB integration test exercising:
 *   1. handleAdjustmentReply refusal pre-check (STEP 1.5) — Haiku NEVER reached
 *      for refusal text inputs (Pitfall 2 invariant per RESEARCH).
 *   2. Evasive-trigger path — 2 evasive replies within 14d → 30-day auto-pause.
 *
 * TWO top-level describe blocks:
 *   - 'Phase 28 Plan 04 SKIP-07 — refusal pre-check (Pitfall 2 invariant)':
 *     Tests 1-4. afterAll: cumulative mockAnthropicParse.not.toHaveBeenCalled()
 *     (LOAD-BEARING — proves Haiku is NEVER reached for refusal text inputs).
 *   - 'Phase 28 Plan 04 SKIP-06 — non-refusal Haiku path (positive control)':
 *     Tests 5-6. afterAll: mockAnthropicCreate.not.toHaveBeenCalled()
 *     (Sonnet still NEVER reached; Haiku IS reached in Test 5 + 6, which is correct).
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/refusal-pre-check.integration.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

// ── Mock Anthropic (cumulative assertion differs per describe block) ──────────
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

// ── Mock bot.api.sendMessage (avoid real Telegram traffic) ───────────────────
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 9999 }),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualConfigEvents,
} from '../../db/schema.js';
import { handleAdjustmentReply } from '../adjustment-dialogue.js';
import { hasReachedEvasiveTrigger } from '../skip-tracking.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

const FIXTURE_PREFIX = 'refusal-precheck-test-';
const TEST_CHAT_ID = 99998;
let seededRitualIds: string[] = [];

const BASE_CONFIG = {
  fire_at: '21:00',
  skip_threshold: 3,
  mute_until: null as string | null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1' as const,
  schema_version: 1 as const,
};

async function createTestRitual(enabled = true) {
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: `${FIXTURE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'daily',
      nextRunAt: new Date(),
      enabled,
      skipCount: 3,
      config: { ...BASE_CONFIG },
    })
    .returning();
  seededRitualIds.push(ritual!.id);
  return ritual!;
}

async function insertAdjustmentPendingRow(ritualId: string) {
  const firedAt = new Date();
  const [pending] = await db
    .insert(ritualPendingResponses)
    .values({
      ritualId,
      chatId: BigInt(TEST_CHAT_ID),
      firedAt,
      expiresAt: new Date(firedAt.getTime() + 18 * 3600 * 1000),
      promptText: "This ritual isn't working — what should change?",
      metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: 'test' },
    })
    .returning();
  return pending!;
}

async function cleanup() {
  if (seededRitualIds.length > 0) {
    await db.delete(ritualConfigEvents).where(inArray(ritualConfigEvents.ritualId, seededRitualIds));
    await db.delete(ritualResponses).where(inArray(ritualResponses.ritualId, seededRitualIds));
    await db.delete(ritualPendingResponses).where(inArray(ritualPendingResponses.ritualId, seededRitualIds));
    await db.delete(rituals).where(inArray(rituals.id, seededRitualIds));
    seededRitualIds = [];
  }
}

// ── Describe Block 1: Refusal pre-check (Pitfall 2 invariant) ─────────────────
// LOAD-BEARING: afterAll asserts mockAnthropicParse.not.toHaveBeenCalled()
// cumulatively across Tests 1-4. Any invocation of Haiku for refusal inputs
// would violate the SKIP-06/SKIP-07 invariant (RESEARCH Pitfall 2).

describe('Phase 28 Plan 04 SKIP-07 — refusal pre-check (Pitfall 2 invariant)', () => {
  afterAll(async () => {
    // LOAD-BEARING cumulative assertion — Haiku NEVER reached for refusal inputs
    expect(mockAnthropicParse).not.toHaveBeenCalled();
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 9999 });
  });

  it('Test 1 ("drop it" → manual_disable): ritual disabled + ritual_config_events + Haiku NOT called', async () => {
    const ritual = await createTestRitual();
    const pending = await insertAdjustmentPendingRow(ritual.id);

    await handleAdjustmentReply(pending, TEST_CHAT_ID, 'drop it');

    // 1. Ritual.enabled flipped to false
    const [updated] = await db
      .select({ enabled: rituals.enabled })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(updated!.enabled).toBe(false);

    // 2. ritual_config_events row with actor='adjustment_dialogue_refusal' + patch.kind='manual_disable'
    const events = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('adjustment_dialogue_refusal');
    const patch = events[0]!.patch as Record<string, unknown>;
    expect(patch.kind).toBe('manual_disable');

    // 3. Haiku NOT reached (verified cumulatively in afterAll)
    expect(mockAnthropicParse.mock.calls.length).toBe(0);
  });

  it('Test 2 ("disable" → manual_disable): adjustment-specific pattern + Haiku NOT called', async () => {
    const ritual = await createTestRitual();
    const pending = await insertAdjustmentPendingRow(ritual.id);

    await handleAdjustmentReply(pending, TEST_CHAT_ID, 'disable this ritual');

    // 1. Ritual.enabled flipped to false
    const [updated] = await db
      .select({ enabled: rituals.enabled })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(updated!.enabled).toBe(false);

    // 2. ritual_config_events with manual_disable
    const events = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('adjustment_dialogue_refusal');
    const patch = events[0]!.patch as Record<string, unknown>;
    expect(patch.kind).toBe('manual_disable');

    // Haiku NOT reached
    expect(mockAnthropicParse.mock.calls.length).toBe(0);
  });

  it('Test 3 ("not now" → 7-day adjustment_mute_until): enabled unchanged + mute set + ritual_config_events', async () => {
    const ritual = await createTestRitual();
    const pending = await insertAdjustmentPendingRow(ritual.id);

    const before = new Date();
    await handleAdjustmentReply(pending, TEST_CHAT_ID, 'not now please');

    // 1. Ritual.enabled UNCHANGED (still true — "not now" is a deferral, not a disable)
    const [updated] = await db
      .select({ enabled: rituals.enabled, config: rituals.config })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(updated!.enabled).toBe(true);

    // 2. config.adjustment_mute_until set to approximately now + 7 days
    const cfg = updated!.config as Record<string, unknown>;
    const muteUntil = new Date(cfg.adjustment_mute_until as string);
    const sevenDaysFromNow = new Date(before.getTime() + 7 * 24 * 3600 * 1000);
    const tolerance = 5000; // 5 seconds tolerance
    expect(Math.abs(muteUntil.getTime() - sevenDaysFromNow.getTime())).toBeLessThan(tolerance);

    // 3. ritual_config_events row with actor='adjustment_dialogue_refusal' + patch.kind='apply'
    const events = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe('adjustment_dialogue_refusal');
    const patch = events[0]!.patch as Record<string, unknown>;
    expect(patch.kind).toBe('apply');
    expect(patch.field).toBe('adjustment_mute_until');

    // Haiku NOT reached
    expect(mockAnthropicParse.mock.calls.length).toBe(0);
  });

  it('Test 4 (refusal does NOT count as evasive): two "drop it" replies → ritual stays disabled, NO auto_pause', async () => {
    const ritual = await createTestRitual();

    // First "drop it" reply
    const pending1 = await insertAdjustmentPendingRow(ritual.id);
    await handleAdjustmentReply(pending1, TEST_CHAT_ID, 'drop it');

    // Verify hasReachedEvasiveTrigger returns false (refusal didn't write evasive marker)
    const evasiveResult = await hasReachedEvasiveTrigger(ritual.id);
    expect(evasiveResult).toBe(false);

    // No ritual_responses rows written (refusals don't touch ritual_responses)
    const respRows = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, ritual.id));
    expect(respRows).toHaveLength(0);

    // Ritual should be disabled from the first "drop it"
    const [afterFirst] = await db
      .select({ enabled: rituals.enabled })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(afterFirst!.enabled).toBe(false);

    // Check: only manual_disable events exist (no auto_pause)
    const eventsBefore = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    const autoEvents = eventsBefore.filter(
      (e) => (e.patch as Record<string, unknown>).kind === 'auto_pause',
    );
    expect(autoEvents).toHaveLength(0);

    // Haiku NOT reached
    expect(mockAnthropicParse.mock.calls.length).toBe(0);
  });
});

// ── Describe Block 2: Non-refusal Haiku path (positive control) ───────────────

describe('Phase 28 Plan 04 SKIP-06 — non-refusal Haiku path (positive control)', () => {
  afterAll(async () => {
    // Sonnet (create) NEVER called — only Haiku (parse) is allowed on this path
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 9999 });
  });

  it('Test 5 (non-refusal text reaches Haiku): "change to 19:30" routes to Haiku classification', async () => {
    const ritual = await createTestRitual();
    const pending = await insertAdjustmentPendingRow(ritual.id);

    // Mock Haiku: change_requested
    mockAnthropicParse.mockResolvedValue({
      parsed_output: {
        classification: 'change_requested',
        proposed_change: { field: 'fire_at', new_value: '19:30' },
        confidence: 0.95,
      },
    });

    await handleAdjustmentReply(pending, TEST_CHAT_ID, 'change to 19:30');

    // Haiku WAS reached (positive control — non-refusal text)
    expect(mockAnthropicParse.mock.calls.length).toBe(1);

    // Standard change_requested flow: confirmation pending row created
    const pendingRows = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.ritualId, ritual.id));
    const confirmRows = pendingRows.filter(
      (r) => (r.metadata as { kind?: string } | null)?.kind === 'adjustment_confirmation',
    );
    expect(confirmRows).toHaveLength(1);
  });

  it('Test 6 (evasive-trigger applies 30-day pause): 2 evasive replies → ritual.enabled=false + mute_until=+30d', async () => {
    const ritual = await createTestRitual();

    // Mock Haiku to return 'evasive' for both replies
    mockAnthropicParse.mockResolvedValue({
      parsed_output: { classification: 'evasive', proposed_change: null, confidence: 0.85 },
    });

    // First evasive reply (non-refusal text so Haiku is reached)
    const pending1 = await insertAdjustmentPendingRow(ritual.id);
    await handleAdjustmentReply(pending1, TEST_CHAT_ID, 'I dunno maybe');

    // Only 1 evasive response → no auto-pause yet
    const [afterFirst] = await db
      .select({ enabled: rituals.enabled })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(afterFirst!.enabled).toBe(true);

    // Second evasive reply (within 14d window — inserted shortly after)
    const pending2 = await insertAdjustmentPendingRow(ritual.id);
    const before30d = new Date();
    await handleAdjustmentReply(pending2, TEST_CHAT_ID, 'whatever I guess');

    // After 2nd evasive: ritual.enabled=false
    const [afterSecond] = await db
      .select({ enabled: rituals.enabled, config: rituals.config })
      .from(rituals)
      .where(eq(rituals.id, ritual.id))
      .limit(1);
    expect(afterSecond!.enabled).toBe(false);

    // rituals.config.mute_until ≈ now + 30 days
    const cfg = afterSecond!.config as Record<string, unknown>;
    const muteUntil = new Date(cfg.mute_until as string);
    const thirtyDaysFromNow = new Date(before30d.getTime() + 30 * 24 * 3600 * 1000);
    const tolerance = 10000; // 10 seconds tolerance
    expect(Math.abs(muteUntil.getTime() - thirtyDaysFromNow.getTime())).toBeLessThan(tolerance);

    // ritual_config_events row with actor='system' + patch.kind='auto_pause'
    const events = await db
      .select()
      .from(ritualConfigEvents)
      .where(eq(ritualConfigEvents.ritualId, ritual.id));
    const autoPauseEvents = events.filter(
      (e) => (e.patch as Record<string, unknown>).kind === 'auto_pause',
    );
    expect(autoPauseEvents).toHaveLength(1);
    expect(autoPauseEvents[0]!.actor).toBe('system');

    // Haiku WAS called twice (2 non-refusal evasive replies)
    expect(mockAnthropicParse.mock.calls.length).toBe(2);
  });
});
