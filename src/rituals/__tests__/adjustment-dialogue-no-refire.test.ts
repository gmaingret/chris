/**
 * src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts
 * Phase 41 ADJ-07 — regression-class test that asserts skip_count = 0 reset
 * happens at every completion path AND that runRitualSweep does NOT re-fire
 * shouldFireAdjustmentDialogue on the next tick after each completion.
 *
 * Five completion paths covered (per D-41-05):
 *   1. user_yes      — handleConfirmationReply yes-branch
 *   2. user_no       — handleConfirmationReply no-branch
 *   3. drop_it       — routeRefusal hard_disable branch (via handleAdjustmentReply)
 *   4. not_now       — routeRefusal not_now branch (via handleAdjustmentReply)
 *   5. auto_re_enable — autoReEnableExpiredMutes after 30-day mute expiry
 *
 * Real-DB integration test. Mocks Anthropic (Haiku messages.parse only) and
 * Telegram (bot.api.sendMessage). Exercises the full reset+fire-event pair
 * at each completion site against live Docker postgres.
 *
 * Cumulative afterAll: mockAnthropicCreate.not.toHaveBeenCalled() — proves
 * Sonnet/messages.create is NEVER invoked from any of these paths (Pitfall 6
 * invariant carried from Phase 28). Only Haiku messages.parse is allowed
 * (and only for Cases 1 + 2 which drive through handleAdjustmentReply with
 * a mocked change_requested classification).
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';

// ── Mock Anthropic client (load-bearing for Pitfall 6) ─────────────────────
const { mockAnthropicCreate, mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 9999 }),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku-3',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: { sendMessage: mockSendMessage },
  },
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
  ritualConfigEvents,
} from '../../db/schema.js';
import {
  fireAdjustmentDialogue,
  handleAdjustmentReply,
  handleConfirmationReply,
} from '../adjustment-dialogue.js';
import { autoReEnableExpiredMutes, shouldFireAdjustmentDialogue } from '../skip-tracking.js';

const FIXTURE_RITUAL_NAME = 'adj-no-refire-integration-test-ritual';
const TEST_CHAT_ID = BigInt(99999);

async function createTestRitual(overrides: Partial<typeof rituals.$inferInsert> = {}) {
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: FIXTURE_RITUAL_NAME,
      type: 'daily',
      nextRunAt: new Date(),
      enabled: true,
      skipCount: 3, // at threshold → shouldFireAdjustmentDialogue returns true
      config: {
        fire_at: '21:00',
        prompt_bag: [1, 2, 3],
        skip_threshold: 3,
        mute_until: null,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
      ...overrides,
    })
    .returning();
  return ritual!;
}

async function cleanup() {
  // Order matters — child rows first to satisfy FK constraints.
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  await db.delete(ritualConfigEvents);
  await db.delete(ritualFireEvents);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}

/**
 * Drive a yes/no confirmation flow: seed at threshold → fire adjustment
 * dialogue → drive handleAdjustmentReply with a mocked change_requested
 * classification → consume the resulting adjustment_confirmation pending
 * row by calling handleConfirmationReply with the supplied text.
 *
 * Returns the seeded ritual + the confirmation pending row.
 */
async function driveToConfirmation() {
  const ritual = await createTestRitual();
  await fireAdjustmentDialogue(ritual);

  // First pending row is the adjustment_dialogue prompt
  const [adjPending] = await db
    .select()
    .from(ritualPendingResponses)
    .where(eq(ritualPendingResponses.ritualId, ritual.id));

  // Mock Haiku: change_requested with valid fire_at
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: {
      classification: 'change_requested',
      proposed_change: { field: 'fire_at', new_value: '19:30' },
      confidence: 0.95,
    },
  });

  await handleAdjustmentReply(adjPending!, Number(TEST_CHAT_ID), 'move it to 19:30');

  // Second pending row is the adjustment_confirmation echo
  const confirmRows = (await db.select().from(ritualPendingResponses)).filter(
    (r) => (r.metadata as { kind?: string } | null)?.kind === 'adjustment_confirmation',
  );
  return { ritual, confirmPending: confirmRows[0]! };
}

describe('Phase 41 ADJ-07 — no re-fire after completion', () => {
  afterAll(async () => {
    // Pitfall 6 invariant — Sonnet must never be called from any of the
    // completion paths exercised below.
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

  it('Case 1 (yes-reply): skipCount=0 + RESPONDED user_yes fire-event + no re-fire on next sweep', async () => {
    const { ritual, confirmPending } = await driveToConfirmation();

    await handleConfirmationReply(confirmPending, Number(TEST_CHAT_ID), 'yes');

    // (a) skip_count reset
    const [refreshed] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    expect(refreshed!.skipCount).toBe(0);

    // (b) RESPONDED fire-event with source=user_yes (filter to isolate from
    // the prior in_dialogue fire emitted by fireAdjustmentDialogue — per
    // PLAN-CHECK WARNING-5)
    const yesEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritual.id),
          eq(ritualFireEvents.outcome, 'responded'),
        ),
      );
    const userYes = yesEvents.find(
      (r) => (r.metadata as { source?: string } | null)?.source === 'user_yes',
    );
    expect(userYes).toBeDefined();

    // (c) predicate now returns false
    expect(await shouldFireAdjustmentDialogue(refreshed!)).toBe(false);
  });

  it('Case 2 (no-reply): skipCount=0 + RESPONDED user_no fire-event + no re-fire on next sweep', async () => {
    const { ritual, confirmPending } = await driveToConfirmation();

    await handleConfirmationReply(confirmPending, Number(TEST_CHAT_ID), 'no');

    const [refreshed] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    expect(refreshed!.skipCount).toBe(0);

    const noEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritual.id),
          eq(ritualFireEvents.outcome, 'responded'),
        ),
      );
    const userNo = noEvents.find(
      (r) => (r.metadata as { source?: string } | null)?.source === 'user_no',
    );
    expect(userNo).toBeDefined();

    expect(await shouldFireAdjustmentDialogue(refreshed!)).toBe(false);
  });

  it('Case 3 (refusal hard_disable): enabled=false + skipCount=0 + RESPONDED user_drop_it_or_disable fire-event', async () => {
    const ritual = await createTestRitual();
    await fireAdjustmentDialogue(ritual);

    const [adjPending] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.ritualId, ritual.id));

    // "drop it" matches EN_PATTERNS in refusal.ts → hard_disable branch
    await handleAdjustmentReply(adjPending!, Number(TEST_CHAT_ID), 'drop it');

    const [refreshed] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    expect(refreshed!.enabled).toBe(false);
    expect(refreshed!.skipCount).toBe(0);

    const respondedEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritual.id),
          eq(ritualFireEvents.outcome, 'responded'),
        ),
      );
    const dropIt = respondedEvents.find(
      (r) => (r.metadata as { source?: string } | null)?.source === 'user_drop_it_or_disable',
    );
    expect(dropIt).toBeDefined();

    // Haiku NEVER called on the refusal path (refusal pre-check short-circuits)
    expect(mockAnthropicParse).not.toHaveBeenCalled();
  });

  it('Case 4 (refusal not_now): enabled=true + adjustment_mute_until set + skipCount=0 + RESPONDED user_not_now', async () => {
    const ritual = await createTestRitual();
    await fireAdjustmentDialogue(ritual);

    const [adjPending] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.ritualId, ritual.id));

    // "not now please" matches ADJUSTMENT_NOT_NOW_PATTERN → not_now branch
    await handleAdjustmentReply(adjPending!, Number(TEST_CHAT_ID), 'not now please');

    const [refreshed] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    expect(refreshed!.enabled).toBe(true);
    expect(refreshed!.skipCount).toBe(0);

    const cfg = refreshed!.config as { adjustment_mute_until?: string | null };
    expect(cfg.adjustment_mute_until).toBeTruthy();
    expect(new Date(cfg.adjustment_mute_until!).getTime()).toBeGreaterThan(Date.now());

    const respondedEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritual.id),
          eq(ritualFireEvents.outcome, 'responded'),
        ),
      );
    const notNow = respondedEvents.find(
      (r) => (r.metadata as { source?: string } | null)?.source === 'user_not_now',
    );
    expect(notNow).toBeDefined();

    // Predicate closes for two independent reasons (both gates close):
    //   skipCount === 0 AND adjustment_mute_until is in the future.
    expect(await shouldFireAdjustmentDialogue(refreshed!)).toBe(false);
  });

  it('Case 5 (auto-re-enable after mute-expiry): enabled=true + skipCount=0 + mute_until cleared + RESPONDED auto_re_enable', async () => {
    // Seed a ritual that was self-protective-paused 30 days ago and is now
    // due for re-enable.
    const expiredMute = new Date(Date.now() - 60 * 1000).toISOString();
    const ritual = await createTestRitual({
      enabled: false,
      skipCount: 3,
      config: {
        fire_at: '21:00',
        prompt_bag: [1, 2, 3],
        skip_threshold: 3,
        mute_until: expiredMute,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
    });

    const reEnabledCount = await autoReEnableExpiredMutes(new Date());
    expect(reEnabledCount).toBe(1);

    const [refreshed] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    expect(refreshed!.enabled).toBe(true);
    expect(refreshed!.skipCount).toBe(0);
    const cfg = refreshed!.config as { mute_until?: string | null };
    expect(cfg.mute_until).toBeNull();

    const respondedEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritual.id),
          eq(ritualFireEvents.outcome, 'responded'),
        ),
      );
    const autoReEnable = respondedEvents.find(
      (r) => (r.metadata as { source?: string } | null)?.source === 'auto_re_enable',
    );
    expect(autoReEnable).toBeDefined();

    // The predicate would not fire even though next_run_at is due — skipCount
    // is back to 0 below the threshold.
    expect(await shouldFireAdjustmentDialogue(refreshed!)).toBe(false);
  });
});
