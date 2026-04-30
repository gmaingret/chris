/**
 * src/rituals/__tests__/confirmation-window.test.ts
 * Phase 28 Plan 03 SKIP-05 — 60s confirmation window
 *
 * Real-DB integration test. Exercises the confirmation-window flow:
 *   - yes reply → patch applied + ritual_config_events row
 *   - no reply → patch NOT applied + ritual_config_events abort row
 *   - timeout → auto-apply on timeout via ritualConfirmationSweep
 *   - race → atomic-consume ensures exactly one patch applied
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/confirmation-window.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// Mocks (no LLM calls in confirmation path)
const { mockAnthropicCreate, mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 9998 }),
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
  handleConfirmationReply,
  confirmConfigPatch,
  ritualConfirmationSweep,
} from '../adjustment-dialogue.js';

const FIXTURE_RITUAL_NAME = 'confirmation-window-test-ritual';
const TEST_CHAT_ID = BigInt(88888);

async function createTestRitual() {
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: FIXTURE_RITUAL_NAME,
      type: 'daily',
      nextRunAt: new Date(),
      enabled: true,
      skipCount: 3,
      config: {
        fire_at: '21:00',
        prompt_bag: [1, 2, 3],
        skip_threshold: 3,
        mute_until: null,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
    })
    .returning();
  return ritual!;
}

async function seedConfirmationPending(ritualId: string, expiresAt: Date) {
  const firedAt = new Date();
  const [pending] = await db
    .insert(ritualPendingResponses)
    .values({
      ritualId,
      chatId: TEST_CHAT_ID,
      firedAt,
      expiresAt,
      promptText: 'Change fire_at to 19:30 — OK? (auto-applies in 60s if no reply)',
      metadata: {
        kind: 'adjustment_confirmation',
        proposed_change: { field: 'fire_at', new_value: '19:30' },
        originalFireAt: '21:00',
      },
    })
    .returning();
  return pending!;
}

async function cleanup() {
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  await db.delete(ritualFireEvents);
  await db.delete(ritualConfigEvents);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}

describe('Phase 28 Plan 03 SKIP-05 — 60s confirmation window', () => {
  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 9998 });
    vi.useRealTimers();
  });

  it('Test 7 (yes branch): "yes" reply applies config patch + writes ritual_config_events with actor=user', async () => {
    const ritual = await createTestRitual();
    const expiresAt = new Date(Date.now() + 60_000);
    const pending = await seedConfirmationPending(ritual.id, expiresAt);

    await handleConfirmationReply(pending, Number(TEST_CHAT_ID), 'yes');

    // 1. rituals.config.fire_at updated
    const [updatedRitual] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    const cfg = updatedRitual!.config as { fire_at?: string };
    expect(cfg.fire_at).toBe('19:30');

    // 2. ritual_config_events row: actor='user', patch.kind='apply'
    const configEvents = await db.select().from(ritualConfigEvents);
    expect(configEvents).toHaveLength(1);
    const event = configEvents[0]!;
    expect(event.actor).toBe('user');
    const patch = event.patch as { kind?: string; field?: string; new_value?: string };
    expect(patch.kind).toBe('apply');
    expect(patch.field).toBe('fire_at');
    expect(patch.new_value).toBe('19:30');

    // 3. Pending row consumed
    const [consumed] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending.id));
    expect(consumed!.consumedAt).not.toBeNull();
  });

  it('Test 8 (no branch): "no" reply does NOT apply patch + writes ritual_config_events abort', async () => {
    const ritual = await createTestRitual();
    const expiresAt = new Date(Date.now() + 60_000);
    const pending = await seedConfirmationPending(ritual.id, expiresAt);

    await handleConfirmationReply(pending, Number(TEST_CHAT_ID), 'no');

    // 1. rituals.config.fire_at unchanged
    const [updatedRitual] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    const cfg = updatedRitual!.config as { fire_at?: string };
    expect(cfg.fire_at).toBe('21:00'); // unchanged

    // 2. ritual_config_events row: actor='user', patch.kind='abort'
    const configEvents = await db.select().from(ritualConfigEvents);
    expect(configEvents).toHaveLength(1);
    const event = configEvents[0]!;
    expect(event.actor).toBe('user');
    const patch = event.patch as { kind?: string };
    expect(patch.kind).toBe('abort');
  });

  it('Test 9 (timeout branch): expired confirmation row auto-applied by ritualConfirmationSweep with actor=auto_apply_on_timeout', async () => {
    const ritual = await createTestRitual();
    // Seed row that already expired (1 minute ago) — no fake timers needed;
    // we pass an already-expired expiresAt and call sweep with now = new Date()
    // which is after expiry.
    const alreadyExpired = new Date(Date.now() - 60_000);
    const pending = await seedConfirmationPending(ritual.id, alreadyExpired);

    // ritualConfirmationSweep called with now > expiresAt — should pick up the row
    const processed = await ritualConfirmationSweep(new Date());

    expect(processed).toBe(1);

    // 1. rituals.config.fire_at updated
    const [updatedRitual] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    const cfg = updatedRitual!.config as { fire_at?: string };
    expect(cfg.fire_at).toBe('19:30');

    // 2. ritual_config_events row: actor='auto_apply_on_timeout'
    const configEvents = await db.select().from(ritualConfigEvents);
    expect(configEvents).toHaveLength(1);
    expect(configEvents[0]!.actor).toBe('auto_apply_on_timeout');
    const patch = configEvents[0]!.patch as { kind?: string };
    expect(patch.kind).toBe('apply');

    // Verify pending row was consumed
    const [consumedRow] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending.id));
    expect(consumedRow!.consumedAt).not.toBeNull();
  });

  it('Test 10 (race): sweep + handleConfirmationReply race — exactly ONE patch applied', async () => {
    const ritual = await createTestRitual();
    // Already expired
    const expiresAt = new Date(Date.now() - 1_000);
    const pending = await seedConfirmationPending(ritual.id, expiresAt);

    // Run sweep first (should consume)
    const processed = await ritualConfirmationSweep(new Date());
    expect(processed).toBe(1);

    // Then handleConfirmationReply for same row (should silently no-op)
    await handleConfirmationReply(pending, Number(TEST_CHAT_ID), 'yes');

    // Exactly ONE patch applied
    const configEvents = await db.select().from(ritualConfigEvents);
    expect(configEvents).toHaveLength(1);
  });
});
